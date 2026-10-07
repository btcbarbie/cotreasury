'use client'

import { useMemo, useState, useTransition } from 'react'
import { ArrowLeft, ArrowRight, Check, GraduationCap, HandHeart, Loader2, Plus, ShieldCheck, Sparkles, Trash2, Trophy, Users, Wallet } from 'lucide-react'
import { createTreasury, type NewTreasury } from '@/app/new/actions'
import { formatMoney } from '@/lib/money'
import { Avatar } from './ui'

const STEPS = ['Purpose', 'People', 'Rules', 'PayPal', 'Review'] as const
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const KINDS = [
  { id: 'SCHOLARSHIP_FUND', label: 'Scholarship fund', hint: 'Award money to students', Icon: GraduationCap, tone: 'bg-violet-soft text-violet', placeholder: 'Riverside Alumni Scholarship Fund' },
  { id: 'BOOSTER_CLUB', label: 'Booster club', hint: 'Teams, clubs, school groups', Icon: Trophy, tone: 'bg-amber-soft text-amber', placeholder: 'Lincoln High Robotics Boosters' },
  { id: 'COMMUNITY_FUND', label: 'Community fund', hint: 'Churches, neighbours, causes', Icon: HandHeart, tone: 'bg-accent-soft text-accent', placeholder: 'Maple Street Community Fund' },
  { id: 'OTHER', label: 'Something else', hint: 'Any shared purpose', Icon: Users, tone: 'bg-blue-soft text-blue', placeholder: 'Our shared treasury' },
]

type Person = { name: string; email: string; role: 'APPROVER' | 'MEMBER' }
type TierRow = { upTo: string; approvals: number }

/** Sensible starting rules for a given number of approvers. */
function presetTiers(preset: 'light' | 'balanced' | 'strict', approvers: number): TierRow[] {
  const cap = (n: number) => Math.max(1, Math.min(n, approvers))
  if (preset === 'light') return [{ upTo: '1000', approvals: 1 }, { upTo: '', approvals: cap(2) }]
  if (preset === 'strict') return [{ upTo: '250', approvals: cap(2) }, { upTo: '2500', approvals: cap(3) }, { upTo: '', approvals: cap(approvers) }]
  return [{ upTo: '500', approvals: 1 }, { upTo: '5000', approvals: cap(2) }, { upTo: '', approvals: cap(Math.ceil(approvers / 2) + 1) }]
}

function toTiers(rows: TierRow[]) {
  let min = 0
  return rows.map((r, i) => {
    const max = i === rows.length - 1 ? null : Math.round(parseFloat(r.upTo || '0') * 100)
    const t = { minCents: min, maxCents: max, requiredApprovals: r.approvals }
    if (max !== null) min = max
    return t
  })
}

