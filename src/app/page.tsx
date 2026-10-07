import Link from 'next/link'
import { Suspense } from 'react'
import { connection } from 'next/server'
import { ArrowRight, ArrowUpRight, BadgeCheck, BookOpen, GraduationCap, HandHeart, Heart, Link2, Plane, Plus, Scale, Send, ShieldCheck, ShoppingBag, Sparkles, Trophy, Users } from 'lucide-react'
import { listCollectives, myTreasuryIds } from '@/lib/collectives'
import { formatMoney } from '@/lib/money'

const KIND_META: Record<string, { label: string; Icon: typeof Users; tone: string; bar: string }> = {
  SCHOLARSHIP_FUND: { label: 'Scholarship fund', Icon: GraduationCap, tone: 'bg-violet-soft text-violet', bar: 'from-violet to-teal' },
  HOUSEHOLD: { label: 'Household', Icon: Heart, tone: 'bg-red-soft text-red', bar: 'from-red to-violet' },
  GROUP_TRIP: { label: 'Group trip', Icon: Plane, tone: 'bg-blue-soft text-blue', bar: 'from-blue to-teal' },
  BOOSTER_CLUB: { label: 'Booster club', Icon: Trophy, tone: 'bg-amber-soft text-amber', bar: 'from-amber to-red' },
  COMMUNITY_FUND: { label: 'Community fund', Icon: HandHeart, tone: 'bg-accent-soft text-accent', bar: 'from-accent to-teal' },
  OTHER: { label: 'Treasury', Icon: Users, tone: 'bg-blue-soft text-blue', bar: 'from-blue to-violet' },
}

const PILLARS = [
  {
    title: 'AI Treasurer',
    body: 'AI never holds or controls funds. It helps manage the treasury fairly.',
    Icon: Sparkles,
    tone: 'bg-violet-soft text-violet',
  },
  {
    title: 'Your group makes the decisions',
    body: 'Set who can approve spending and how many people need to say yes.',
    Icon: Scale,
    tone: 'bg-accent-soft text-accent',
  },
  {
    title: 'Money through PayPal',
    body: 'Use PayPal to contribute to the treasury and make approved payouts.',
    Icon: Send,
    tone: 'bg-blue-soft text-blue',
  },
  {
    title: 'A shared ledger',
    body: 'Everyone can see where the money went.',
    Icon: BookOpen,
    tone: 'bg-teal-soft text-teal',
  },
]

const AUDIENCES = [
  { label: 'Scholarship funds', Icon: GraduationCap, tone: 'bg-violet-soft text-violet' },
  { label: 'Clubs', Icon: Trophy, tone: 'bg-amber-soft text-amber' },
  { label: 'Communities', Icon: HandHeart, tone: 'bg-accent-soft text-accent' },
  { label: 'Group projects', Icon: Users, tone: 'bg-blue-soft text-blue' },
  { label: 'Shared purchases', Icon: ShoppingBag, tone: 'bg-teal-soft text-teal' },
]

const PRINCIPLES = [
  {
    title: 'AI Treasurer',
    tagline: 'The impartial referee.',
    body: [
      'The AI checks transactions and treasury activity against the rules, helps people understand the ledger, points out anything that breaks the rules, and answers questions about what happened.',
      'It cannot approve requests, move money, or rewrite the ledger.',
    ],
    Icon: Sparkles,
  },
  {
    title: 'Shared Ledger',
    tagline: 'One record everyone can check.',
    body: [
      'Every contribution, payout, approval, and transaction is recorded with its status and history. Once recorded, financial history isn’t something one person can simply edit behind the scenes.',
    ],
    Icon: Link2,
  },
  {
    title: 'Collective Rules',
    tagline: 'Decisions are made by the people authorized to make them.',
    body: [
      'Your group decides who can approve payments and how many approvals are required. CoTreasury applies those rules consistently, and the AI can’t change them.',
    ],
    Icon: Scale,
  },
  {
    title: 'PayPal',
    tagline: 'The money stays and moves through PayPal.',
    body: [
      'Approved in or out payments are processed through PayPal and verified before CoTreasury records them. The AI never becomes the person holding or moving the money.',
    ],
    Icon: BadgeCheck,
  },
]

