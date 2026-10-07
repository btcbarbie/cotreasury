'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { AlertTriangle, ArrowUp, Check, FileText, HandCoins, Loader2, Sparkles, X } from 'lucide-react'
import { formatMoney } from '@/lib/money'
import { submitRequest } from '@/app/c/[id]/actions'
import type { ContributionDraft, DraftRequest, TreasurerReply } from '@/lib/treasurer'

type Turn = { role: 'user'; content: string } | ({ role: 'assistant'; content: string } & Omit<TreasurerReply, 'answer'>)

const DEFAULT_SUGGESTIONS = ["Who hasn't paid yet?", 'How much can we spend right now?', 'Who needs to approve a $1,000 payment?']

const SUGGESTIONS: Record<string, string[]> = {
  SCHOLARSHIP_FUND: [
    'Can we fund 4 scholarships at $1,500 each?',
    "Who hasn't paid for the Fall 2026 awards?",
    'Who needs to sign off on a $6,000 award?',
  ],
  BOOSTER_CLUB: [
    'Can we afford a $1,850 bus to the regional finals?',
    "Who still owes season dues?",
    'Who approves spending over $2,000?',
  ],
}

/** Renders **bold** without pulling in a markdown library. */
function Rich({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
        part.startsWith('**') && part.endsWith('**') ? (
          <strong key={i} className="font-semibold text-ink">
            {part.slice(2, -2)}
          </strong>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  )
}

const ASSISTANT_SUGGESTIONS = ['I want to request a payout', 'I want to pay what I owe', 'Add $50 to the general fund']

/**
 * The AI Treasurer chat. `variant="assistant"` is the payment assistant: same
 * AI and tools, framed around getting a payout requested or funds added.
 */
export function TreasurerPanel({
  collectiveId,
  kind,
  currency,
  brief,
  variant = 'treasurer',
}: {
  collectiveId: string
  kind: string
  currency: string
  brief: string
  variant?: 'treasurer' | 'assistant'
}) {
  const assistant = variant === 'assistant'
  const [turns, setTurns] = useState<Turn[]>([])
  const [input, setInput] = useState('')
  const [thinking, setThinking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [turns, thinking])

  async function ask(question: string) {
    const q = question.trim()
    if (!q || thinking) return
    const next: Turn[] = [...turns, { role: 'user', content: q }]
    setTurns(next)
    setInput('')
    setError(null)
    setThinking(true)
    try {
      const res = await fetch(`/api/collectives/${collectiveId}/treasurer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ history: next.map((t) => ({ role: t.role, content: t.content })) }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'The Treasurer is unavailable.')
      const reply = data as TreasurerReply
      setTurns([...next, { role: 'assistant', content: reply.answer, checks: reply.checks, draft: reply.draft, contribution: reply.contribution }])
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setThinking(false)
    }
  }

  function dropDraft(index: number) {
    setTurns((ts) => ts.map((t, i) => (i === index && t.role === 'assistant' ? { ...t, draft: null } : t)))
  }

  return (
    <section className={`treasurer-card overflow-hidden rounded-[16px] border ${assistant ? '' : 'mt-6'}`}>
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-5">
        <div className="flex items-center gap-3">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-violet text-white shadow-[0_4px_14px_rgba(109,74,255,0.35)]">
            <Sparkles size={17} />
          </span>
          <div>
            <div className="font-semibold tracking-tight">{assistant ? 'Payment assistant' : 'AI Treasurer'}</div>
            <div className="text-xs text-muted">
              {assistant ? 'Tell it what you need. It asks for the details and gets it ready; you confirm.' : 'Reads the ledger and drafts requests. Can’t approve or move money.'}
            </div>
          </div>
        </div>
        <span className="pill pill-violet">
          <span className="h-1.5 w-1.5 rounded-full bg-violet animate-pulse" /> Watching the ledger
        </span>
      </div>

      <div ref={scrollRef} className="max-h-[420px] overflow-y-auto px-5 pt-4">
        {turns.length === 0 ? (
          <p className="rounded-xl bg-white/70 px-4 py-3 text-sm leading-relaxed text-ink/80 ring-1 ring-violet/10">
            <Rich text={brief} />
          </p>
        ) : (
          <div className="grid gap-3 pb-1">
            {turns.map((t, i) =>
              t.role === 'user' ? (
                <div key={i} className="ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-ink px-4 py-2.5 text-sm text-white">
                  {t.content}
                </div>
              ) : (
                <div key={i} className="max-w-[92%]">
                  {t.checks.length > 0 && (
                    <div className="mb-1.5 flex flex-wrap gap-1.5">
                      {t.checks.map((c, j) => (
                        <span key={j} className="pill pill-violet !h-[20px] !text-[11px]">
                          <Check size={11} strokeWidth={3} /> {c}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="whitespace-pre-line rounded-2xl rounded-bl-md bg-white px-4 py-3 text-sm leading-relaxed text-ink/85 ring-1 ring-line">
                    <Rich text={t.content} />
                  </div>
                  {t.draft && <DraftCard collectiveId={collectiveId} draft={t.draft} currency={currency} onDone={() => dropDraft(i)} />}
                  {t.contribution && <ContributionCard c={t.contribution} currency={currency} />}
                </div>
              ),
            )}
            {thinking && (
              <div className="flex items-center gap-2 text-sm text-violet">
                <Loader2 size={14} className="animate-spin" /> Checking the ledger…
              </div>
            )}
          </div>
        )}
      </div>

      <div className="px-5 pb-5 pt-4">
        {turns.length === 0 && (
          <div className="no-scrollbar mb-3 flex gap-2 overflow-x-auto">
            {(assistant ? ASSISTANT_SUGGESTIONS : (SUGGESTIONS[kind] ?? DEFAULT_SUGGESTIONS)).map((s) => (
              <button
                key={s}
                onClick={() => ask(s)}
                className="shrink-0 rounded-full bg-white px-3 py-1.5 text-xs text-ink/80 ring-1 ring-violet/20 transition hover:ring-violet/50"
              >
                {s}
              </button>
            ))}
          </div>
        )}
        {error && <div className="mb-3 rounded-lg bg-red-soft px-3 py-2 text-sm text-red">{error}</div>}
        <form
          onSubmit={(e) => {
            e.preventDefault()
            ask(input)
          }}
          className="flex items-center gap-2 rounded-xl bg-white p-1.5 pl-4 ring-1 ring-violet/20 focus-within:ring-violet/60"
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={assistant ? 'e.g. Pay Maya Chen $40 for lab equipment…' : 'Ask the Treasurer about the money…'}
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-faint"
          />
          <button
            type="submit"
            disabled={!input.trim() || thinking}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-violet text-white transition disabled:opacity-30"
            aria-label="Ask"
          >
            <ArrowUp size={16} />
          </button>
        </form>
      </div>
    </section>
  )
}

function DraftCard({ collectiveId, draft, currency, onDone }: { collectiveId: string; draft: DraftRequest; currency: string; onDone: () => void }) {
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)

  function submit() {
    start(async () => {
      const r = await submitRequest(collectiveId, draft)
      if (!r.ok) return setError(r.error)
      setSubmitted(true)
    })
  }

  if (submitted) {
    return (
      <div className="mt-2 flex items-center gap-2 rounded-xl bg-accent-soft px-4 py-3 text-sm text-accent">
        <Check size={15} strokeWidth={3} /> Submitted. It&apos;s now in the Activity log, waiting for {draft.requiredApprovals} approval
        {draft.requiredApprovals === 1 ? '' : 's'}.
      </div>
    )
  }

  return (
    <div className="mt-2 rounded-xl border border-violet/25 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5 min-w-0">
          <FileText size={16} className="mt-0.5 shrink-0 text-violet" />
          <div className="min-w-0">
            <div className="text-xs font-medium uppercase tracking-wide text-violet">Draft request</div>
            <div className="mt-0.5 font-medium">{draft.title}</div>
            <p className="mt-0.5 text-sm text-muted">{draft.description}</p>
          </div>
        </div>
        <div className="tabular shrink-0 text-lg font-semibold">{formatMoney(draft.amountCents, currency)}</div>
      </div>
      {draft.flags?.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {draft.flags.map((f) => (
            <span key={f.code} className="pill pill-amber">
              <AlertTriangle size={12} /> {f.message}
            </span>
          ))}
        </div>
      )}
      <ul className="mt-3 divide-y divide-line rounded-lg bg-bg/60 text-sm">
        {draft.recipients.map((r, i) => (
          <li key={i} className="flex items-center justify-between gap-3 px-3 py-2">
            <span className="min-w-0 truncate">
              {r.name} <span className="text-muted">· {r.receiver}</span>
            </span>
            <span className="tabular shrink-0">{formatMoney(r.amountCents, currency)}</span>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <span className="text-xs text-muted">Needs {draft.requiredApprovals} approver sign-off{draft.requiredApprovals === 1 ? '' : 's'}. You can&apos;t approve your own request.</span>
        <div className="flex gap-2">
          <button className="btn btn-ghost !h-8" onClick={onDone} disabled={pending}>
            <X size={14} /> Discard
          </button>
          <button className="btn btn-primary !h-8" onClick={submit} disabled={pending}>
            {pending ? <Loader2 size={14} className="animate-spin" /> : null} Submit for approval
          </button>
        </div>
      </div>
      {error && <div className="mt-3 rounded-lg bg-red-soft px-3 py-2 text-sm text-red">{error}</div>}
    </div>
  )
}

/** A contribution the AI lined up. Paying opens the normal Add funds dialog, pre-filled. */
function ContributionCard({ c, currency }: { c: ContributionDraft; currency: string }) {
  function pay() {
    window.dispatchEvent(new CustomEvent('cotreasury:contribute', { detail: { goalId: c.goalId, amountCents: c.amountCents } }))
  }
  return (
    <div className="mt-2 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-violet/25 bg-white p-4">
      <div className="flex items-start gap-2.5">
        <HandCoins size={16} className="mt-0.5 shrink-0 text-violet" />
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-violet">Ready to add</div>
          <div className="mt-0.5 font-medium">
            {formatMoney(c.amountCents, currency)} {c.goalTitle ? `for ${c.goalTitle}` : 'to the general fund'}
          </div>
          <div className="text-xs text-muted">You confirm and pay in PayPal. Nothing has been taken.</div>
        </div>
      </div>
      <button className="btn btn-primary !h-9" onClick={pay}>
        Pay with PayPal
      </button>
    </div>
  )
}
