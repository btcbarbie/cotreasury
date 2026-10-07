import Link from 'next/link'
import { Suspense } from 'react'
import { ArrowUpRight, GraduationCap, Trophy, Users } from 'lucide-react'
import { listCollectives } from '@/lib/collectives'
import { formatMoney } from '@/lib/money'

const KIND_META: Record<string, { label: string; Icon: typeof Users }> = {
  SCHOLARSHIP_FUND: { label: 'Scholarship fund', Icon: GraduationCap },
  BOOSTER_CLUB: { label: 'Booster club', Icon: Trophy },
}

export default function Home() {
  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6 py-12 sm:py-16">
      <section className="max-w-2xl">
        <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">Spend together, safely.</h1>
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
  const collectives = await listCollectives()
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {collectives.map((c) => {
        const meta = KIND_META[c.kind] ?? { label: 'Collective', Icon: Users }
        return (
          <Link
            key={c.id}
            href={`/c/${c.id}`}
            className="card group p-5 transition hover:border-line-strong hover:shadow-[0_1px_12px_rgba(0,0,0,0.04)]"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2 text-sm text-muted">
                <meta.Icon size={15} strokeWidth={1.8} />
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