export default function Home() {
  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6">
      {/* Hero: text on the left, who it's for on the right (stacks on phones) */}
      <section className="relative grid items-center gap-10 pt-14 pb-14 sm:pt-20 sm:pb-16 lg:grid-cols-[minmax(0,1fr)_24rem] lg:gap-14">
        <div className="pointer-events-none absolute -top-10 right-0 -z-10 h-72 w-72 rounded-full bg-violet/10 blur-3xl sm:h-96 sm:w-96" />
        <div className="pointer-events-none absolute top-24 -left-10 -z-10 h-56 w-56 rounded-full bg-teal/10 blur-3xl" />
        <div>
          <span className="pill pill-violet mb-5">Collective goal. Collective treasury. Collective control.</span>
          <h1 className="text-5xl font-semibold leading-none tracking-tight sm:text-7xl">
            <span className="bg-gradient-to-r from-accent via-teal to-violet bg-clip-text text-transparent">CoTreasury</span>
          </h1>
          <p className="mt-4 max-w-3xl text-lg font-medium leading-snug tracking-tight sm:text-2xl">
            Money works better when everyone can see it.
          </p>
          <p className="mt-6 max-w-2xl text-base leading-relaxed text-muted sm:text-lg">
            CoTreasury gives groups one shared place to raise funds, make collective financial decisions, and keep track of every payment.
          </p>
          <p className="mt-2 max-w-2xl text-base leading-relaxed text-muted sm:text-lg">
            AI helps manage the treasury. Your group sets the rules. PayPal handles approved payments.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/new" className="btn btn-primary !h-11 !px-5">
              Create a Treasury <ArrowRight size={16} />
            </Link>
            <a href="#how-it-works" className="btn btn-ghost !h-11 !px-5">
              See How It Works
            </a>
          </div>
        </div>
        <div className="card p-5">
          <div className="flex items-center gap-2 text-sm font-medium text-accent">
            <Users size={16} /> Built for groups that manage money together
          </div>
          <ul className="mt-4 grid gap-2.5">
            {AUDIENCES.map((a) => (
              <li key={a.label} className="flex items-center gap-3 text-sm">
                <span className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${a.tone}`}>
                  <a.Icon size={15} />
                </span>
                {a.label}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <Suspense fallback={null}>
        <MyTreasuries />
      </Suspense>

      {/* Pillars */}
      <section id="how-it-works" className="scroll-mt-20 border-t border-line py-14 sm:py-16">
        <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">Your treasury. Your rules. Your collective.</h2>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {PILLARS.map((p) => (
            <div key={p.title} className="card p-5">
              <span className={`inline-flex h-9 w-9 items-center justify-center rounded-xl ${p.tone}`}>
                <p.Icon size={17} strokeWidth={2} />
              </span>
              <div className="mt-4 font-semibold tracking-tight">{p.title}</div>
              <p className="mt-1.5 text-sm leading-relaxed text-muted">{p.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Live demo treasuries */}
      <section id="treasuries" className="scroll-mt-20 border-t border-line py-14 sm:py-16">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">Try a demo treasury</h2>
            <p className="mt-2 text-muted">Made-up treasuries with months of history, running on PayPal&apos;s sandbox. Open one as its admin, or view it as any member.</p>
          </div>
        </div>
        <div className="mt-8">
          <Suspense fallback={<CollectiveGridSkeleton />}>
            <DemoGrid />
          </Suspense>
        </div>
      </section>

      {/* Principles */}
      <section className="border-t border-line py-14 sm:py-16">
        <div className="flex items-center gap-2 text-sm font-medium text-accent">
          <ShieldCheck size={16} /> Built for trust
        </div>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">AI reads, people decide</h2>
        <p className="mt-3 max-w-2xl text-muted">
          CoTreasury separates financial decisions from financial records, so no single person — or the AI — can quietly change what happened.
        </p>
        <div className="mt-8 grid gap-x-8 gap-y-8 sm:grid-cols-2">
          {PRINCIPLES.map((p) => (
            <div key={p.title} className="flex gap-4">
              <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-ink text-white">
                <p.Icon size={18} />
              </span>
              <div>
                <div className="font-semibold tracking-tight">{p.title}</div>
                <div className="mt-0.5 text-sm font-medium text-ink">{p.tagline}</div>
                {p.body.map((line) => (
                  <p key={line} className="mt-1.5 text-sm leading-relaxed text-muted">
                    {line}
                  </p>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Closing call to action */}
      <section className="pb-16 sm:pb-20">
        <div className="relative overflow-hidden rounded-[20px] bg-gradient-to-r from-accent via-teal to-violet px-6 py-12 text-center text-white sm:py-14">
          <div className="pointer-events-none absolute -top-16 -left-10 h-48 w-48 rounded-full bg-white/10 blur-2xl" />
          <div className="pointer-events-none absolute -right-10 -bottom-20 h-56 w-56 rounded-full bg-white/10 blur-2xl" />
          <h2 className="text-2xl font-semibold tracking-tight sm:text-4xl">Start your group&apos;s treasury</h2>
          <p className="mx-auto mt-3 max-w-xl text-white/85 sm:text-lg">It takes a minute to set up. Invite your members with a link.</p>
          <Link href="/new" className="btn mt-7 inline-flex !h-11 !px-5 bg-white !text-ink hover:bg-white/90">
            Create a Treasury <ArrowRight size={16} />
          </Link>
        </div>
      </section>
    </div>
  )
}

async function MyTreasuries() {
  const ids = await myTreasuryIds()
  if (ids.length === 0) return null
  const collectives = await listCollectives({ ids })
  if (collectives.length === 0) return null
  return (
    <section className="border-t border-line py-14 sm:py-16">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">Your treasuries</h2>
        <Link href="/new" className="btn btn-ghost !h-9">
          <Plus size={15} /> New treasury
        </Link>
      </div>
      <div className="mt-8">
        <TreasuryGrid collectives={collectives} />
      </div>
    </section>
  )
}

async function DemoGrid() {
  await connection() // live balances: never prerender this list at build time
  return <TreasuryGrid collectives={await listCollectives({ demo: true })} demo />
}

function TreasuryGrid({ collectives, demo }: { collectives: Awaited<ReturnType<typeof listCollectives>>; demo?: boolean }) {
  return (
    <div className={`grid gap-4 sm:grid-cols-2 ${collectives.length > 2 ? 'lg:grid-cols-3' : ''}`}>
      {collectives.map((c) => {
        const meta = KIND_META[c.kind] ?? { label: 'Treasury', Icon: Users, tone: 'bg-bg text-muted', bar: 'from-ink to-muted' }
        return (
          <div
            key={c.id}
            className="card group relative flex flex-col overflow-hidden p-5 transition hover:border-line-strong hover:shadow-[0_4px_24px_rgba(0,0,0,0.06)]"
          >
            <span className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${meta.bar}`} />
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2 text-sm text-muted">
                <span className={`inline-flex h-7 w-7 items-center justify-center rounded-lg ${meta.tone}`}>
                  <meta.Icon size={15} strokeWidth={2} />
                </span>
                {meta.label}
              </div>
              <Link href={`/c/${c.id}`} aria-label={`Open ${c.name}`}>
                <ArrowUpRight size={16} className="text-faint transition group-hover:text-ink" />
              </Link>
            </div>
            <Link href={`/c/${c.id}`} className="mt-3 text-lg font-semibold tracking-tight hover:underline">
              {c.name}
            </Link>
            <p className="mt-1 text-sm text-muted line-clamp-2">{c.purpose}</p>
            <div className="mt-5 grid grid-cols-3 gap-3 border-t border-line pt-4 text-sm">
              <div>
                <div className="tabular text-lg font-semibold tracking-tight">{formatMoney(c.inflowCents, c.currency)}</div>
                <div className="text-xs text-muted">Total inflow</div>
              </div>
              <div>
                <div className="tabular text-lg font-semibold tracking-tight">{formatMoney(c.treasury.availableCents, c.currency)}</div>
                <div className="text-xs text-muted">Available balance</div>
              </div>
              <div>
                <div className="tabular text-lg font-semibold tracking-tight">{c.memberCount}</div>
                <div className="text-xs text-muted">Members</div>
              </div>
            </div>
            {demo && c.admin ? (
              <div className="mt-5 flex flex-wrap items-center gap-3">
                <a href={`/c/${c.id}/as/${c.admin.id}`} className="btn btn-primary !h-9">
                  Open as {c.admin.name.split(' ')[0]}, admin
                </a>
                <Link href={`/c/${c.id}`} className="text-sm text-muted hover:text-ink">
                  View as another member →
                </Link>
              </div>
            ) : (
              <Link href={`/c/${c.id}`} className="btn btn-ghost mt-5 !h-9 w-fit">
                Open treasury
              </Link>
            )}
          </div>
        )
      })}
    </div>
  )
}

function CollectiveGridSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {[0, 1].map((i) => (
        <div key={i} className="card h-[188px] animate-pulse" />
      ))}
    </div>
  )
}
