'use client'

import { useState, useTransition } from 'react'
import { Loader2, Plus, ShieldCheck, Trash2 } from 'lucide-react'
import { formatMoney } from '@/lib/money'
import { proposeRuleChange } from '@/app/c/[id]/actions'
import { Avatar, RoleBadge } from './ui'

type Member = { id: string; name: string; email: string; role: string }
type Tier = { minCents: number; maxCents: number | null; requiredApprovals: number }

const CONTROLS = [
  { title: 'Maker ≠ checker', body: 'Whoever submits a request can never approve it.' },
  { title: 'Amount thresholds', body: 'Bigger spends need more approvers, set by the rules on the left.' },
  { title: 'Self-payment', body: 'A requester paying themselves needs one extra approval.' },
  { title: 'Governed rules', body: 'Changing rules or approvers needs the strictest tier’s approval first.' },
]

export function RulesPanel({
  collectiveId,
  tiers,
  members,
  currency,
  newPayeeRule,
  viewerRole,
  ruleChangePending,
}: {
  collectiveId: string
  tiers: Tier[]
  members: Member[]
  currency: string
  newPayeeRule: boolean
  viewerRole: string
  ruleChangePending: boolean
}) {
  const approvers = members.filter((m) => m.role === 'APPROVER' || m.role === 'ADMIN')
  const canPropose = viewerRole === 'APPROVER' || viewerRole === 'ADMIN'
  const [editing, setEditing] = useState(false)

  if (editing) {
    return <RulesEditor collectiveId={collectiveId} tiers={tiers} members={members} newPayeeRule={newPayeeRule} onClose={() => setEditing(false)} />
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
      <div className="card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 font-medium">
              <ShieldCheck size={16} className="text-accent" /> Spending rules
            </div>
            <p className="mt-1 text-sm text-muted">
              Every payout needs this many approvals before PayPal is asked to send it. The AI Treasurer cannot approve or change these rules.
            </p>
          </div>
          {canPropose && (
            <button className="btn btn-ghost !h-8" onClick={() => setEditing(true)} disabled={ruleChangePending} title={ruleChangePending ? 'A rule change is already waiting for approval' : undefined}>
              Propose a change
            </button>
          )}
        </div>
        {ruleChangePending && (
          <div className="mt-3 rounded-lg bg-violet-soft px-3 py-2 text-sm text-violet">A rule change is waiting for approval in the Activity log.</div>
        )}
        <div className="mt-4 divide-y divide-line">
          {tiers.map((t, i) => (
            <div key={i} className="flex items-center justify-between py-3 text-sm">
              <span className="tabular">{rangeLabel(t, currency)}</span>
              <span className="flex items-center gap-2">
                <span className="flex gap-1">
                  {approvers.map((_, j) => (
                    <span key={j} className={`h-2 w-2 rounded-full ${j < t.requiredApprovals ? 'bg-accent' : 'bg-line-strong'}`} />
                  ))}
                </span>
                <span className="w-24 text-right text-muted">
                  {t.requiredApprovals} of {approvers.length}
                </span>
              </span>
            </div>
          ))}
          <div className="flex items-center justify-between py-3 text-sm">
            <span>First payment to a new recipient</span>
            <span className={`pill ${newPayeeRule ? 'pill-amber' : 'pill-gray'}`}>{newPayeeRule ? '+1 approval' : 'Off'}</span>
          </div>
        </div>
      </div>

      <div className="grid gap-4">
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
        <div className="card p-5">
          <div className="font-medium">Dual controls</div>
          <p className="mt-1 text-sm text-muted">The same safeguards corporate bank accounts use, built in.</p>
          <ul className="mt-3 grid gap-2.5">
            {CONTROLS.map((c) => (
              <li key={c.title} className="text-sm">
                <span className="font-medium">{c.title}.</span> <span className="text-muted">{c.body}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}

function rangeLabel(t: Tier, currency: string) {
  if (t.maxCents === null) return `${formatMoney(t.minCents, currency)} and above`
  if (t.minCents === 0) return `Under ${formatMoney(t.maxCents, currency)}`
  return `${formatMoney(t.minCents, currency)} – ${formatMoney(t.maxCents, currency)}`
}

function RulesEditor({
  collectiveId,
  tiers,
  members,
  newPayeeRule,
  onClose,
}: {
  collectiveId: string
  tiers: Tier[]
  members: Member[]
  newPayeeRule: boolean
  onClose: () => void
}) {
  // Edit tiers as "upper bounds" so ranges always stay contiguous.
  const [rows, setRows] = useState(tiers.map((t) => ({ upTo: t.maxCents === null ? '' : String(t.maxCents / 100), approvals: t.requiredApprovals })))
  const [approverIds, setApproverIds] = useState(members.filter((m) => m.role === 'APPROVER' || m.role === 'ADMIN').map((m) => m.id))
  const [payeeRule, setPayeeRule] = useState(newPayeeRule)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  function build() {
    let min = 0
    return rows.map((r, i) => {
      const last = i === rows.length - 1
      const max = last ? null : Math.round(parseFloat(r.upTo || '0') * 100)
      const tier = { minCents: min, maxCents: max, requiredApprovals: Number(r.approvals) }
      if (max !== null) min = max
      return tier
    })
  }

  function submit() {
    setError(null)
    start(async () => {
      const res = await proposeRuleChange(collectiveId, { tiers: build(), approverIds, newPayeeRule: payeeRule })
      if (!res.ok) return setError(res.error)
      onClose()
    })
  }

  return (
    <div className="card p-5">
      <div className="font-medium">Propose new rules</div>
      <p className="mt-1 text-sm text-muted">
        Nothing changes until the other approvers sign off at the strictest tier. You can&apos;t approve your own change.
      </p>

      <div className="mt-5 label">Approval tiers</div>
      <div className="mt-2 grid gap-2">
        {rows.map((r, i) => {
          const last = i === rows.length - 1
          const from = i === 0 ? '$0' : `$${rows[i - 1].upTo || '?'}`
          return (
            <div key={i} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="w-16 text-muted tabular">{from}</span>
              <span className="text-muted">to</span>
              {last ? (
                <span className="w-28 text-muted">and above</span>
              ) : (
                <div className="relative w-28">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted">$</span>
                  <input
                    className="input !h-9 pl-6 tabular"
                    inputMode="decimal"
                    value={r.upTo}
                    onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, upTo: e.target.value.replace(/[^0-9.]/g, '') } : x)))}
                  />
                </div>
              )}
              <span className="text-muted">needs</span>
              <select
                className="input !h-9 !w-20"
                value={r.approvals}
                onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, approvals: Number(e.target.value) } : x)))}
              >
                {Array.from({ length: Math.max(approverIds.length, 1) }, (_, k) => k + 1).map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
              <span className="text-muted">of {approverIds.length}</span>
              {rows.length > 1 && !last && (
                <button className="ml-auto text-faint hover:text-red" onClick={() => setRows(rows.filter((_, j) => j !== i))} aria-label="Remove tier">
                  <Trash2 size={15} />
                </button>
              )}
            </div>
          )
        })}
        <button
          className="mt-1 inline-flex w-fit items-center gap-1 text-sm text-muted hover:text-ink"
          onClick={() => setRows([...rows.slice(0, -1), { upTo: '', approvals: rows.at(-1)?.approvals ?? 1 }, rows.at(-1)!])}
        >
          <Plus size={14} /> Add tier
        </button>
      </div>

      <div className="mt-6 label">Approvers</div>
      <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
        {members.map((m) => {
          const checked = approverIds.includes(m.id)
          const locked = m.role === 'ADMIN'
          return (
            <label key={m.id} className={`flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm ${locked ? 'opacity-70' : 'hover:bg-bg cursor-pointer'}`}>
              <input
                type="checkbox"
                checked={checked}
                disabled={locked}
                onChange={() => setApproverIds(checked ? approverIds.filter((id) => id !== m.id) : [...approverIds, m.id])}
                className="accent-[var(--accent)]"
              />
              <Avatar name={m.name} size={24} />
              <span className="truncate">{m.name}</span>
              {locked && <span className="ml-auto text-xs text-muted">Admin</span>}
            </label>
          )
        })}
      </div>

      <label className="mt-6 flex cursor-pointer items-center gap-2.5 text-sm">
        <input type="checkbox" checked={payeeRule} onChange={() => setPayeeRule(!payeeRule)} className="accent-[var(--accent)]" />
        First payment to a new recipient needs one extra approval
      </label>

      {error && <div className="mt-4 rounded-lg bg-red-soft px-3 py-2 text-sm text-red">{error}</div>}
      <div className="mt-6 flex justify-end gap-2">
        <button className="btn btn-ghost" onClick={onClose} disabled={pending}>
          Cancel
        </button>
        <button className="btn btn-primary" onClick={submit} disabled={pending}>
          {pending && <Loader2 size={14} className="animate-spin" />} Submit for approval
        </button>
      </div>
    </div>
  )
}
