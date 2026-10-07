import { cookies } from 'next/headers'
import { prisma } from './prisma'
import { computeTreasury } from './treasury'

export function viewerCookieName(collectiveId: string) {
  return `tp_viewer_${collectiveId}`
}

export async function listCollectives() {
  const collectives = await prisma.collective.findMany({
    orderBy: { createdAt: 'asc' },
    include: {
      entries: { select: { direction: true, status: true, amountCents: true } },
      proposals: { select: { status: true, amountCents: true } },
      _count: { select: { members: true } },
    },
  })
  return collectives.map((c) => ({
    id: c.id,
    name: c.name,
    purpose: c.purpose,
    kind: c.kind,
    currency: c.currency,
    memberCount: c._count.members,
    treasury: computeTreasury(c.entries, c.proposals),
  }))
}

export async function getCollectiveView(id: string) {
  const collective = await prisma.collective.findUnique({
    where: { id },
    include: {
      members: { orderBy: { createdAt: 'asc' } },
      tiers: { orderBy: { minCents: 'asc' } },
      entries: { orderBy: { createdAt: 'desc' }, include: { member: { select: { name: true } } } },
      proposals: {
        orderBy: { createdAt: 'desc' },
        include: {
          approvals: { include: { member: { select: { name: true } } } },
          recipients: true,
          proposedBy: { select: { name: true } },
        },
      },
    },
  })
  if (!collective) return null

  // Demo identity: who is "logged in" is a per-collective cookie. Defaults to
  // the collective's admin so a first-time visitor lands on the full view.
  const jar = await cookies()
  const viewerId = jar.get(viewerCookieName(id))?.value
  const viewer =
    collective.members.find((m) => m.id === viewerId) ??
    collective.members.find((m) => m.role === 'ADMIN') ??
    collective.members[0]

  return {
    collective,
    viewer,
    treasury: computeTreasury(collective.entries, collective.proposals),
  }
}

export type CollectiveView = NonNullable<Awaited<ReturnType<typeof getCollectiveView>>>
