'use client'

import { useState, useTransition } from 'react'
import { Archive, Loader2, LogOut } from 'lucide-react'
import { disputeRefund, leaveTreasury, proposeClose } from '@/app/c/[id]/actions'
import { formatMoney } from '@/lib/money'
import { EXIT_POLICIES } from '@/lib/exitPolicy'
import { RECEIVER_TYPES, type ReceiverType } from '@/lib/recipients'

export type ExitInfo = {
  policy: string
  status: string
  lock: string | null
  availableCents: number
  strictestApprovals: number
  openPayouts: number
  rulePending: boolean
  me: { contributedCents: number; shareCents: number }
  /** The viewer asked to leave and their refund is waiting for approval or payment. */
  meLeaving: boolean
  myRefundCents: number
  /** The viewer's most recent refund request was rejected (they're still a member). */
  rejectedRefund: { amountCents: number; at: string } | null
  closeShares: { memberId: string; name: string; contributedCents: number; shareCents: number }[]
}

/** What happens to money when someone leaves or the group closes, and the buttons to do either. */
export function ExitPanel({ collectiveId, currency, viewerRole, exit }: { collectiveId: string; currency: string; viewerRole: string; exit: ExitInfo }) {
  const m = (c: number) => formatMoney(c, currency, { cents: true })
  const policy = EXIT_POLICIES.find((p) => p.id === exit.policy) ?? EXIT_POLICIES[2]

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="font-medium">If someone leaves or the group closes</div>
          <span className="pill pill-violet">{policy.label}</span>
        </div>
        <p className="mt-2 text-sm text-muted">{policy.hint}</p>
        <p className="mt-2 text-xs text-muted">The group can change this with a rule change. CoTreasury does the maths from the ledger; people approve every payout.</p>
        {exit.lock ? (
          <div className="mt-4 rounded-lg bg-bg px-3 py-2 text-sm text-muted">{exit.lock}</div>
        ) : viewerRole === 'DISPUTING' ? (
          <div className="mt-4 rounded-lg bg-amber-soft px-3 py-2 text-sm text-amber">
            You’re taking your refund up with PayPal. {m(exit.myRefundCents)} is held: the group can’t spend it until PayPal decides. You stay listed meanwhile, but can’t vote.
          </div>
        ) : exit.meLeaving ? (
          <div className="mt-4 rounded-lg bg-amber-soft px-3 py-2 text-sm text-amber">
            You’ve asked to leave. Your {m(exit.myRefundCents)} refund is waiting for the group to approve and pay it. You stay a member until then; if it’s rejected, you simply stay.
          </div>
        ) : viewerRole === 'ADMIN' ? (
          <div className="mt-4 rounded-lg bg-bg px-3 py-2 text-sm text-muted">As the admin you can’t leave. To end the group, propose closing the treasury.</div>
        ) : (
          <LeaveForm collectiveId={collectiveId} policy={exit.policy} me={exit.me} availableCents={exit.availableCents} m={m} rejected={exit.rejectedRefund} />
        )}
      </div>

      <div className="card p-5">
        <div className="flex items-center gap-2 font-medium">
          <Archive size={16} className="text-muted" /> Close the treasury
        </div>
        <p className="mt-1 text-sm text-muted">
          Pays out what’s left, then makes the treasury read-only. The ledger and activity log stay here for the record. Needs {exit.strictestApprovals} approval
          {exit.strictestApprovals === 1 ? '' : 's'}, like the biggest payments; while the group votes, new contributions and requests pause.
        </p>
        {exit.lock ? (
          <div className="mt-4 rounded-lg bg-bg px-3 py-2 text-sm text-muted">{exit.status === 'OPEN' ? 'The close proposal is in Needs attention on the Overview tab.' : exit.lock}</div>
        ) : exit.openPayouts > 0 ? (
          <div className="mt-4 rounded-lg bg-bg px-3 py-2 text-sm text-muted">
            {exit.openPayouts} payout request{exit.openPayouts === 1 ? ' is' : 's are'} still open. Finish or reject {exit.openPayouts === 1 ? 'it' : 'them'} first, so the final numbers are settled.
          </div>
        ) : exit.rulePending ? (
          <div className="mt-4 rounded-lg bg-bg px-3 py-2 text-sm text-muted">A rule change is waiting for approval. Settle it before proposing to close.</div>
        ) : (
          <CloseForm collectiveId={collectiveId} policy={exit.policy} availableCents={exit.availableCents} shares={exit.closeShares} m={m} />
        )}
      </div>
    </div>
  )
}

