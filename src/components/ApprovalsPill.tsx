'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { AlertTriangle, Check, Loader2, Scale, UserCheck, X } from 'lucide-react'
import { decideRequest } from '@/app/c/[id]/actions'
import { formatMoney } from '@/lib/money'

export type PendingApproval = {
  id: string
  kind: string
  title: string
  description: string | null
  amountCents: number
  requestedBy: string | null
  approvals: number
  required: number
  recipients: { name: string; receiver: string; amountCents: number }[]
  flags: string[]
}

/** "N payouts need your approval": approvers can vote right from the dashboard. */
export function ApprovalsPill({ items, currency }: { items: PendingApproval[]; currency: string }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (items.length === 0) return null
  const payouts = items.filter((i) => i.kind !== 'RULE_CHANGE').length
  const label =
    payouts === items.length
      ? `${items.length} payout${items.length === 1 ? ' needs' : 's need'} your approval`
      : `${items.length} request${items.length === 1 ? ' needs' : 's need'} your approval`

  return (
    <div ref={ref} className="relative w-fit">
      <button
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-2 rounded-full border border-dashed border-red/50 bg-red-soft/60 px-3 py-1 text-sm font-medium text-red transition hover:bg-red-soft"
      >
        <UserCheck size={13} />
        {label}
      </button>
      {open && (
        <div className="card absolute left-0 top-full z-30 mt-2 w-[min(30rem,calc(100vw-2rem))] overflow-hidden shadow-[0_12px_40px_rgba(0,0,0,0.12)]">
          <div className="max-h-[28rem] divide-y divide-line overflow-y-auto">
            {items.map((p) => (
              <ApprovalItem key={p.id} p={p} currency={currency} />
            ))}
          </div>
          <div className="border-t border-line bg-bg/60 px-4 py-2 text-xs text-muted">
            You can&apos;t approve your own requests. The final approval sends the money through PayPal.
          </div>
        </div>
      )}
    </div>
  )
}

function ApprovalItem({ p, currency }: { p: PendingApproval; currency: string }) {
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const isRule = p.kind === 'RULE_CHANGE'
  const deciding = p.approvals + 1 >= p.required

  function decide(decision: 'APPROVE' | 'REJECT') {
    setError(null)
    start(async () => {
      const r = await decideRequest(p.id, decision)
      if (!r.ok) return setError(r.error)
      setDone(decision === 'REJECT' ? 'Rejected' : deciding && !isRule ? 'Approved, PayPal is sending it' : 'Approved')
    })
  }

  return (
    <div className="px-4 py-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 font-medium">
            {isRule && <Scale size={14} className="text-violet" />}
            <span className="truncate">{p.title}</span>
          </div>
          <div className="text-xs text-muted">
            Requested by {p.requestedBy ?? 'unknown'} · {p.approvals} of {p.required} approvals
          </div>
        </div>
        {!isRule && <div className="tabular shrink-0 font-semibold">{formatMoney(p.amountCents, currency)}</div>}
      </div>
      {isRule && p.description && <p className="mt-1.5 whitespace-pre-line text-sm text-ink/80">{p.description}</p>}
      {p.recipients.length > 0 && (
        <div className="mt-1.5 text-sm text-muted">
          To {p.recipients.map((r) => `${r.name} (${formatMoney(r.amountCents, currency)})`).join(', ')}
        </div>
      )}
      {p.flags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {p.flags.map((f) => (
            <span key={f} className="pill pill-amber !h-[20px] !text-[11px]">
              <AlertTriangle size={11} /> {f}
            </span>
          ))}
        </div>
      )}
      {done ? (
        <div className="mt-3 flex items-center gap-1.5 text-sm font-medium text-accent">
          <Check size={14} strokeWidth={3} /> {done}
        </div>
      ) : (
        <div className="mt-3 flex justify-end gap-2">
          <button className="btn btn-ghost !h-8" onClick={() => decide('REJECT')} disabled={pending}>
            <X size={14} /> Reject
          </button>
          <button className="btn btn-primary !h-8 !bg-accent" onClick={() => decide('APPROVE')} disabled={pending}>
            {pending ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} strokeWidth={3} />}
            {deciding && !isRule ? 'Approve & pay via PayPal' : 'Approve'}
          </button>
        </div>
      )}
      {error && <div className="mt-2 rounded-lg bg-red-soft px-3 py-2 text-sm text-red">{error}</div>}
    </div>
  )
}
