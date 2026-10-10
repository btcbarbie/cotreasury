'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, Loader2, ShieldCheck, X } from 'lucide-react'
import { formatMoney } from '@/lib/money'
import { refreshCollective } from '@/app/c/[id]/actions'
import { openAsk } from '@/lib/ask'

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window {
    paypal?: any
  }
}
declare module 'react' {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      'paypal-button': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & { type?: string }
      'venmo-button': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & { type?: string }
    }
  }
}

const SDK_URL = 'https://www.sandbox.paypal.com/web-sdk/v6/core'
const PRESETS = [2500, 5000, 10000, 25000]

let sdkPromise: Promise<void> | null = null
function loadSdk(): Promise<void> {
  if (window.paypal) return Promise.resolve()
  sdkPromise ??= new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = SDK_URL
    s.async = true
    s.onload = () => resolve()
    s.onerror = () => {
      sdkPromise = null
      reject(new Error('Could not load PayPal'))
    }
    document.head.appendChild(s)
  })
  return sdkPromise
}

type Phase =
  | { kind: 'amount' }
  | { kind: 'capturing' }
  | { kind: 'confirming'; entryId: string; source?: string }
  | { kind: 'done'; source: string }
  | { kind: 'error'; message: string }

type GoalOption = { id: string; title: string }

export function ContributeButton(props: { collectiveId: string; collectiveName: string; currency: string; clientId: string; viewerName: string; goals: GoalOption[] }) {
  const [open, setOpen] = useState<{ goalId: string | null; amountCents: number } | null>(null)

  // Goal cards ask to open the dialog pre-filled with their goal and what the viewer still owes.
  useEffect(() => {
    const onOpen = (e: Event) => {
      const d = (e as CustomEvent<{ goalId: string; amountCents: number }>).detail
      setOpen({ goalId: d.goalId, amountCents: d.amountCents })
    }
    window.addEventListener('cotreasury:contribute', onOpen)
    return () => window.removeEventListener('cotreasury:contribute', onOpen)
  }, [])

  return (
    <>
      <button className="btn btn-primary" onClick={() => setOpen({ goalId: props.goals[0]?.id ?? null, amountCents: 5000 })}>
        Add funds
      </button>
      {open && <ContributeDialog {...props} initialGoalId={open.goalId} initialAmountCents={open.amountCents} onClose={() => setOpen(null)} />}
    </>
  )
}

