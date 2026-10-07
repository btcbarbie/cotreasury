import Link from 'next/link'
import { Suspense } from 'react'
import { connection } from 'next/server'
import { ArrowRight, ArrowUpRight, BadgeCheck, BookOpen, GraduationCap, HandHeart, Link2, Plus, Scale, Send, ShieldCheck, Sparkles, Trophy, UserX, Users } from 'lucide-react'
import { listCollectives, myTreasuryIds } from '@/lib/collectives'
import { formatMoney } from '@/lib/money'

const KIND_META: Record<string, { label: string; Icon: typeof Users; tone: string; bar: string }> = {
  SCHOLARSHIP_FUND: { label: 'Scholarship fund', Icon: GraduationCap, tone: 'bg-violet-soft text-violet', bar: 'from-violet to-teal' },
  BOOSTER_CLUB: { label: 'Booster club', Icon: Trophy, tone: 'bg-amber-soft text-amber', bar: 'from-amber to-red' },
  COMMUNITY_FUND: { label: 'Community fund', Icon: HandHeart, tone: 'bg-accent-soft text-accent', bar: 'from-accent to-teal' },
  OTHER: { label: 'Treasury', Icon: Users, tone: 'bg-blue-soft text-blue', bar: 'from-blue to-violet' },
}

const PILLARS = [
  {
    title: 'AI Treasurer',
    body: 'AI never holds or controls your money. It helps manage the treasury fairly.',
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

const PRINCIPLES = [
  {
    title: 'AI reads, people decide',
    body: 'The AI Treasurer reads the ledger and drafts requests. Fixed rules do the maths, and a person makes every decision.',
    Icon: Sparkles,
  },
  {
    title: 'No self-approval',
    body: 'Whoever asks to spend can never approve it. That includes the admin.',
    Icon: UserX,
  },
  {
    title: 'PayPal confirms every dollar',
    body: 'Money only counts once PayPal confirms it with a signed webhook. Nobody types in “paid”.',
    Icon: BadgeCheck,
  },
  {
    title: 'History you can check',
    body: 'Every action is sealed to the one before it. If anyone edits the past, the integrity check fails.',
    Icon: Link2,
  },
]

export default function Home() {
  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6">
      {/* Hero */}
      <section className="relative pt-14 pb-16 sm:pt-20 sm:pb-20">
        <div className="pointer-events-none absolute -top-10 right-0 -z-10 h-72 w-72 rounded-full bg-violet/10 blur-3xl sm:h-96 sm:w-96" />
        <div className="pointer-events-none absolute top-24 -left-10 -z-10 h-56 w-56 rounded-full bg-teal/10 blur-3xl" />
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
        <p className="mt-5 text-sm font-medium tracking-tight sm:text-base">
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
      </section>

      <Suspense fallback={null}>
        <MyTreasuries />
      </Suspense>

      {/* Pillars */}
      <section id="how-it-works" className="scroll-mt-20 border-t border-line py-14 sm:py-16">
        <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">Your money. Your rules. Your collective.</h2>
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

      {/* Principles */}
      <section className="border-t border-line py-14 sm:py-16">
        <div className="flex items-center gap-2 text-sm font-medium text-accent">
          <ShieldCheck size={16} /> Built for trust
        </div>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">How CoTreasury keeps everyone honest</h2>
        <div className="mt-8 grid gap-x-8 gap-y-6 sm:grid-cols-2">
          {PRINCIPLES.map((p) => (
            <div key={p.title} className="flex gap-4">
              <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-ink text-white">
                <p.Icon size={18} />
              </span>
              <div>
                <div className="font-semibold tracking-tight">{p.title}</div>
                <p className="mt-1 text-sm leading-relaxed text-muted">{p.body}</p>
              </div>
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
    <div className="grid gap-4 sm:grid-cols-2">
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
                <div className="tabular text-lg font-semibold tracking-tight">{formatMoney(c.treasury.availableCents, c.currency)}</div>
                <div className="text-xs text-muted">Available</div>
              </div>
              <div>
                <div className="tabular text-lg font-semibold tracking-tight">{c.verifiedCount}</div>
                <div className="text-xs text-muted">Verified records</div>
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
