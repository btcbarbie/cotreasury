import { randomBytes } from 'node:crypto'
import { cookies } from 'next/headers'
import { prisma } from './prisma'
import { computeTreasury } from './treasury'
import { refreshPanels } from './panel'
import { closeStaleRequests } from './voting'
import { DEMO_ORDER } from './demoData'
import { reconcileInBackground } from './reconcile'

export function viewerCookieName(collectiveId: string) {
  return `tp_viewer_${collectiveId}`
}

/** A personal sign-in link token for a member of a treasury people created. */
export function newAccessToken() {
  return randomBytes(24).toString('base64url')
}

export const VIEWER_COOKIE_OPTIONS = { path: '/', sameSite: 'lax', httpOnly: true, maxAge: 60 * 60 * 24 * 180 } as const

/**
 * Which member this browser is. Demos store the member id (anyone may switch).
 * Treasuries people create store the member's secret token, so nobody can act
 * as someone else by guessing an id. Members from before tokens existed are
 * still recognised by id until they get one.
 */
function matchViewer<M extends { id: string; accessToken: string | null }>(members: M[], value: string | undefined, isDemo: boolean) {
  if (!value) return undefined
  return isDemo ? members.find((m) => m.id === value) : members.find((m) => (m.accessToken ? m.accessToken === value : m.id === value))
}

export const MY_TREASURIES_COOKIE = 'ct_mine'
/** Identifies a browser: its private demo copies and its AI question allowance. */
export const VISITOR_COOKIE = 'ct_visitor'

/** Treasury ids this browser created (demo-mode ownership; not authentication). */
export async function myTreasuryIds(): Promise<string[]> {
  const jar = await cookies()
  return (jar.get(MY_TREASURIES_COOKIE)?.value ?? '').split(',').filter(Boolean)
}

export async function listCollectives(filter: { demo: true } | { demoFor: string } | { ids: string[] }) {
  const collectives = await prisma.collective.findMany({
    where: 'demo' in filter ? { isDemo: true, demoOwner: null } : 'demoFor' in filter ? { isDemo: true, demoOwner: filter.demoFor } : { id: { in: filter.ids }, isDemo: false },
    orderBy: { createdAt: 'asc' },
    include: {
      entries: { select: { direction: true, status: true, amountCents: true } },
      proposals: { select: { status: true, amountCents: true } },
      _count: { select: { members: { where: { role: { not: 'FORMER' } } }, events: true } },
      members: { where: { role: 'ADMIN' }, select: { id: true, name: true }, take: 1 },
    },
  })
  // Demos follow the showcase order (the business story first); others oldest first.
  if ('demo' in filter || 'demoFor' in filter) {
    const rank = (key: string | null) => (key ? DEMO_ORDER.indexOf(key) + 1 : 0) || DEMO_ORDER.length + 1
    collectives.sort((a, b) => rank(a.demoKey) - rank(b.demoKey))
  }
  return collectives.map((c) => ({
    id: c.id,
    name: c.name,
    purpose: c.purpose,
    kind: c.kind,
    demoKey: c.demoKey,
    status: c.status,
    currency: c.currency,
    memberCount: c._count.members,
    eventCount: c._count.events,
    inflowCents: c.entries.filter((e) => e.direction === 'IN' && e.status === 'CONFIRMED').reduce((s, e) => s + e.amountCents, 0),
    admin: c.members[0] ?? null,
    treasury: computeTreasury(c.entries, c.proposals),
  }))
}

export async function getCollectiveView(id: string) {
  // Lazily replace panel reviewers whose 48-hour window passed without a vote,
  // and close requests that couldn't pass once the remaining voters had theirs.
  await refreshPanels(id)
  await closeStaleRequests(id)
  // Compare the group's PayPal history with the ledger (throttled, never blocks the page).
  reconcileInBackground(id)
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

  // Who is "signed in" is a per-treasury cookie. In demos it defaults to the
  // admin (and anyone can switch); in treasuries people create there is no
  // default: you're only someone if your browser was signed in as them.
  const jar = await cookies()
  const viewer =
    matchViewer(collective.members, jar.get(viewerCookieName(id))?.value, collective.isDemo) ??
    (collective.isDemo ? (collective.members.find((m) => m.role === 'ADMIN') ?? collective.members[0]) : null)

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
  const [members, c] = await Promise.all([
    prisma.member.findMany({ where: { collectiveId, role: { not: 'FORMER' } }, orderBy: { createdAt: 'asc' } }),
    prisma.collective.findUnique({ where: { id: collectiveId }, select: { isDemo: true } }),
  ])
  const me = matchViewer(members, jar.get(viewerCookieName(collectiveId))?.value, !!c?.isDemo)
  if (me || !c?.isDemo) return me ?? null
  return members.find((m) => m.role === 'ADMIN') ?? members[0] ?? null
}

/**
 * Can this browser see this treasury's data? Demos are open to everyone; a
 * treasury people created is private to its signed-in members. API routes use
 * this so a private treasury's ledger, receipts and AI can't be read by anyone
 * who merely knows an id.
 */
export async function canAccess(collectiveId: string) {
  const c = await prisma.collective.findUnique({ where: { id: collectiveId }, select: { isDemo: true } })
  if (!c) return false
  return c.isDemo || !!(await getViewer(collectiveId))
}