function LeaveForm({
  collectiveId,
  policy,
  me,
  availableCents,
  m,
  rejected,
}: {
  collectiveId: string
  policy: string
  me: ExitInfo['me']
  availableCents: number
  m: (c: number) => string
  rejected: ExitInfo['rejectedRefund']
}) {
  const [confirming, setConfirming] = useState(false)
  const [amount, setAmount] = useState((me.shareCents / 100).toFixed(2))
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const maxCents = Math.min(me.contributedCents, availableCents)

  function leave() {
    setError(null)
    start(async () => {
      const r = await leaveTreasury(collectiveId, policy === 'VOTE' ? { refundCents: Math.round(parseFloat(amount || '0') * 100) } : {})
      if (!r.ok) setError(r.error)
    })
  }

  function takeToPayPal() {
    setError(null)
    start(async () => {
      const r = await disputeRefund(collectiveId)
      if (!r.ok) setError(r.error)
    })
  }

  return (
    <div className="mt-4 rounded-xl border border-line p-4 text-sm">
      {rejected && (
        <div className="mb-3 rounded-lg bg-amber-soft px-3 py-2 text-amber">
          The group rejected your {m(rejected.amountCents)} refund on {new Date(rejected.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}. You’re still a member.
          You can ask again, or take it up with PayPal: your contributions and this decision are recorded in the ledger and the sealed activity log. If you take it to PayPal,
          you’ll stay listed but can’t vote, and your {m(rejected.amountCents)} is held so the group can’t spend it until PayPal decides.
          <div className="mt-2">
            <button className="btn btn-ghost !h-8 bg-white" onClick={takeToPayPal} disabled={pending}>
              Take it up with PayPal
            </button>
          </div>
        </div>
      )}
      <div className="font-medium">{rejected ? 'Ask again' : 'Leave the treasury'}</div>
      <p className="mt-1 text-muted">
        You’ve put in <span className="font-medium text-ink">{m(me.contributedCents)}</span>.{' '}
        {policy === 'UNSPENT_SHARE' &&
          (me.shareCents > 0 ? (
            <>
              If you leave now you’d get back <span className="font-medium text-ink">{m(me.shareCents)}</span>, your share of what’s left. The group approves the refund like any payout.
            </>
          ) : (
            'There’s nothing left to refund right now.'
          ))}
        {policy === 'NO_REFUNDS' && 'This group gives no refunds: what you gave stays with the cause.'}
        {policy === 'VOTE' && (
          <>
            You can ask for up to {m(maxCents)} back; your share of what’s left would be {m(me.shareCents)}. The group votes on it.
          </>
        )}
      </p>
      {policy === 'VOTE' && maxCents > 0 && (
        <label className="mt-3 flex items-center gap-2 text-muted">
          Ask for
          <span className="relative w-32">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted">$</span>
            <input className="input !h-9 pl-6 tabular" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} />
          </span>
        </label>
      )}
      {error && <div className="mt-3 rounded-lg bg-red-soft px-3 py-2 text-red">{error}</div>}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {confirming ? (
          <>
            <span className="text-muted">You’ll stop being a member. Your history stays in the ledger.</span>
            <button className="btn btn-ghost !h-8" onClick={() => setConfirming(false)} disabled={pending}>
              Cancel
            </button>
            <button className="btn !h-8 bg-red text-white hover:bg-red/90" onClick={leave} disabled={pending}>
              {pending ? <Loader2 size={14} className="animate-spin" /> : <LogOut size={14} />} Leave
            </button>
          </>
        ) : (
          <button className="btn btn-ghost !h-8" onClick={() => setConfirming(true)}>
            <LogOut size={14} /> Leave the treasury
          </button>
        )}
      </div>
    </div>
  )
}

