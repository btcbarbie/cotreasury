import { cookies } from 'next/headers'
import { prisma } from './prisma'
import { computeTreasury } from './treasury'
import { refreshPanels } from './panel'

export function viewerCookieName(collectiveId: string) {
  return `tp_viewer_${collectiveId}`
}

export const MY_TREASURIES_COOKIE = 'ct_mine'

/** Treasury ids this browser created (demo-mode ownership; not authentication). */
export async function myTreasuryIds(): Promise<string[]> {
  const jar = await cookies()
  return (jar.get(MY_TREASURIES_COOKIE)?.value ?? '').split(',').filter(Boolean)
}

export async function listCollectives(filter: { demo: true } | { ids: string[] }) {
  const collectives = await prisma.collective.findMany({
    where: 'demo' in filter ? { isDemo: true } : { id: { in: filter.ids }, isDemo: false },
    orderBy: { createdAt: 'asc' },
    include: {
      entries: { select: { direction: true, status: true, amountCents: true } },
      proposals: { select: { status: true, amountCents: true } },
      _count: { select: { members: { where: { role: { not: 'FORMER' } } }, events: true } },
      members: { where: { role: 'ADMIN' }, select: { id: true, name: true }, take: 1 },
    },
  })
  return collectives.map((c) => ({
    id: c.id,
    name: c.name,
    purpose: c.purpose,
    kind: c.kind,
    currency: c.currency,
    memberCount: c._count.members,
    eventCount: c._count.events,
    verifiedCount: c.entries.filter((e) => e.status === 'CONFIRMED').length,
    admin: c.members[0] ?? null,
    treasury: computeTreasury(c.entries, c.proposals),
  }))
}

export async function getCollectiveView(id: string) {
  // Lazily replace panel reviewers whose 48-hour window passed without a vote.
  await refreshPanels(id)
  const collective = await prisma.collective.findUnique({
    where: { id },
    include: {
      members: { where: { role: { not: 'FORMER' } }, orderBy: { createdAt: 'asc' } },
      tiers: { orderBy: { minCents: 'asc' } },
      goals: { orderBy: { createdAt: 'asc' } },
      events: { orderBy: { seq: 'desc' }, take: 100 },
      entries: {
        orderBy: { createdAt: 'desc' },
        include: {
          member: { select: { name: true } },
          proposal: {
            select: {
              title: true,
              proposedBy: { select: { name: true } },
              approvals: { where: { decision: 'APPROVE' }, orderBy: { createdAt: 'asc' }, select: { member: { select: { name: true } } } },
            },
          },
        },
      },
      proposals: {
        orderBy: { createdAt: 'desc' },
        include: {
          approvals: { include: { member: { select: { name: true } } } },
          recipients: true,
          reviewers: { select: { memberId: true, status: true, seat: true } },
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

/** Resolve the acting member for API routes (same demo cookie as the page). */
export async function getViewer(collectiveId: string) {
  const jar = await cookies()
  const viewerId = jar.get(viewerCookieName(collectiveId))?.value
  const members = await prisma.member.findMany({ where: { collectiveId, role: { not: 'FORMER' } }, orderBy: { createdAt: 'asc' } })
  return members.find((m) => m.id === viewerId) ?? members.find((m) => m.role === 'ADMIN') ?? members[0] ?? null
}
