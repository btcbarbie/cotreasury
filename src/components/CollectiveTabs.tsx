'use client'

import { useState } from 'react'
import dynamic from 'next/dynamic'
import { ShieldCheck, Sparkles } from 'lucide-react'
import { formatMoney } from '@/lib/money'
import { Avatar, RoleBadge } from './ui'
import type { LedgerRow } from './LedgerGrid'

// AG Grid touches window on import; render it client-side only.
const LedgerGrid = dynamic(() => import('./LedgerGrid').then((m) => m.LedgerGrid), {
  ssr: false,
  loading: () => <div className="h-[520px] animate-pulse bg-bg" />,
})

type Member = { id: string; name: string; email: string; role: string }
type Tier = { minCents: number; maxCents: number | null; requiredApprovals: number }
type Proposal = {
  id: string
  title: string
  description: string | null
  amountCents: number
  requiredApprovals: number
  status: string
  createdAt: string
  proposedBy: string | null
  approvals: { memberName: string; decision: string }[]
  recipientCount: number
}

const TABS = ['Requests', 'Ledger', 'Rules', 'Members'] as const
type Tab = (typeof TABS)[number]

export function CollectiveTabs(props: {
  currency: string
  viewerRole: string
  members: Member[]
  tiers: Tier[]
  entries: LedgerRow[]
  proposals: Proposal[]
}) {
  const [tab, setTab] = useState<Tab>('Requests')
  const counts: Partial<Record<Tab, number>> = {
    Requests: props.proposals.filter((p) => p.status === 'PENDING_APPROVAL').length || undefined,
    Ledger: props.entries.length,
    Members: props.members.length,
  }

  return (
    <div className="mt-10">
      <div className="no-scrollbar flex gap-1 border-b border-line overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`relative -mb-px flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium transition ${
              tab === t ? 'text-ink border-b-2 border-ink' : 'text-muted hover:text-ink border-b-2 border-transparent'
            }`}
          >
            {t}
            {counts[t] != null && <span className="tabular text-xs text-faint">{counts[t]}</span>}
          </button>
        ))}
      </div>

      <div className="mt-5">
        {tab === 'Requests' && <RequestsPanel proposals={props.proposals} currency={props.currency} />}
        {tab === 'Ledger' && (
          <div className="card overflow-hidden">
            <LedgerGrid entries={props.entries} currency={props.currency} />
          </div>
        )}
        {tab === 'Rules' && <RulesPanel tiers={props.tiers} members={props.members} currency={props.currency} />}
        {tab === 'Members' && <MembersPanel members={props.members} />}
      </div>
    </div>
  )
}

const PROPOSAL_STATUS: Record<string, { label: string; pill: string }> = {
  PENDING_APPROVAL: { label: 'Awaiting approval', pill: 'pill-amber' },
  APPROVED: { label: 'Approved', pill: 'pill-blue' },
  EXECUTING: { label: 'Paying out', pill: 'pill-blue' },
  COMPLETED: { label: 'Paid', pill: 'pill-green' },
  REJECTED: { label: 'Rejected', pill: 'pill-red' },
  FAILED: { label: 'Failed', pill: 'pill-red' },
}

function RequestsPanel({ proposals, currency }: { proposals: Proposal[]; currency: string }) {
  if (proposals.length === 0) {
    return (
      <div className="card flex flex-col items-center px-6 py-14 text-center">
        <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-accent-soft text-accent">
          <Sparkles size={18} />
        </span>
        <div className="mt-4 font-medium">No spending requests yet</div>
        <p className="mt-1 max-w-sm text-sm text-muted">
          Ask the AI Treasurer whether the group can afford something. It checks the ledger, works out how many
          approvals the rules require, and drafts the request for the approvers.
        </p>
      </div>
    )
  }
  return (
    <div className="grid gap-3">
      {proposals.map((p) => {
        const approvals = p.approvals.filter((a) => a.decision === 'APPROVE').length
        const s = PROPOSAL_STATUS[p.status] ?? { label: p.status, pill: 'pill-gray' }
        return (
          <div key={p.id} className="card p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-medium">{p.title}</div>
                {p.description && <p className="mt-0.5 text-sm text-muted">{p.description}</p>}
              </div>
              <div className="tabular text-lg font-semibold">{formatMoney(p.amountCents, currency)}</div>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
              <span className={`pill ${s.pill}`}>{s.label}</span>
              <span className="text-muted">
                {approvals} of {p.requiredApprovals} approvals
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function RulesPanel({ tiers, members, currency }: { tiers: Tier[]; members: Member[]; currency: string }) {
  const approvers = members.filter((m) => m.role === 'APPROVER' || m.role === 'ADMIN')
  return (
    <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
      <div className="card p-5">
        <div className="flex items-center gap-2 font-medium">
          <ShieldCheck size={16} className="text-accent" /> Spending rules
        </div>
        <p className="mt-1 text-sm text-muted">
          Every payout needs this many approvals from the approvers before PayPal is asked to send it. The AI
          Treasurer cannot approve or change these rules.
        </p>
        <div className="mt-4 divide-y divide-line">
          {tiers.map((t, i) => (
            <div key={i} className="flex items-center justify-between py-3 text-sm">
              <span className="tabular">
                {t.maxCents === null
                  ? `${formatMoney(t.minCents, currency)} and above`
                  : t.minCents === 0
                    ? `Under ${formatMoney(t.maxCents, currency)}`
                    : `${formatMoney(t.minCents, currency)} – ${formatMoney(t.maxCents, currency)}`}
              </span>
              <span className="flex items-center gap-2">
                <span className="flex gap-1">
                  {approvers.map((_, j) => (
                    <span key={j} className={`h-2 w-2 rounded-full ${j < t.requiredApprovals ? 'bg-ink' : 'bg-line-strong'}`} />
                  ))}
                </span>
                <span className="w-24 text-right text-muted">
                  {t.requiredApprovals} of {approvers.length}
                </span>
              </span>
            </div>
          ))}
        </div>
      </div>
      <div className="card p-5">
        <div className="font-medium">Approvers</div>
        <p className="mt-1 text-sm text-muted">Chosen by the group, not by who contributes most.</p>
        <div className="mt-4 grid gap-3">
          {approvers.map((m) => (
            <div key={m.id} className="flex items-center gap-3">
              <Avatar name={m.name} />
              <span className="flex-1 truncate text-sm">{m.name}</span>
              <RoleBadge role={m.role} />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function MembersPanel({ members }: { members: Member[] }) {
  return (
    <div className="card divide-y divide-line">
      {members.map((m) => (
        <div key={m.id} className="flex items-center gap-3 px-5 py-3">
          <Avatar name={m.name} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{m.name}</div>
            <div className="truncate text-xs text-muted">{m.email}</div>
          </div>
          <RoleBadge role={m.role} />
        </div>
      ))}
    </div>
  )
}