function CloseForm({
  collectiveId,
  policy,
  availableCents,
  shares,
  m,
}: {
  collectiveId: string
  policy: string
  availableCents: number
  shares: ExitInfo['closeShares']
  m: (c: number) => string
}) {
  const [mode, setMode] = useState<'SPLIT' | 'SINGLE'>(policy === 'NO_REFUNDS' ? 'SINGLE' : 'SPLIT')
  const [name, setName] = useState('')
  const [type, setType] = useState<ReceiverType>('EMAIL')
  const [receiver, setReceiver] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [pending, start] = useTransition()
  const paid = shares.filter((s) => s.shareCents > 0)

  function propose() {
    setError(null)
    start(async () => {
      const r = await proposeClose(collectiveId, mode === 'SPLIT' ? { mode } : { mode, name, receiver, receiverType: type })
      if (!r.ok) return setError(r.error)
      setDone(true)
    })
  }

  if (done) return <div className="mt-4 rounded-lg bg-accent-soft px-3 py-2 text-sm text-accent">Proposed. The approvers can vote on it in Needs attention.</div>

  return (
    <div className="mt-4 grid gap-3 text-sm">
      {policy === 'VOTE' && (
        <div className="flex rounded-[9px] border border-line-strong p-0.5">
          {(['SPLIT', 'SINGLE'] as const).map((k) => (
            <button key={k} type="button" onClick={() => setMode(k)} className={`flex-1 rounded-md px-3 py-1.5 font-medium transition ${mode === k ? 'bg-ink text-white' : 'text-muted'}`}>
              {k === 'SPLIT' ? 'Split by contribution' : 'Send it to one recipient'}
            </button>
          ))}
        </div>
      )}
      <div className="text-muted">
        <span className="font-medium text-ink">{m(availableCents)}</span> is left to settle.
      </div>
      {mode === 'SPLIT' ? (
        paid.length > 0 ? (
          <ul className="divide-y divide-line rounded-lg bg-bg/70">
            {paid.map((s) => (
              <li key={s.memberId} className="flex items-center justify-between gap-3 px-3 py-2">
                <span className="min-w-0 truncate">
                  {s.name} <span className="text-muted">· put in {m(s.contributedCents)}</span>
                </span>
                <span className="tabular">{m(s.shareCents)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="text-muted">Nothing to split: the treasury closes as soon as it’s approved.</div>
        )
      ) : (
        <div className="grid gap-2 sm:grid-cols-[1fr_1.4fr]">
          <input className="input" placeholder="Who gets what’s left, e.g. a charity or the company" value={name} onChange={(e) => setName(e.target.value)} />
          <div className="flex">
            <select className="input !w-auto shrink-0 rounded-r-none border-r-0 !pr-7" aria-label="Send by" value={type} onChange={(e) => setType(e.target.value as ReceiverType)}>
              {RECEIVER_TYPES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
            <input className="input min-w-0 rounded-l-none" placeholder={RECEIVER_TYPES.find((t) => t.id === type)?.placeholder} value={receiver} onChange={(e) => setReceiver(e.target.value)} />
          </div>
        </div>
      )}
      {error && <div className="rounded-lg bg-red-soft px-3 py-2 text-red">{error}</div>}
      <div className="flex justify-end">
        <button className="btn btn-primary !h-9" onClick={propose} disabled={pending}>
          {pending ? <Loader2 size={14} className="animate-spin" /> : <Archive size={14} />} Propose closing
        </button>
      </div>
    </div>
  )
}
