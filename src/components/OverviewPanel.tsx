'use client'

import { useState, useTransition } from 'react'
import { CalendarClock, Check, Loader2, Plus, Repeat, Target, X } from 'lucide-react'
import { formatMoney } from '@/lib/money'
import { addGoal } from '@/app/c/[id]/actions'
import type { GoalProgress } from '@/lib/goals'
import { Avatar } from './ui'

export type MoneySummary = {
  inCents: number
  outCents: number
  balanceCents: number
  pendingInCents: number
  pendingOutCents: number
  awaitingApprovalCents: number
}

export function OverviewPanel({
  collectiveId,
  currency,
  summary,
  goals,
  canManage,
  viewerId,
}: {
  collectiveId: string
  currency: string
  summary: MoneySummary
  goals: GoalProgress[]
  canManage: boolean
  viewerId: string
}) {
  const [adding, setAdding] = useState(false)
  const m = (c: number) => formatMoney(c, currency)
  const waiting = [
    summary.pendingInCents > 0 && `${m(summary.pendingInCents)} coming in, waiting for PayPal`,
    summary.pendingOutCents > 0 && `${m(summary.pendingOutCents)} being paid out`,
    summary.awaitingApprovalCents > 0 && `${m(summary.awaitingApprovalCents)} waiting for approval`,
  ].filter(Boolean) as string[]

  return (
    <div className="grid gap-5">
      {/* The whole treasury in one line: what came in, what went out, what's left. */}
      <div className="card p-5">
        <div className="grid grid-cols-[1fr_auto_1fr_auto_1fr] items-end gap-2 sm:gap-4">
          <Figure label="Money in" value={m(summary.inCents)} tone="text-accent" sign="+" />
          <span className="pb-1 text-xl text-faint">−</span>
          <Figure label="Money out" value={m(summary.outCents)} />
          <span className="pb-1 text-xl text-faint">=</span>
          <Figure label="In the treasury now" value={m(summary.balanceCents)} strong />
        </div>
        <p className="mt-3 text-xs text-muted">
          Only money PayPal has confirmed is counted.
          {waiting.length > 0 && <> Not counted yet: {waiting.join(' · ')}.</>}
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-semibold tracking-tight">What the collective is working towards</h3>
        {canManage && !adding && (
          <button className="btn btn-ghost !h-8" onClick={() => setAdding(true)}>
            <Plus size={14} /> Add goal
          </button>
        )}
      </div>

      {adding && <GoalForm collectiveId={collectiveId} onClose={() => setAdding(false)} />}

      {goals.length === 0 && !adding ? (
        <div className="card px-5 py-10 text-center text-sm text-muted">
          No goals yet. {canManage ? 'Add one so members know what to contribute and by when.' : 'An approver can add one.'}
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {goals.map((g) => (
            <GoalCard key={g.id} g={g} currency={currency} viewerId={viewerId} />
          ))}
        </div>
      )}
    </div>
  )
}

function Figure({ label, value, tone, sign, strong }: { label: string; value: string; tone?: string; sign?: string; strong?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] uppercase tracking-wide text-muted sm:text-xs">{label}</div>
      <div className={`tabular truncate font-semibold tracking-tight ${strong ? 'text-xl sm:text-3xl' : 'text-base sm:text-2xl'} ${tone ?? ''}`}>
        {sign}
        {value}
      </div>
    </div>
  )
}

