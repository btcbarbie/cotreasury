'use client'

import { useState, useTransition } from 'react'
import { Loader2, Plus, ShieldCheck, Trash2 } from 'lucide-react'
import { formatMoney } from '@/lib/money'
import { proposeRuleChange } from '@/app/c/[id]/actions'
import { Avatar } from './ui'
import { EXIT_POLICIES, type ExitPolicy } from '@/lib/exitPolicy'

type Member = { id: string; name: string; email: string; role: string }
type Tier = { minCents: number; maxCents: number | null; requiredApprovals: number }

export const MODES = [
  { id: 'FIXED', label: 'Fixed approvers', hint: 'The approvers vote on every payout.' },
  { id: 'RANDOM', label: 'Random review panel', hint: 'Each payout gets reviewers drawn at random from all members, hidden from the requester until decided.' },
  { id: 'MIXED', label: 'Mixed panel', hint: 'One seat drawn from the approvers, the rest from all members, hidden until decided.' },
]

const CONTROLS = [
  { title: 'Maker ≠ checker', body: 'Whoever submits a request can never approve it.' },
  { title: 'Amount thresholds', body: 'Bigger spends need more approvers, set by the rules on the left.' },
  { title: 'New recipients', body: 'The first payment to someone the treasury has never paid needs one extra approval.' },
  { title: 'Self-payment', body: 'A requester paying themselves needs one extra approval.' },
  { title: 'Governed rules', body: 'Changing rules or approvers needs the strictest tier’s approval first.' },
]

