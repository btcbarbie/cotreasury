'use client'

import { useEffect, useState } from 'react'
import { Loader2, ShieldCheck, Sparkles, X } from 'lucide-react'
import type { Receipt } from '@/app/api/ledger/[entryId]/receipt/route'
import { openAsk } from '@/lib/ask'

/** What the ledger itself recorded, shown when there's no PayPal transaction (imported history). */
export type RecordedEntry = { kind: string; amount: string; date: string; counterparty: string | null; memo: string | null; status: string; note?: string }

/**
 * PayPal's own record of a ledger transaction, fetched live from PayPal, or,
 * for imported history, the entry as recorded. Either way: ask the AI about it.
 */
export function ReceiptDialog({
  entryId,
  title,
  recorded,
  askPrompt,
  onClose,
}: {
  entryId: string
  title: string
  /** Set for imported entries: there's no PayPal transaction to fetch. */
  recorded?: RecordedEntry
  askPrompt: string
  onClose: () => void
}) {
  const [state, setState] = useState<{ receipt?: Receipt; error?: string }>({})

  useEffect(() => {
    let cancelled = false
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    if (recorded) return () => document.removeEventListener('keydown', onKey)
    fetch(`/api/ledger/${entryId}/receipt`, { cache: 'no-store' })
      .then(async (r) => {
        const d = await r.json()
        if (!cancelled) setState(r.ok ? { receipt: d } : { error: d.error ?? 'Could not load the receipt.' })
      })
      .catch(() => !cancelled && setState({ error: 'Could not reach PayPal.' }))
    return () => {
      cancelled = true
      document.removeEventListener('keydown', onKey)
    }
  }, [entryId, onClose, recorded])

  const r = state.receipt
  const rows: [string, string | null][] = r
    ? [
        ['PayPal transaction', r.transactionId],
        ['Status', r.status],
        ['Amount', r.amount],
        ['PayPal fee', r.fee],
        ['Net', r.net],
        [r.kind === 'CAPTURE' ? 'Paid by' : 'Paid to', r.counterparty],
        ['Time', r.createdAt ? new Date(r.createdAt).toLocaleString('en-US') : null],
        ...r.related.map((x) => [x.label, x.value] as [string, string]),
      ]
    : []

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/30 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="card w-full rounded-b-none p-6 shadow-[0_20px_60px_rgba(0,0,0,0.15)] sm:max-w-md sm:rounded-b-[14px]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className={`text-xs font-medium uppercase tracking-wide ${recorded ? 'text-muted' : 'text-blue'}`}>{recorded ? 'Ledger record' : 'PayPal receipt'}</div>
            <div className="mt-0.5 text-lg font-semibold tracking-tight">{title}</div>
          </div>
          <button onClick={onClose} className="text-muted hover:text-ink" aria-label="Close">
            <X size={18} />
          </button>
        </div>
        {recorded && (
          <>
            <dl className="mt-5 divide-y divide-line rounded-xl bg-bg/70 text-sm">
              {(
                [
                  ['Type', recorded.kind],
                  ['Amount', recorded.amount],
                  ['Who', recorded.counterparty],
                  ['For', recorded.memo],
                  ['Status', recorded.status],
                  ['Date', recorded.date],
                ] as [string, string | null][]
              )
                .filter(([, v]) => v)
                .map(([k, v]) => (
                  <div key={k} className="flex items-start justify-between gap-4 px-3.5 py-2.5">
                    <dt className="text-muted">{k}</dt>
                    <dd className="break-all text-right font-medium">{v}</dd>
                  </div>
                ))}
            </dl>
            <p className="mt-4 text-xs text-muted">{recorded.note ?? 'Imported from the group’s earlier records, so there’s no PayPal transaction behind it.'}</p>
          </>
        )}
        {!recorded && !r && !state.error && (
          <div className="mt-6 flex items-center gap-2 text-sm text-muted">
            <Loader2 size={15} className="animate-spin" /> Asking PayPal…
          </div>
        )}
        {state.error && <div className="mt-5 rounded-lg bg-bg px-3 py-2.5 text-sm text-muted">{state.error}</div>}
        {r && (
          <>
            <dl className="mt-5 divide-y divide-line rounded-xl bg-bg/70 text-sm">
              {rows
                .filter(([, v]) => v)
                .map(([k, v]) => (
                  <div key={k} className="flex items-start justify-between gap-4 px-3.5 py-2.5">
                    <dt className="text-muted">{k}</dt>
                    <dd className="break-all text-right font-medium">{v}</dd>
                  </div>
                ))}
            </dl>
            <p className="mt-4 flex items-start gap-2 text-xs text-muted">
              <ShieldCheck size={14} className="mt-px shrink-0 text-accent" />
              Fetched live from PayPal&apos;s API just now, not from CoTreasury&apos;s own records.
            </p>
          </>
        )}
        <div className="mt-5 flex justify-end border-t border-line pt-3 text-xs text-muted">
          <button
            type="button"
            className="inline-flex items-center gap-1.5 underline-offset-2 hover:text-ink hover:underline"
            onClick={() => {
              onClose()
              openAsk(askPrompt)
            }}
          >
            <Sparkles size={12} /> Ask about this payment
          </button>
        </div>
      </div>
    </div>
  )
}
