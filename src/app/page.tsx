import Link from 'next/link'
import { Suspense } from 'react'
import { connection } from 'next/server'
import { ArrowRight, ArrowUpRight, BookOpen, GraduationCap, Scale, Send, Sparkles, Trophy, Users } from 'lucide-react'
import { listCollectives } from '@/lib/collectives'
import { formatMoney } from '@/lib/money'

const KIND_META: Record<string, { label: string; Icon: typeof Users; tone: string; bar: string }> = {
  SCHOLARSHIP_FUND: { label: 'Scholarship fund', Icon: GraduationCap, tone: 'bg-violet-soft text-violet', bar: 'from-violet to-teal' },
  BOOSTER_CLUB: { label: 'Booster club', Icon: Trophy, tone: 'bg-amber-soft text-amber', bar: 'from-amber to-red' },
}

const PILLARS = [
  {
    title: 'AI Treasurer',
    body: 'Understands your treasury, tracks commitments, evaluates spending requests, and coordinates financial decisions.',
    Icon: Sparkles,
    tone: 'bg-violet-soft text-violet',
  },
  {
    title: 'Collective Governance',
    body: 'Define who can approve transactions and how much authority each decision requires.',
    Icon: Scale,
    tone: 'bg-accent-soft text-accent',
  },
  {
    title: 'PayPal Rails',
    body: "Move approved transactions through PayPal's payment infrastructure.",
    Icon: Send,
    tone: 'bg-blue-soft text-blue',
  },
  {
    title: 'Shared Ledger',
    body: "Keep the collective's financial state visible, traceable, and up to date.",
    Icon: BookOpen,
    tone: 'bg-teal-soft text-teal',
  },
]

const STEPS = [
  'Create a treasury around a shared purpose.',
  'Bring contributors together.',
  'Set the rules.',
  'Coordinate decisions.',
  'Move money when the collective approves.',
]

export default function Home() {
  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6">
      {/* Hero */}
      <section className="relative pt-14 pb-16 sm:pt-20 sm:pb-20">
        <div className="pointer-events-none absolute -top-10 right-0 -z-10 h-72 w-72 rounded-full bg-violet/10 blur-3xl sm:h-96 sm:w-96" />
        <div className="pointer-events-none absolute top-24 -left-10 -z-10 h-56 w-56 rounded-full bg-teal/10 blur-3xl" />
        <span className="pill pill-violet mb-5">Shared purpose. Shared treasury. Collective control.</span>
        <h1 className="text-5xl font-semibold leading-none tracking-tight sm:text-7xl">
          <span className="bg-gradient-to-r from-accent via-teal to-violet bg-clip-text text-transparent">CoTreasury</span>
        </h1>
        <p className="mt-4 max-w-3xl text-lg font-medium leading-snug tracking-tight sm:text-2xl">
          A treasury governed by the collective it serves.
        </p>
        <p className="mt-6 max-w-2xl text-base leading-relaxed text-muted sm:text-lg">
          When people share a purpose, managing the money shouldn&apos;t depend on one person. CoTreasury gives groups a shared
          financial layer to coordinate contributions, understand their treasury, govern spending, and act together, with AI
          as the financial coordinator and people in control.
        </p>
        <p className="mt-5 text-sm font-medium tracking-tight sm:text-base">
          AI coordinates. People govern. PayPal moves. The ledger remembers.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <a href="#treasuries" className="btn btn-primary !h-11 !px-5">
            Create a Treasury <ArrowRight size={16} />
          </a>
          <a href="#how-it-works" className="btn btn-ghost !h-11 !px-5">
            See How It Works
          </a>
        </div>
      </section>

      {/* Pillars */}
      <section className="border-t border-line py-14 sm:py-16">
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

      {/* How it works */}
      <section id="how-it-works" className="scroll-mt-20 border-t border-line py-14 sm:py-16">
        <div className="grid gap-10 lg:grid-cols-[1fr_1.1fr] lg:items-center">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">From collective intent to collective action.</h2>
            <p className="mt-4 text-lg font-medium tracking-tight">
              No single person has to be the{' '}
              <span className="bg-gradient-to-r from-accent to-violet bg-clip-text text-transparent">source of truth.</span>
            </p>
          </div>
          <ol className="grid gap-2.5">
            {STEPS.map((s, i) => (
              <li key={s} className="card flex items-center gap-4 px-4 py-3.5">
                <span className="tabular inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ink text-xs font-semibold text-white">
                  {i + 1}
                </span>
                <span className="text-sm sm:text-base">{s}</span>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Live demo treasuries */}
      <section id="treasuries" className="scroll-mt-20 border-t border-line py-14 sm:py-16">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">Explore a live treasury</h2>
            <p className="mt-2 text-muted">Sandbox demos running on PayPal. Switch between members to try contributing, requesting and approving.</p>
          </div>
        </div>
        <div className="mt-8">
          <Suspense fallback={<CollectiveGridSkeleton />}>
            <CollectiveGrid />
          </Suspense>
        </div>
      </section>
    </div>
  )
}

async function CollectiveGrid() {
  await connection() // live balances: never prerender this list at build time
  const collectives = await listCollectives()
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {collectives.map((c) => {
        const meta = KIND_META[c.kind] ?? { label: 'Treasury', Icon: Users, tone: 'bg-bg text-muted', bar: 'from-ink to-muted' }
        return (
          <Link
            key={c.id}
            href={`/c/${c.id}`}
            className="card group relative overflow-hidden p-5 transition hover:border-line-strong hover:shadow-[0_4px_24px_rgba(0,0,0,0.06)]"
          >
            <span className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${meta.bar}`} />
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2 text-sm text-muted">
                <span className={`inline-flex h-7 w-7 items-center justify-center rounded-lg ${meta.tone}`}>
                  <meta.Icon size={15} strokeWidth={2} />
                </span>
                {meta.label}
              </div>
              <ArrowUpRight size={16} className="text-faint transition group-hover:text-ink" />
            </div>
            <div className="mt-3 text-lg font-semibold tracking-tight">{c.name}</div>
            <p className="mt-1 text-sm text-muted line-clamp-2">{c.purpose}</p>
            <div className="mt-5 flex items-end justify-between">
              <div>
                <div className="text-xs text-muted">Available</div>
                <div className="tabular text-2xl font-semibold tracking-tight">{formatMoney(c.treasury.availableCents, c.currency)}</div>
              </div>
              <div className="flex items-center gap-1 text-sm text-muted">
                <Users size={14} /> {c.memberCount}
              </div>
            </div>
          </Link>
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
