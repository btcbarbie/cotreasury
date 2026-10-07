import Link from 'next/link'
import { Suspense } from 'react'
import { connection } from 'next/server'
import { ArrowUpRight, GraduationCap, Sparkles, Trophy, Users } from 'lucide-react'
import { listCollectives } from '@/lib/collectives'
import { formatMoney } from '@/lib/money'

const KIND_META: Record<string, { label: string; Icon: typeof Users; tone: string; bar: string }> = {
  SCHOLARSHIP_FUND: { label: 'Scholarship fund', Icon: GraduationCap, tone: 'bg-violet-soft text-violet', bar: 'from-violet to-teal' },
  BOOSTER_CLUB: { label: 'Booster club', Icon: Trophy, tone: 'bg-amber-soft text-amber', bar: 'from-amber to-red' },
}

export default function Home() {
  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6 py-12 sm:py-16">
      <section className="max-w-2xl">
        <span className="pill pill-violet mb-4">
          <Sparkles size={12} /> AI Treasurer · PayPal rails · shared ledger
        </span>
        <h1 className="text-3xl sm:text-5xl font-semibold tracking-tight">
          Spend together, <span className="bg-gradient-to-r from-accent via-teal to-violet bg-clip-text text-transparent">safely.</span>
        </h1>
        <p className="mt-3 text-muted text-base sm:text-lg leading-relaxed">
          Your group&apos;s money stays in its own PayPal account. An AI Treasurer checks every request, members
          approve by the rules you set, and a shared ledger shows everyone exactly where each dollar went.
        </p>
      </section>

      <section className="mt-10">
        <div className="label mb-3">Your collectives</div>
        <Suspense fallback={<CollectiveGridSkeleton />}>
          <CollectiveGrid />
        </Suspense>
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
        const meta = KIND_META[c.kind] ?? { label: 'Collective', Icon: Users, tone: 'bg-bg text-muted', bar: 'from-ink to-muted' }
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
                <div className="tabular text-2xl font-semibold tracking-tight">
                  {formatMoney(c.treasury.availableCents, c.currency)}
                </div>
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
