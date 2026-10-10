import { Suspense } from 'react'
import { connection } from 'next/server'
import Link from 'next/link'
import { ChevronLeft, Link2Off, UsersRound } from 'lucide-react'
import { prisma } from '@/lib/prisma'
import { JoinForm } from '@/components/JoinForm'

export const metadata = { title: 'Join a treasury — CoTreasury' }

export default function JoinPage({ params }: PageProps<'/join/[code]'>) {
  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
      <Link href="/" className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
        <ChevronLeft size={15} /> Home
      </Link>
      <div className="mx-auto mt-6 max-w-md">
        <Suspense fallback={<div className="card h-64 animate-pulse" />}>
          <Invite params={params} />
        </Suspense>
      </div>
    </div>
  )
}

async function Invite({ params }: { params: Promise<{ code: string }> }) {
  await connection()
  const { code } = await params
  const c = await prisma.collective.findFirst({
    where: { inviteCode: code, status: 'OPEN' },
    select: { name: true, purpose: true, maxMembers: true, exitPolicy: true, members: { where: { role: { not: 'FORMER' } }, select: { role: true } } },
  })
  if (!c) {
    return (
      <div className="card px-6 py-10 text-center">
        <Link2Off size={22} className="mx-auto text-muted" />
        <div className="mt-3 font-semibold tracking-tight">This invite link no longer works</div>
        <p className="mt-1 text-sm text-muted">The admin may have reset or turned it off. Ask them for a new link.</p>
      </div>
    )
  }
  return (
    <div className="card p-6">
      <div className="text-xs text-muted">You&apos;re invited to join</div>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">{c.name}</h1>
      <p className="mt-2 text-sm text-muted">{c.purpose}</p>
      <div className="mt-3 inline-flex items-center gap-1.5 text-xs text-muted">
        <UsersRound size={13} /> {c.members.length} of {c.maxMembers} members
      </div>
      <ul className="mt-5 grid gap-1.5 rounded-lg bg-bg px-4 py-3 text-sm text-ink/80">
        <li>• See every dollar in and out, confirmed by PayPal.</li>
        <li>• Add funds and request payouts. The group&apos;s approvers vote on every payout.</li>
        <li>• Nobody, including the admin, can move money without the group&apos;s rules being met.</li>
      </ul>
      {c.exitPolicy === 'NO_REFUNDS' && (
        <div className="mt-4 rounded-lg bg-amber-soft px-4 py-3 text-sm text-amber">
          <span className="font-semibold">No refunds.</span> Money you put into this group stays with it, even if you leave later.
        </div>
      )}
      {c.members.length >= c.maxMembers ? (
        <div className="mt-5 rounded-lg bg-bg px-4 py-3 text-sm text-muted">
          This group is full. Ask the admin; the group can raise its member limit with a rule change.
        </div>
      ) : (
        <JoinForm code={code} />
      )}
    </div>
  )
}