function ContributeDialog({
  collectiveId,
  collectiveName,
  currency,
  clientId,
  viewerName,
  goals,
  initialGoalId,
  initialAmountCents,
  onClose,
}: {
  collectiveId: string
  collectiveName: string
  currency: string
  clientId: string
  viewerName: string
  goals: GoalOption[]
  initialGoalId: string | null
  initialAmountCents: number
  onClose: () => void
}) {
  const [amountCents, setAmountCents] = useState(initialAmountCents)
  const [custom, setCustom] = useState(PRESETS.includes(initialAmountCents) ? '' : (initialAmountCents / 100).toFixed(2))
  const [goalId, setGoalId] = useState<string | null>(initialGoalId)
  const [phase, setPhase] = useState<Phase>({ kind: 'amount' })
  const [sdkReady, setSdkReady] = useState(false)
  const [venmo, setVenmo] = useState(false)
  const sdkRef = useRef<any>(null)

  // Load the PayPal v6 SDK once and check which wallets this buyer can use.
  useEffect(() => {
    let cancelled = false
    loadSdk()
      .then(async () => {
        const sdk = await window.paypal.createInstance({
          clientId,
          components: ['paypal-payments', 'venmo-payments'],
          pageType: 'checkout',
          locale: 'en-US',
        })
        const methods = await sdk.findEligibleMethods({ currencyCode: currency })
        if (cancelled) return
        sdkRef.current = sdk
        setVenmo(methods.isEligible('venmo'))
        setSdkReady(true)
      })
      .catch((e) => !cancelled && setPhase({ kind: 'error', message: e.message }))
    return () => {
      cancelled = true
    }
  }, [clientId, currency])

  const createOrder = useCallback(async (cents: number): Promise<{ orderId: string }> => {
    const res = await fetch(`/api/collectives/${collectiveId}/contribute/order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amountCents: cents, goalId }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error ?? 'Could not start payment')
    return { orderId: data.orderId }
  }, [collectiveId, goalId])

  const onApprove = useCallback(
    async (data: { orderId: string }) => {
      setPhase({ kind: 'capturing' })
      const res = await fetch(`/api/collectives/${collectiveId}/contribute/capture`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: data.orderId }),
      })
      const body = await res.json()
      if (!res.ok) return setPhase({ kind: 'error', message: body.error ?? 'Payment failed' })
      if (body.status === 'CONFIRMED') return setPhase({ kind: 'done', source: 'PAYPAL_WEBHOOK' })
      setPhase({ kind: 'confirming', entryId: body.entryId })
    },
    [collectiveId],
  )

  async function pay(method: 'paypal' | 'venmo') {
    const sdk = sdkRef.current
    if (!sdk) return
    const handlers = {
      onApprove,
      onCancel: () => setPhase({ kind: 'amount' }),
      onError: (e: Error) => setPhase({ kind: 'error', message: e.message || 'PayPal reported an error' }),
    }
    const session =
      method === 'venmo' ? sdk.createVenmoOneTimePaymentSession(handlers) : sdk.createPayPalOneTimePaymentSession(handlers)
    try {
      // v6 expects the order Promise itself, not a function.
      await session.start({ presentationMode: 'auto' }, createOrder(amountCents))
    } catch (e) {
      setPhase({ kind: 'error', message: (e as Error).message })
    }
  }

  // Poll until PayPal's confirmation lands (webhook, or the server's direct check).
  useEffect(() => {
    if (phase.kind !== 'confirming') return
    let stop = false
    const tick = async () => {
      if (stop) return
      const res = await fetch(`/api/ledger/${phase.entryId}`, { cache: 'no-store' })
      const data = await res.json()
      if (data.status === 'CONFIRMED') {
        setPhase({ kind: 'done', source: data.source })
        await refreshCollective()
        return
      }
      if (data.status === 'FAILED') return setPhase({ kind: 'error', message: 'PayPal declined this payment.' })
      setTimeout(tick, 2000)
    }
    const t = setTimeout(tick, 1500)
    return () => {
      stop = true
      clearTimeout(t)
    }
  }, [phase])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && phase.kind !== 'capturing' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, phase.kind])

  function selectCustom(v: string) {
    setCustom(v)
    const n = Math.round(parseFloat(v) * 100)
    if (Number.isFinite(n) && n > 0) setAmountCents(n)
  }

  const validAmount = amountCents >= 100 && amountCents <= 1_000_000

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-ink/30 p-0 sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && phase.kind !== 'capturing' && onClose()}>
      <div className="card w-full sm:max-w-md rounded-b-none sm:rounded-b-[14px] p-6 shadow-[0_20px_60px_rgba(0,0,0,0.15)]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-lg font-semibold tracking-tight">Add funds</div>
            <div className="text-sm text-muted">
              to {collectiveName} as {viewerName}
            </div>
          </div>
          <button onClick={onClose} className="text-muted hover:text-ink" aria-label="Close" disabled={phase.kind === 'capturing'}>
            <X size={18} />
          </button>
        </div>

        {phase.kind === 'amount' && (
          <>
            {goals.length > 0 && (
              <label className="mt-5 block">
                <span className="label">What is it for?</span>
                <select className="input mt-1.5" value={goalId ?? ''} onChange={(e) => setGoalId(e.target.value || null)}>
                  {goals.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.title}
                    </option>
                  ))}
                  <option value="">General fund</option>
                </select>
              </label>
            )}
            <div className="mt-5 grid grid-cols-4 gap-2">
              {PRESETS.map((p) => (
                <button
                  key={p}
                  onClick={() => {
                    setAmountCents(p)
                    setCustom('')
                  }}
                  className={`h-11 rounded-[10px] border text-sm font-medium tabular transition ${
                    amountCents === p && !custom ? 'border-ink bg-ink text-white' : 'border-line-strong hover:border-faint'
                  }`}
                >
                  {formatMoney(p, currency)}
                </button>
              ))}
            </div>
            <div className="relative mt-2">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted">$</span>
              <input
                className="input pl-7 tabular"
                inputMode="decimal"
                placeholder="Other amount"
                value={custom}
                onChange={(e) => selectCustom(e.target.value.replace(/[^0-9.]/g, ''))}
              />
            </div>

            <div className="mt-6 grid gap-2">
              {!sdkReady ? (
                <div className="flex h-11 items-center justify-center gap-2 rounded-[10px] bg-bg text-sm text-muted">
                  <Loader2 size={15} className="animate-spin" /> Loading PayPal…
                </div>
              ) : (
                <>
                  <paypal-button type="pay" className="paypal-gold" onClick={() => validAmount && pay('paypal')} style={{ opacity: validAmount ? 1 : 0.4 }} />
                  {venmo && <venmo-button type="pay" className="venmo-blue" onClick={() => validAmount && pay('venmo')} style={{ opacity: validAmount ? 1 : 0.4 }} />}
                </>
              )}
            </div>
            <p className="mt-4 flex items-start gap-2 text-xs text-muted">
              <ShieldCheck size={14} className="mt-px shrink-0 text-accent" />
              Paid straight into the group&apos;s own PayPal account. It appears in the ledger once PayPal confirms it.
            </p>
            <div className="mt-3 rounded-[10px] border border-dashed border-line-strong px-3 py-2.5 text-xs leading-relaxed text-muted">
              <span className="font-medium text-ink">Sandbox mode.</span> In PayPal&apos;s window choose{' '}
              <span className="font-medium text-ink">Log in</span> and use a PayPal <span className="font-medium text-ink">sandbox personal</span> test account
              (developer.paypal.com → Testing Tools → Sandbox Accounts). Your real PayPal login and the card form won&apos;t work here, and no real money moves.
            </div>
            <button
              type="button"
              className="mt-3 text-xs text-muted underline-offset-2 hover:text-ink hover:underline"
              onClick={() => {
                onClose()
                openAsk('I want to pay what I owe')
              }}
            >
              Not sure what to pay? Ask the AI Treasurer
            </button>
          </>
        )}

        {(phase.kind === 'capturing' || phase.kind === 'confirming' || phase.kind === 'done') && (
          <div className="mt-6">
            <div className="tabular text-3xl font-semibold tracking-tight">{formatMoney(amountCents, currency)}</div>
            <ol className="mt-5 grid gap-3 text-sm">
              <Step state={phase.kind === 'capturing' ? 'active' : 'done'} label="Payment approved in PayPal" />
              <Step
                state={phase.kind === 'capturing' ? 'idle' : phase.kind === 'confirming' ? 'active' : 'done'}
                label={phase.kind === 'done' ? `Confirmed by ${phase.source === 'PAYPAL_WEBHOOK' ? 'PayPal webhook' : 'PayPal status check'}` : 'Waiting for PayPal to confirm'}
              />
              <Step state={phase.kind === 'done' ? 'done' : 'idle'} label="Recorded in the shared ledger" />
            </ol>
            {phase.kind === 'done' && (
              <button className="btn btn-primary mt-6 w-full" onClick={onClose}>
                Done
              </button>
            )}
          </div>
        )}

        {phase.kind === 'error' && (
          <div className="mt-6">
            <div className="rounded-[10px] bg-red-soft p-3 text-sm text-red">{phase.message}</div>
            <button className="btn btn-ghost mt-4 w-full" onClick={() => setPhase({ kind: 'amount' })}>
              Try again
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function Step({ state, label }: { state: 'idle' | 'active' | 'done'; label: string }) {
  return (
    <li className={`flex items-center gap-3 ${state === 'idle' ? 'text-faint' : ''}`}>
      <span
        className={`inline-flex h-6 w-6 items-center justify-center rounded-full ${
          state === 'done' ? 'bg-accent text-white' : state === 'active' ? 'bg-accent-soft text-accent' : 'bg-bg'
        }`}
      >
        {state === 'done' ? <Check size={13} strokeWidth={3} /> : state === 'active' ? <Loader2 size={13} className="animate-spin" /> : null}
      </span>
      {label}
    </li>
  )
}
