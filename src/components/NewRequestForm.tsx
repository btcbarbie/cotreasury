'use client'

import { useState, useTransition } from 'react'
import { Loader2, Plus, Send, Trash2, X } from 'lucide-react'
import { submitRequest } from '@/app/c/[id]/actions'
import { formatMoney } from '@/lib/money'

type Row = { name: string; receiver: string; amount: string }
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Manual spending request: same server-side checks as an AI-drafted one. */
export function NewRequestForm({ collectiveId, currency, onClose }: { collectiveId: string; currency: string; onClose: () => void }) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [rows, setRows] = useState<Row[]>([{ name: '', receiver: '', amount: '' }])
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  const cents = (a: string) => Math.round(parseFloat(a || '0') * 100)
  const total = rows.reduce((s, r) => s + (cents(r.amount) || 0), 0)

  function submit() {
    setError(null)
    if (title.trim().length < 3) return setError('Give the request a short title.')
    // Say exactly which field is wrong, e.g. an email missing its ".com".
    for (const [i, r] of rows.entries()) {
      const who = r.name.trim() || `Recipient ${i + 1}`
      if (!r.name.trim()) return setError(`Recipient ${i + 1} needs a name.`)
      if (!EMAIL.test(r.receiver.trim())) {
        const hint = /@[^.\s]+$/.test(r.receiver.trim()) ? ` It looks incomplete. Did you mean ${r.receiver.trim()}.com?` : ''
        return setError(`“${r.receiver.trim() || '(empty)'}” isn’t a full email address for ${who}.${hint}`)
      }
      if (!(cents(r.amount) > 0)) return setError(`Enter an amount for ${who}.`)
    }
    start(async () => {
      const res = await submitRequest(collectiveId, {
        title,
        description,
        recipients: rows.map((r) => ({ name: r.name.trim(), receiver: r.receiver.trim(), amountCents: cents(r.amount) })),
        amountCents: total,
        requiredApprovals: 0, // recomputed on the server from the rules
        flags: [],
      })
      if (!res.ok) return setError(res.error)
      onClose()
    })
  }

  return (
    <div className="card p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-medium">Request payout</div>
          <p className="mt-0.5 text-sm text-muted">Approvers vote on it; the final approval sends it through PayPal Payouts.</p>
        </div>
        <button onClick={onClose} className="text-muted hover:text-ink" aria-label="Close">
          <X size={18} />
        </button>
      </div>

      <div className="mt-4 grid gap-3">
        <input className="input" placeholder="What is it for? e.g. Fall scholarship — Maya Chen" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
        <input className="input" placeholder="Details (optional)" value={description} maxLength={500} onChange={(e) => setDescription(e.target.value)} />
      </div>

      <div className="mt-5 label">Pay to</div>
      <div className="mt-2 grid gap-2">
        {rows.map((r, i) => (
          <div key={i} className="grid grid-cols-[1fr_auto] gap-2 sm:grid-cols-[1fr_1.3fr_8rem_auto]">
            <input className="input" placeholder="Name" value={r.name} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
            <button
              type="button"
              className="text-faint hover:text-red disabled:invisible sm:order-last"
              aria-label="Remove recipient"
              disabled={rows.length === 1}
              onClick={() => setRows(rows.filter((_, j) => j !== i))}
            >
              <Trash2 size={15} />
            </button>
            <input className="input" placeholder="Recipient's email" inputMode="email" value={r.receiver} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, receiver: e.target.value } : x)))} />
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted">$</span>
              <input
                className="input pl-6 tabular"
                inputMode="decimal"
                placeholder="0.00"
                value={r.amount}
                onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, amount: e.target.value.replace(/[^0-9.]/g, '') } : x)))}
              />
            </div>
          </div>
        ))}
      </div>
      <button type="button" className="mt-2 inline-flex items-center gap-1 text-sm text-muted hover:text-ink" onClick={() => setRows([...rows, { name: '', receiver: '', amount: '' }])}>
        <Plus size={14} /> Add recipient
      </button>

      <p className="mt-4 rounded-lg bg-bg px-3 py-2 text-xs leading-relaxed text-muted">
        Recipients don&apos;t need a PayPal account. PayPal emails them; if they don&apos;t have an account they create one for free to claim the
        money, then move it to their bank or card. <span className="font-medium text-ink">Sandbox tip:</span> paying a sandbox personal account
        email shows Paid straight away; any other email shows “Sent · awaiting claim”.
      </p>

      {error && <div className="mt-3 rounded-lg bg-red-soft px-3 py-2 text-sm text-red">{error}</div>}
      <div className="mt-4 flex items-center justify-between gap-3">
        <span className="tabular text-sm text-muted">
          Total <span className="font-semibold text-ink">{formatMoney(total, currency, { cents: true })}</span>
        </span>
        <button className="btn btn-primary" onClick={submit} disabled={pending}>
          {pending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Submit for approval
        </button>
      </div>
    </div>
  )
}