export function RulesPanel({
  collectiveId,
  tiers,
  members,
  currency,
  approvalMode,
  exitPolicy,
  viewerRole,
  ruleChangePending,
}: {
  collectiveId: string
  tiers: Tier[]
  members: Member[]
  currency: string
  approvalMode: string
  exitPolicy: string
  viewerRole: string
  ruleChangePending: boolean
}) {
  const approvers = members.filter((m) => m.role === 'APPROVER' || m.role === 'ADMIN')
  const canPropose = viewerRole === 'APPROVER' || viewerRole === 'ADMIN'
  const [editing, setEditing] = useState(false)

  if (editing) {
    return (
      <RulesEditor collectiveId={collectiveId} tiers={tiers} members={members} approvalMode={approvalMode} exitPolicy={exitPolicy} onClose={() => setEditing(false)} />
    )
  }

  return (
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
          <div className="flex items-start justify-between gap-4 py-3 text-sm">
            <span>
              Who reviews payouts
              <span className="block text-xs text-muted">{MODES.find((m) => m.id === approvalMode)?.hint}</span>
            </span>
            <span className="pill pill-violet shrink-0">{MODES.find((m) => m.id === approvalMode)?.label}</span>
          </div>
          <div className="flex items-start justify-between gap-4 py-3 text-sm">
            <span>
              If someone leaves or the group closes
              <span className="block text-xs text-muted">{EXIT_POLICIES.find((p) => p.id === exitPolicy)?.hint}</span>
            </span>
            <span className="pill pill-violet shrink-0">{EXIT_POLICIES.find((p) => p.id === exitPolicy)?.label}</span>
          </div>
          <div className="flex items-start justify-between gap-4 py-3 text-sm">
            <span>
              Approvers
              <span className="block text-xs text-muted">Chosen by the group, not by who contributes most.</span>
            </span>
            <span className="flex flex-wrap justify-end gap-1.5">
              {approvers.map((m) => (
                <span key={m.id} className="inline-flex items-center gap-1 rounded-full bg-bg py-0.5 pl-0.5 pr-2 text-xs">
                  <Avatar name={m.name} size={18} />
                  {m.name.split(' ')[0]}
                </span>
              ))}
            </span>
          </div>
      </div>
      <details className="mt-2 rounded-lg bg-bg/70 px-3 py-2 text-sm">
        <summary className="cursor-pointer text-muted">Built-in safeguards ({CONTROLS.length})</summary>
        <ul className="mt-2 grid gap-1.5 pb-1">
          {CONTROLS.map((c) => (
            <li key={c.title}>
              <span className="font-medium">{c.title}.</span> <span className="text-muted">{c.body}</span>
            </li>
          ))}
        </ul>
      </details>
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
  approvalMode,
  exitPolicy,
  onClose,
}: {
  collectiveId: string
  tiers: Tier[]
  members: Member[]
  approvalMode: string
  exitPolicy: string
  onClose: () => void
}) {
  const [mode, setMode] = useState(approvalMode)
  const [exit, setExit] = useState(exitPolicy as ExitPolicy)
  const [removeIds, setRemoveIds] = useState<string[]>([])
  // Edit tiers as "upper bounds" so ranges always stay contiguous.
  const [rows, setRows] = useState(tiers.map((t) => ({ upTo: t.maxCents === null ? '' : String(t.maxCents / 100), approvals: t.requiredApprovals })))
  const [approverIds, setApproverIds] = useState(members.filter((m) => m.role === 'APPROVER' || m.role === 'ADMIN').map((m) => m.id))
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
      const res = await proposeRuleChange(collectiveId, {
        tiers: build(),
        approverIds,
        newPayeeRule: true,
        approvalMode: mode as 'FIXED' | 'RANDOM' | 'MIXED',
        exitPolicy: exit,
        removeMemberIds: removeIds,
      })
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

      <div className="mt-6 label">Who reviews payouts</div>
      <div className="mt-2 grid gap-2">
        {MODES.map((m) => (
          <label key={m.id} className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 text-sm ${mode === m.id ? 'border-ink bg-bg' : 'border-line'}`}>
            <input type="radio" name="mode" checked={mode === m.id} onChange={() => setMode(m.id)} className="mt-0.5 accent-[var(--accent)]" />
            <span>
              <span className="font-medium">{m.label}</span>
              <span className="block text-muted">{m.hint}</span>
            </span>
          </label>
        ))}
        {mode !== 'FIXED' && members.length < 8 && (
          <p className="text-xs text-amber">With {members.length} members it&apos;s easy to guess who was drawn. Random panels work best from about 8 members.</p>
        )}
        {mode !== 'FIXED' && <p className="text-xs text-muted">Changes to these rules are still approved by the named approvers.</p>}
      </div>

      <div className="mt-6 label">If someone leaves or the group closes</div>
      <div className="mt-2 grid gap-2">
        {EXIT_POLICIES.map((p) => (
          <label key={p.id} className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 text-sm ${exit === p.id ? 'border-ink bg-bg' : 'border-line'}`}>
            <input type="radio" name="exit" checked={exit === p.id} onChange={() => setExit(p.id)} className="mt-0.5 accent-[var(--accent)]" />
            <span>
              <span className="font-medium">{p.label}</span>
              <span className="block text-muted">{p.hint}</span>
            </span>
          </label>
        ))}
      </div>

      <div className="mt-6 label">Remove from the group</div>
      <p className="mt-1 text-xs text-muted">Former members keep their history in the ledger but can no longer act. Approvers must be unticked above first.</p>
      <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
        {members
          .filter((m) => m.role !== 'ADMIN')
          .map((m) => {
            const marked = removeIds.includes(m.id)
            const blocked = approverIds.includes(m.id)
            return (
              <label key={m.id} className={`flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm ${blocked ? 'opacity-50' : 'cursor-pointer hover:bg-bg'}`}>
                <input
                  type="checkbox"
                  checked={marked}
                  disabled={blocked}
                  onChange={() => setRemoveIds(marked ? removeIds.filter((id) => id !== m.id) : [...removeIds, m.id])}
                  className="accent-[var(--red)]"
                />
                <span className={`truncate ${marked ? 'text-red line-through' : ''}`}>{m.name}</span>
              </label>
            )
          })}
      </div>

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