function GoalCard({ g, currency, viewerId }: { g: GoalProgress; currency: string; viewerId: string }) {
  const pct = g.targetCents > 0 ? Math.min(100, Math.round((g.collectedCents / g.targetCents) * 100)) : 0
  const due = g.dueDate ? new Date(g.dueDate) : null
  const daysLeft = g.daysLeft
  const me = g.members.find((x) => x.id === viewerId)
  const owe = me ? Math.max(0, g.expectedPerMemberCents - me.paidCents) : 0

  function contribute() {
    window.dispatchEvent(new CustomEvent('cotreasury:contribute', { detail: { goalId: g.id, amountCents: owe || g.perMemberCents } }))
  }

  return (
    <div className="card p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-xs text-muted">
            {g.kind === 'MONTHLY' ? <Repeat size={13} /> : <Target size={13} />}
            {g.kind === 'MONTHLY' ? `Monthly pledge · month ${g.monthsDue}` : 'Goal'}
          </div>
          <div className="mt-1 font-semibold tracking-tight">{g.title}</div>
          <div className="mt-0.5 text-sm text-muted">
            {formatMoney(g.perMemberCents, currency)} per member{g.kind === 'MONTHLY' ? ' each month' : ''}
            {due && (
              <span className={`ml-2 inline-flex items-center gap-1 ${daysLeft !== null && daysLeft < 0 ? 'text-red' : daysLeft !== null && daysLeft <= 14 ? 'text-amber' : ''}`}>
                <CalendarClock size={13} />
                {daysLeft !== null && daysLeft < 0 ? `overdue since ${due.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : `due ${due.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`}
              </span>
            )}
          </div>
        </div>
        <div className="text-right">
          <div className="tabular text-lg font-semibold">{formatMoney(g.collectedCents, currency)}</div>
          <div className="tabular text-xs text-muted">of {formatMoney(g.targetCents, currency)}</div>
        </div>
      </div>

      <div className="mt-4 h-2 overflow-hidden rounded-full bg-bg">
        <div className="h-full rounded-full bg-gradient-to-r from-accent to-teal transition-all" style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-2 flex justify-between text-xs text-muted">
        <span>
          {g.upToDateCount} of {g.members.length} members {g.kind === 'MONTHLY' ? 'up to date' : 'paid in full'}
        </span>
        {g.pendingCents > 0 && <span>{formatMoney(g.pendingCents, currency)} waiting for PayPal</span>}
      </div>

      <div className="mt-4 flex flex-wrap gap-1.5">
        {g.members.map((x) => (
          <span
            key={x.id}
            title={`${x.name}: ${formatMoney(x.paidCents, currency)} of ${formatMoney(g.expectedPerMemberCents, currency)}`}
            className={`inline-flex items-center gap-1 rounded-full py-0.5 pl-0.5 pr-2 text-xs ring-1 ${
              x.upToDate ? 'bg-accent-soft text-accent ring-accent/20' : x.paidCents > 0 ? 'bg-amber-soft text-amber ring-amber/20' : 'bg-surface text-muted ring-line'
            }`}
          >
            <Avatar name={x.name} size={18} />
            {x.name.split(' ')[0]}
            {x.upToDate && <Check size={11} strokeWidth={3} />}
          </span>
        ))}
      </div>

      {me && (
        <div className="mt-4 flex items-center justify-between gap-3 rounded-lg bg-bg px-3 py-2 text-sm">
          <span className="text-muted">
            {owe > 0 ? (
              <>
                You have <span className="font-medium text-ink">{formatMoney(owe, currency)}</span> left to pay
              </>
            ) : (
              <span className="text-accent">You&apos;re paid up for this goal</span>
            )}
          </span>
          {owe > 0 && (
            <button className="btn btn-primary !h-8" onClick={contribute}>
              Pay {formatMoney(owe, currency)}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function GoalForm({ collectiveId, onClose }: { collectiveId: string; onClose: () => void }) {
  const [title, setTitle] = useState('')
  const [kind, setKind] = useState<'TARGET' | 'MONTHLY'>('TARGET')
  const [amount, setAmount] = useState('')
  const [due, setDue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  function save() {
    setError(null)
    start(async () => {
      const r = await addGoal(collectiveId, { title, kind, perMemberCents: Math.round(parseFloat(amount || '0') * 100), dueDate: kind === 'TARGET' ? due || null : null })
      if (!r.ok) return setError(r.error)
      onClose()
    })
  }

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between">
        <div className="font-medium">New goal</div>
        <button onClick={onClose} className="text-muted hover:text-ink" aria-label="Close">
          <X size={18} />
        </button>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <input className="input sm:col-span-2" placeholder="e.g. Spring 2027 awards" value={title} onChange={(e) => setTitle(e.target.value)} />
        <div className="flex rounded-[9px] border border-line-strong p-0.5 text-sm">
          {(['TARGET', 'MONTHLY'] as const).map((k) => (
            <button key={k} type="button" onClick={() => setKind(k)} className={`flex-1 rounded-md px-3 py-1.5 font-medium transition ${kind === k ? 'bg-ink text-white' : 'text-muted'}`}>
              {k === 'TARGET' ? 'One-off goal' : 'Monthly pledge'}
            </button>
          ))}
        </div>
        <div className="relative">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted">$</span>
          <input className="input pl-6 tabular" inputMode="decimal" placeholder={kind === 'MONTHLY' ? 'per member / month' : 'per member'} value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} />
        </div>
        {kind === 'TARGET' && (
          <label className="sm:col-span-2 text-sm text-muted">
            Due date <input type="date" className="input mt-1" value={due} onChange={(e) => setDue(e.target.value)} />
          </label>
        )}
      </div>
      {error && <div className="mt-3 rounded-lg bg-red-soft px-3 py-2 text-sm text-red">{error}</div>}
      <div className="mt-4 flex justify-end">
        <button className="btn btn-primary" onClick={save} disabled={pending}>
          {pending && <Loader2 size={14} className="animate-spin" />} Add goal
        </button>
      </div>
    </div>
  )
}
