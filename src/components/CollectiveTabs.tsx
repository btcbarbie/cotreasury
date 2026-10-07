'use client'

import { useState, useTransition } from 'react'
import dynamic from 'next/dynamic'
import { Check, Loader2, ShieldCheck, Sparkles, X } from 'lucide-react'
import { decideRequest } from '@/app/c/[id]/actions'
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
  proposedById: string | null
  approvals: { memberId: string; memberName: string; decision: string }[]
  recipients: { name: string; receiver: string; amountCents: number }[]
}

const TABS = ['Requests', 'Ledger', 'Rules', 'Members'] as const
type Tab = (typeof TABS)[number]

export function CollectiveTabs(props: {
  collectiveId: string
  currency: string
  viewerId: string
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
        {tab === 'Requests' && (
          <RequestsPanel proposals={props.proposals} currency={props.currency} viewerId={props.viewerId} viewerRole={props.viewerRole} members={props.members} />
        )}
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

function RequestsPanel({
  proposals,
  currency,
  viewerId,
  viewerRole,
  members,
}: {
  proposals: Proposal[]
  currency: string
  viewerId: string
  viewerRole: string
  members: Member[]
}) {
  if (proposals.length === 0) {
    return (
      <div className="card flex flex-col items-center px-6 py-14 text-center">
        <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-violet-soft text-violet">
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
  const approvers = members.filter((m) => m.role === 'APPROVER' || m.role === 'ADMIN')
  return (
    <div className="grid gap-3">
      {proposals.map((p) => (
        <RequestCard key={p.id} p={p} currency={currency} viewerId={viewerId} viewerRole={viewerRole} approvers={approvers} />
      ))}
    </div>
  )
}

function RequestCard({
  p,
  currency,
  viewerId,
  viewerRole,
  approvers,
}: {
  p: Proposal
  currency: string
  viewerId: string
  viewerRole: string
  approvers: Member[]
}) {
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const approvals = p.approvals.filter((a) => a.decision === 'APPROVE').length
  const s = PROPOSAL_STATUS[p.status] ?? { label: p.status, pill: 'pill-gray' }
  const isApprover = viewerRole === 'APPROVER' || viewerRole === 'ADMIN'
  const isMaker = p.proposedById === viewerId
  const voted = p.approvals.some((a) => a.memberId === viewerId)
  const open = p.status === 'PENDING_APPROVAL'

  function decide(decision: 'APPROVE' | 'REJECT') {
    setError(null)
    start(async () => {
      const r = await decideRequest(p.id, decision)
      if (!r.ok) setError(r.error)
    })
  }

  let note: string | null = null
  if (open && !isApprover) note = 'Only approvers can sign off on requests.'
  else if (open && isMaker) note = 'You created this request, so another approver has to review it.'
  else if (open && voted) note = 'You have signed off. Waiting for the other approvers.'

  return (
    <div className="card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{p.title}</span>
            <span className={`pill ${s.pill}`}>{s.label}</span>
          </div>
          {p.description && <p className="mt-1 text-sm text-muted">{p.description}</p>}
          <div className="mt-1 text-xs text-faint">
            Requested by {p.proposedBy ?? 'unknown'} · {new Date(p.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          </div>
        </div>
        <div className="tabular text-xl font-semibold">{formatMoney(p.amountCents, currency)}</div>
      </div>

      {p.recipients.length > 0 && (
        <ul className="mt-4 divide-y divide-line rounded-lg bg-bg/70 text-sm">
          {p.recipients.map((r, i) => (
            <li key={i} className="flex items-center justify-between gap-3 px-3 py-2">
              <span className="min-w-0 truncate">
                {r.name} <span className="text-muted">· {r.receiver}</span>
              </span>
              <span className="tabular shrink-0">{formatMoney(r.amountCents, currency)}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex -space-x-1.5">
            {approvers.map((m) => {
              const vote = p.approvals.find((a) => a.memberId === m.id)
              const tone = vote?.decision === 'APPROVE' ? 'bg-accent text-white' : vote?.decision === 'REJECT' ? 'bg-red text-white' : 'bg-bg text-faint'
              return (
                <span
                  key={m.id}
                  title={`${m.name}${vote ? (vote.decision === 'APPROVE' ? ' approved' : ' rejected') : m.id === p.proposedById ? ' (requester)' : ''}`}
                  className={`inline-flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-semibold ring-2 ring-white ${tone}`}
                >
                  {vote?.decision === 'APPROVE' ? <Check size={12} strokeWidth={3} /> : vote?.decision === 'REJECT' ? <X size={12} strokeWidth={3} /> : m.name.split(' ').map((w) => w[0]).join('').slice(0, 2)}
                </span>
              )
            })}
          </div>
          <span className="text-sm text-muted">
            <span className="tabular font-medium text-ink">{approvals}</span> of {p.requiredApprovals} approvals
          </span>
        </div>
        {open && isApprover && !isMaker && !voted && (
          <div className="flex gap-2">
            <button className="btn btn-ghost !h-8" onClick={() => decide('REJECT')} disabled={pending}>
              Reject
            </button>
            <button className="btn btn-primary !h-8 !bg-accent" onClick={() => decide('APPROVE')} disabled={pending}>
              {pending ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} strokeWidth={3} />} Approve
            </button>
          </div>
        )}
      </div>
      {note && <div className="mt-3 text-xs text-muted">{note}</div>}
      {error && <div className="mt-3 rounded-lg bg-red-soft px-3 py-2 text-sm text-red">{error}</div>}
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
