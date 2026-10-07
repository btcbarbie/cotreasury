'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { AlertTriangle, Check, Loader2, Scale, UserCheck } from 'lucide-react'
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
            You can&apos;t approve your own requests.
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
      setDone(decision === 'REJECT' ? 'Rejected' : deciding && !isRule ? 'Approved. The group’s PayPal account is sending it.' : 'Approved')
    })
  }

  return (
    <div className="px-5 py-4">
      <div className="flex items-baseline justify-between gap-3">
        <div className="min-w-0 font-semibold tracking-tight">
          {isRule && <Scale size={14} className="mr-1.5 inline text-violet" />}
          {p.title}
        </div>
        {!isRule && <div className="tabular shrink-0 text-lg font-semibold">{formatMoney(p.amountCents, currency)}</div>}
      </div>

      {isRule ? (
        p.description && <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-ink/80">{p.description}</p>
      ) : (
        <div className="mt-3">
          <div className="text-xs text-muted">{p.requestedBy ?? 'Someone'} wants to pay, from the group&apos;s account:</div>
          <ul className="mt-1.5 grid gap-1 text-sm">
            {p.recipients.map((r) => (
              <li key={r.receiver} className="flex justify-between gap-3">
                <span className="truncate">{r.name}</span>
                <span className="tabular text-muted">{formatMoney(r.amountCents, currency)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {p.flags.length > 0 && (
        <div className="mt-3 flex items-start gap-1.5 text-xs text-amber">
          <AlertTriangle size={12} className="mt-0.5 shrink-0" />
          <span>{p.flags.join(' · ')}</span>
        </div>
      )}

      <div className="mt-3 flex items-center gap-2 text-xs text-muted">
        <span className="flex gap-1">
          {Array.from({ length: p.required }, (_, i) => (
            <span key={i} className={`h-1.5 w-4 rounded-full ${i < p.approvals ? 'bg-accent' : 'bg-line-strong'}`} />
          ))}
        </span>
        {p.approvals} of {p.required} approvals
      </div>

      {done ? (
        <div className="mt-4 flex items-center gap-1.5 text-sm font-medium text-accent">
          <Check size={14} strokeWidth={3} /> {done}
        </div>
      ) : (
        <>
          {deciding && !isRule && (
            <p className="mt-4 rounded-lg bg-bg px-3 py-2 text-xs leading-relaxed text-muted">
              Yours is the final approval. The group&apos;s PayPal account sends {formatMoney(p.amountCents, currency)} to the recipients; nothing comes from your own account.
            </p>
          )}
          <div className="mt-3 flex justify-end gap-2">
            <button className="btn btn-ghost !h-9" onClick={() => decide('REJECT')} disabled={pending}>
              Reject
            </button>
            <button className="btn btn-primary !h-9 !bg-accent" onClick={() => decide('APPROVE')} disabled={pending}>
              {pending ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} strokeWidth={3} />}
              {deciding && !isRule ? 'Approve & release payout' : 'Approve'}
            </button>
          </div>
        </>
      )}
      {error && <div className="mt-2 rounded-lg bg-red-soft px-3 py-2 text-sm text-red">{error}</div>}
    </div>
  )
}