export function CreateTreasuryWizard() {
  const [step, setStep] = useState(0)
  const [kind, setKind] = useState('SCHOLARSHIP_FUND')
  const [name, setName] = useState('')
  const [purpose, setPurpose] = useState('')
  const [creator, setCreator] = useState({ name: '', email: '' })
  const [people, setPeople] = useState<Person[]>([
    { name: '', email: '', role: 'APPROVER' },
    { name: '', email: '', role: 'MEMBER' },
  ])
  const [preset, setPreset] = useState<'light' | 'balanced' | 'strict'>('balanced')
  const [rows, setRows] = useState<TierRow[] | null>(null)
  const [newPayeeRule, setNewPayeeRule] = useState(true)
  const [paypalEmail, setPaypalEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  const filled = people.filter((p) => p.name.trim() || p.email.trim())
  const approverCount = 1 + filled.filter((p) => p.role === 'APPROVER').length
  const tierRows = rows ?? presetTiers(preset, approverCount)
  const tiers = useMemo(() => toTiers(tierRows), [tierRows])
  const kindMeta = KINDS.find((k) => k.id === kind)!

  // Per-step checks so people can't advance into a broken state.
  function stepError(s: number): string | null {
    if (s === 0) {
      if (name.trim().length < 3) return 'Give the treasury a name.'
      if (purpose.trim().length < 10) return 'Describe the shared purpose in a sentence or two.'
    }
    if (s === 1) {
      if (!creator.name.trim() || !EMAIL.test(creator.email.trim())) return 'Add your name and a valid email.'
      for (const p of filled) if (!p.name.trim() || !EMAIL.test(p.email.trim())) return `Check the name and email for ${p.name || p.email}.`
      const emails = [creator.email, ...filled.map((p) => p.email)].map((e) => e.trim().toLowerCase())
      if (new Set(emails).size !== emails.length) return 'Each person needs a different email.'
      if (approverCount < 2) return 'Add at least one more approver, so no one ever approves alone.'
    }
    if (s === 2) {
      for (let i = 0; i < tiers.length - 1; i++) {
        const t = tiers[i]
        if (!t.maxCents || t.maxCents <= t.minCents) return 'Each limit must be higher than the one before it.'
      }
      for (let i = 1; i < tiers.length; i++) if (tiers[i].requiredApprovals < tiers[i - 1].requiredApprovals) return 'Bigger amounts can’t need fewer approvals.'
      if (tiers.some((t) => t.requiredApprovals > approverCount)) return `You only have ${approverCount} approvers.`
    }
    if (s === 3 && paypalEmail.trim() && !EMAIL.test(paypalEmail.trim())) return 'Enter a valid PayPal email, or leave it blank to use yours.'
    return null
  }

  function next() {
    const e = stepError(step)
    setError(e)
    if (!e) setStep((s) => Math.min(s + 1, STEPS.length - 1))
  }

  function submit() {
    for (let s = 0; s < STEPS.length - 1; s++) {
      const e = stepError(s)
      if (e) {
        setStep(s)
        return setError(e)
      }
    }
    const payload: NewTreasury = {
      name,
      purpose,
      kind,
      creator,
      people: filled,
      tiers,
      newPayeeRule,
      paypalEmail: paypalEmail || creator.email,
    }
    setError(null)
    start(async () => {
      const res = await createTreasury(payload) // redirects on success
      if (res && !res.ok) setError(res.error)
    })
  }

  return (
    <div className="mx-auto max-w-2xl">
      {/* Progress */}
      <ol className="mb-8 flex items-center gap-2">
        {STEPS.map((s, i) => (
          <li key={s} className="flex flex-1 flex-col gap-1.5">
            <span className={`h-1.5 rounded-full transition ${i <= step ? 'bg-gradient-to-r from-accent to-teal' : 'bg-line-strong/60'}`} />
            <span className={`hidden text-xs sm:block ${i === step ? 'font-medium text-ink' : 'text-faint'}`}>{s}</span>
          </li>
        ))}
      </ol>

      <div className="card p-5 sm:p-7">
        {step === 0 && (
          <section>
            <h2 className="text-xl font-semibold tracking-tight">What brings this group together?</h2>
            <p className="mt-1 text-sm text-muted">The shared purpose is what every spending request is checked against.</p>
            <div className="mt-5 grid grid-cols-2 gap-2">
              {KINDS.map((k) => (
                <button
                  key={k.id}
                  type="button"
                  onClick={() => setKind(k.id)}
                  className={`flex items-start gap-3 rounded-xl border p-3 text-left transition ${kind === k.id ? 'border-ink bg-bg' : 'border-line hover:border-line-strong'}`}
                >
                  <span className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${k.tone}`}>
                    <k.Icon size={16} />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{k.label}</span>
                    <span className="block text-xs text-muted">{k.hint}</span>
                  </span>
                </button>
              ))}
            </div>
            <label className="mt-6 block">
              <span className="label">Treasury name</span>
              <input className="input mt-1.5" value={name} maxLength={80} placeholder={kindMeta.placeholder} onChange={(e) => setName(e.target.value)} />
            </label>
            <label className="mt-4 block">
              <span className="label">Shared purpose</span>
              <textarea
                className="input mt-1.5 !h-24 resize-none py-2.5 leading-relaxed"
                value={purpose}
                maxLength={400}
                placeholder="e.g. Fund two $1,500 scholarships each year for first-generation students from Riverside High."
                onChange={(e) => setPurpose(e.target.value)}
              />
            </label>
          </section>
        )}

        {step === 1 && (
          <section>
            <h2 className="text-xl font-semibold tracking-tight">Who&apos;s in the collective?</h2>
            <p className="mt-1 text-sm text-muted">Approvers sign off on spending. Members contribute and can see everything.</p>

            <div className="mt-5 rounded-xl bg-bg p-3">
              <div className="mb-2 flex items-center justify-between text-xs">
                <span className="label">You</span>
                <span className="pill pill-blue !h-[18px] !text-[11px]">Admin · approver</span>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <input className="input" placeholder="Your name" value={creator.name} onChange={(e) => setCreator({ ...creator, name: e.target.value })} />
                <input className="input" placeholder="you@email.com" inputMode="email" value={creator.email} onChange={(e) => setCreator({ ...creator, email: e.target.value })} />
              </div>
            </div>

            <div className="mt-4 grid gap-2">
              {people.map((p, i) => (
                <div key={i} className="grid grid-cols-[1fr_auto] gap-2 sm:grid-cols-[1fr_1fr_auto_auto]">
                  <input className="input" placeholder="Name" value={p.name} onChange={(e) => setPeople(people.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                  <button
                    type="button"
                    className="text-faint hover:text-red sm:order-last"
                    aria-label="Remove person"
                    onClick={() => setPeople(people.filter((_, j) => j !== i))}
                  >
                    <Trash2 size={15} />
                  </button>
                  <input
                    className="input col-span-1"
                    placeholder="email@example.com"
                    inputMode="email"
                    value={p.email}
                    onChange={(e) => setPeople(people.map((x, j) => (j === i ? { ...x, email: e.target.value } : x)))}
                  />
                  <div className="flex rounded-[9px] border border-line-strong p-0.5 text-xs">
                    {(['APPROVER', 'MEMBER'] as const).map((r) => (
                      <button
                        key={r}
                        type="button"
                        onClick={() => setPeople(people.map((x, j) => (j === i ? { ...x, role: r } : x)))}
                        className={`rounded-md px-2.5 py-1.5 font-medium transition ${p.role === r ? 'bg-ink text-white' : 'text-muted hover:text-ink'}`}
                      >
                        {r === 'APPROVER' ? 'Approver' : 'Member'}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <button type="button" className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink" onClick={() => setPeople([...people, { name: '', email: '', role: 'MEMBER' }])}>
                <Plus size={14} /> Add person
              </button>
              <span className={`text-xs ${approverCount >= 2 ? 'text-accent' : 'text-amber'}`}>
                {approverCount} approver{approverCount === 1 ? '' : 's'} · {filled.length + 1} people
              </span>
            </div>
          </section>
        )}

        {step === 2 && (
          <section>
            <h2 className="text-xl font-semibold tracking-tight">How much authority does each decision need?</h2>
            <p className="mt-1 text-sm text-muted">Bigger spends need more of your {approverCount} approvers. Changing these later needs approval too.</p>
            <div className="mt-5 grid grid-cols-3 gap-2">
              {(['light', 'balanced', 'strict'] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => {
                    setPreset(p)
                    setRows(null)
                  }}
                  className={`rounded-xl border px-3 py-2.5 text-sm font-medium capitalize transition ${preset === p && !rows ? 'border-ink bg-bg' : 'border-line hover:border-line-strong'}`}
                >
                  {p}
                </button>
              ))}
            </div>
            <div className="mt-5 grid gap-2">
              {tierRows.map((r, i) => {
                const last = i === tierRows.length - 1
                const from = i === 0 ? 0 : tiers[i].minCents
                return (
                  <div key={i} className="flex flex-wrap items-center gap-2 rounded-xl bg-bg px-3 py-2.5 text-sm">
                    <span className="tabular w-20 text-muted">{formatMoney(from, 'USD')}</span>
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
                          onChange={(e) => setRows(tierRows.map((x, j) => (j === i ? { ...x, upTo: e.target.value.replace(/[^0-9.]/g, '') } : x)))}
                        />
                      </div>
                    )}
                    <span className="ml-auto text-muted">needs</span>
                    <select
                      className="input !h-9 !w-16"
                      value={r.approvals}
                      onChange={(e) => setRows(tierRows.map((x, j) => (j === i ? { ...x, approvals: Number(e.target.value) } : x)))}
                    >
                      {Array.from({ length: approverCount }, (_, k) => k + 1).map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                    <span className="w-10 text-muted">of {approverCount}</span>
                  </div>
                )
              })}
            </div>
            <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-xl border border-line p-3 text-sm">
              <input type="checkbox" className="mt-0.5 accent-[var(--accent)]" checked={newPayeeRule} onChange={() => setNewPayeeRule(!newPayeeRule)} />
              <span>
                <span className="font-medium">Extra approval for new recipients</span>
                <span className="block text-muted">The first payment to someone the treasury has never paid needs one more sign-off.</span>
              </span>
            </label>
            <div className="mt-4 flex items-start gap-2 rounded-xl bg-accent-soft px-3 py-2.5 text-sm text-accent">
              <ShieldCheck size={16} className="mt-0.5 shrink-0" />
              Always on: no one approves their own request, and anyone paying themselves needs an extra approval.
            </div>
          </section>
        )}

        {step === 3 && (
          <section>
            <h2 className="text-xl font-semibold tracking-tight">Where does the money live?</h2>
            <p className="mt-1 text-sm text-muted">
              In the collective&apos;s own PayPal account. CoTreasury coordinates and records; it never holds the money.
            </p>
            <label className="mt-5 block">
              <span className="label">PayPal Business account email</span>
              <input className="input mt-1.5" inputMode="email" placeholder={creator.email || 'treasury@yourgroup.org'} value={paypalEmail} onChange={(e) => setPaypalEmail(e.target.value)} />
            </label>
            <div className="mt-5 grid gap-2 text-sm">
              {[
                ['Contributions', 'Members pay by PayPal or Venmo straight into the account.'],
                ['Payouts', 'Approved requests are sent through PayPal Payouts.'],
                ['Verification', 'Every movement is confirmed by a signed PayPal webhook before it hits the ledger.'],
              ].map(([t, b]) => (
                <div key={t} className="flex items-start gap-3 rounded-xl bg-bg px-3 py-2.5">
                  <Check size={15} className="mt-0.5 shrink-0 text-accent" strokeWidth={3} />
                  <span>
                    <span className="font-medium">{t}.</span> <span className="text-muted">{b}</span>
                  </span>
                </div>
              ))}
            </div>
            <p className="mt-4 rounded-xl border border-dashed border-line-strong px-3 py-2.5 text-xs leading-relaxed text-muted">
              <span className="font-medium text-ink">Sandbox demo:</span> money moves through PayPal&apos;s sandbox using CoTreasury&apos;s test business account, so no real funds are involved. In production each treasury connects its own account through PayPal&apos;s partner onboarding.
            </p>
          </section>
        )}

        {step === 4 && (
          <section>
            <h2 className="text-xl font-semibold tracking-tight">Ready to open the treasury?</h2>
            <div className="mt-5 grid gap-3 text-sm">
              <div className="flex items-start gap-3 rounded-xl bg-bg p-3.5">
                <span className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${kindMeta.tone}`}>
                  <kindMeta.Icon size={16} />
                </span>
                <div className="min-w-0">
                  <div className="font-semibold">{name}</div>
                  <div className="text-muted">{purpose}</div>
                </div>
              </div>
              <div className="rounded-xl bg-bg p-3.5">
                <div className="label mb-2">People</div>
                <div className="flex flex-wrap gap-2">
                  {[{ ...creator, role: 'ADMIN' }, ...filled].map((p) => (
                    <span key={p.email} className="inline-flex items-center gap-1.5 rounded-full bg-surface py-1 pl-1 pr-2.5 ring-1 ring-line">
                      <Avatar name={p.name} size={20} />
                      {p.name}
                      {p.role !== 'MEMBER' && <span className="text-[11px] text-accent">approver</span>}
                    </span>
                  ))}
                </div>
              </div>
              <div className="rounded-xl bg-bg p-3.5">
                <div className="label mb-2">Rules</div>
                <ul className="grid gap-1">
                  {tiers.map((t, i) => (
                    <li key={i} className="flex justify-between">
                      <span className="tabular">
                        {t.maxCents === null ? `${formatMoney(t.minCents, 'USD')}+` : `${formatMoney(t.minCents, 'USD')} – ${formatMoney(t.maxCents, 'USD')}`}
                      </span>
                      <span className="text-muted">
                        {t.requiredApprovals} of {approverCount} approvers
                      </span>
                    </li>
                  ))}
                  {newPayeeRule && <li className="text-muted">+1 approval for first payments to new recipients</li>}
                </ul>
              </div>
              <div className="flex items-center gap-3 rounded-xl bg-bg p-3.5">
                <Wallet size={16} className="text-blue" />
                <span>
                  PayPal account: <span className="font-medium">{paypalEmail || creator.email}</span> <span className="text-muted">(sandbox)</span>
                </span>
              </div>
              <div className="flex items-center gap-3 rounded-xl bg-violet-soft p-3.5 text-violet">
                <Sparkles size={16} />
                The AI Treasurer starts watching the ledger as soon as the treasury opens.
              </div>
            </div>
          </section>
        )}

        {error && <div className="mt-5 rounded-lg bg-red-soft px-3 py-2 text-sm text-red">{error}</div>}

        <div className="mt-7 flex items-center justify-between gap-3">
          <button type="button" className="btn btn-ghost" onClick={() => (setError(null), setStep((s) => Math.max(0, s - 1)))} disabled={step === 0 || pending}>
            <ArrowLeft size={15} /> Back
          </button>
          {step < STEPS.length - 1 ? (
            <button type="button" className="btn btn-primary" onClick={next}>
              Continue <ArrowRight size={15} />
            </button>
          ) : (
            <button type="button" className="btn btn-primary !bg-accent" onClick={submit} disabled={pending}>
              {pending ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} strokeWidth={3} />} Create treasury
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
