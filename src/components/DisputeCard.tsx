'use client'

import { useState, useTransition } from 'react'
import { Loader2, Scale } from 'lucide-react'
import { resolveDispute } from '@/app/c/[id]/actions'
import { formatMoney } from '@/lib/money'

/**
 * Money held during a refund dispute with PayPal. Everyone sees it; approvers
 * record PayPal's decision (with its case ID) once PayPal has ruled.
 */
export function DisputeCard({
  hold,
  currency,
  canRecord,
}: {
  hold: { id: string; amountCents: number; proposedBy: string | null; createdAt: string }
  currency: string
  canRecord: boolean
}) {
  const [caseId, setCaseId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const who = hold.proposedBy ?? 'A member'

  function record(outcome: 'MEMBER' | 'GROUP') {
    setError(null)
    start(async () => {
      const r = await resolveDispute(hold.id, { outcome, caseId })
      if (!r.ok) setError(r.error)
    })
  }

  return (
    <div className="card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="pill pill-amber">
              <Scale size={12} /> Refund dispute
            </span>
            <span className="font-medium">Held for {who}</span>
          </div>
          <p className="mt-1 text-sm text-muted">
            The group rejected {who}’s refund and they’ve taken it up with PayPal. This amount stays in the balance but can’t be spent until PayPal decides.
          </p>
        </div>
        <div className="tabular text-xl font-semibold">{formatMoney(hold.amountCents, currency, { cents: true })}</div>
      </div>

      {canRecord && (
        <div className="mt-4 rounded-lg bg-bg/70 p-3 text-sm">
          <div className="font-medium">Record PayPal’s decision</div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input className="input !h-9 !w-48" placeholder="PayPal case ID, e.g. PP-D-12345" value={caseId} onChange={(e) => setCaseId(e.target.value)} />
            <button className="btn btn-ghost !h-9 bg-white" onClick={() => record('MEMBER')} disabled={pending}>
              {pending && <Loader2 size={14} className="animate-spin" />} PayPal sided with {who.split(' ')[0]}
            </button>
            <button className="btn btn-ghost !h-9 bg-white" onClick={() => record('GROUP')} disabled={pending}>
              PayPal sided with the group
            </button>
          </div>
          <p className="mt-2 text-xs text-muted">
            For {who.split(' ')[0]}: the held amount is paid to them through PayPal and they leave. For the group: it returns to the pot and they leave without a refund.
            Either way it’s recorded in the activity log with the case ID.
          </p>
        </div>
      )}
      {error && <div className="mt-3 rounded-lg bg-red-soft px-3 py-2 text-sm text-red">{error}</div>}
    </div>
  )
}
