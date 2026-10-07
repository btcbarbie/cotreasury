import type { PrismaClient } from '@prisma/client'
import { recordEvent } from './audit'
import { formatMoney } from './money'

// Demo history is clearly marked source=IMPORTED so it can never be mistaken
// for a PayPal-verified event. Everything created after this (contributions,
// payouts) goes through real PayPal sandbox calls and webhooks.

const DAY = 24 * 60 * 60 * 1000

function daysAgo(n: number) {
  return new Date(Date.now() - n * DAY)
}

type MemberSeed = { name: string; role?: 'MEMBER' | 'APPROVER' | 'ADMIN' }

function emailFor(name: string, domain: string) {
  return `${name.toLowerCase().replace(/[^a-z]+/g, '.').replace(/^\.|\.$/g, '')}@${domain}`
}

async function createCollective(
  prisma: PrismaClient,
  data: {
    name: string
    purpose: string
    kind: string
    paypalEmail: string
    domain: string
    members: MemberSeed[]
    tiers: { minCents: number; maxCents: number | null; requiredApprovals: number }[]
    openingCents: number
    openingDaysAgo: number
    contributions: { member: string; cents: number; daysAgo: number; memo?: string; goal?: string }[]
    payouts: { title: string; to: string; cents: number; daysAgo: number }[]
    goals: { title: string; kind: 'TARGET' | 'MONTHLY'; perMemberCents: number; dueInDays?: number; startedDaysAgo?: number }[]
  },
) {
  const collective = await prisma.collective.create({
    data: {
      name: data.name,
      purpose: data.purpose,
      kind: data.kind,
      paypalEmail: data.paypalEmail,
      isDemo: true,
      tiers: { create: data.tiers },
      members: {
        create: data.members.map((m, i) => ({
          name: m.name,
          email: emailFor(m.name, data.domain),
          role: m.role ?? 'MEMBER',
          createdAt: daysAgo(data.openingDaysAgo - i),
        })),
      },
    },
    include: { members: true },
  })

  const byName = new Map(collective.members.map((m) => [m.name, m]))
  const goalIds = new Map<string, string>()
  for (const g of data.goals) {
    const goal = await prisma.goal.create({
      data: {
        collectiveId: collective.id,
        title: g.title,
        kind: g.kind,
        perMemberCents: g.perMemberCents,
        dueDate: g.dueInDays != null ? new Date(Date.now() + g.dueInDays * DAY) : null,
        startMonth: g.startedDaysAgo != null ? daysAgo(g.startedDaysAgo) : null,
        createdAt: daysAgo(data.openingDaysAgo),
      },
    })
    goalIds.set(g.title, goal.id)
  }

  await prisma.ledgerEntry.create({
    data: {
      collectiveId: collective.id,
      type: 'OPENING_BALANCE',
      direction: 'IN',
      amountCents: data.openingCents,
      status: 'CONFIRMED',
      source: 'IMPORTED',
      memo: 'Opening balance carried over from previous treasurer',
      createdAt: daysAgo(data.openingDaysAgo),
      confirmedAt: daysAgo(data.openingDaysAgo),
    },
  })

  for (const c of data.contributions) {
    const m = byName.get(c.member)
    await prisma.ledgerEntry.create({
      data: {
        collectiveId: collective.id,
        type: 'CONTRIBUTION',
        direction: 'IN',
        amountCents: c.cents,
        status: 'CONFIRMED',
        source: 'IMPORTED',
        memo: c.memo ?? 'Member contribution',
        counterparty: c.member,
        memberId: m?.id,
        goalId: c.goal ? goalIds.get(c.goal) : null,
        createdAt: daysAgo(c.daysAgo),
        confirmedAt: daysAgo(c.daysAgo),
      },
    })
  }

  for (const p of data.payouts) {
    await prisma.ledgerEntry.create({
      data: {
        collectiveId: collective.id,
        type: 'PAYOUT',
        direction: 'OUT',
        amountCents: p.cents,
        status: 'CONFIRMED',
        source: 'IMPORTED',
        memo: p.title,
        counterparty: p.to,
        createdAt: daysAgo(p.daysAgo),
        confirmedAt: daysAgo(p.daysAgo),
      },
    })
  }

  await writeDemoHistory(prisma, collective.id)
  return collective
}

/**
 * Seal the imported history into the activity log, oldest first, so the demo
 * starts with a verifiable chain. Only runs for a collective with no events.
 */
export async function writeDemoHistory(prisma: PrismaClient, collectiveId: string) {
  if ((await prisma.auditEvent.count({ where: { collectiveId } })) > 0) return
  const c = await prisma.collective.findUniqueOrThrow({
    where: { id: collectiveId },
    include: { members: true, goals: true, entries: { orderBy: { createdAt: 'asc' } } },
  })
  const admin = c.members.find((m) => m.role === 'ADMIN')
  const start = c.entries[0]?.createdAt ?? c.createdAt
  await recordEvent(c.id, { actor: admin?.name ?? 'Admin', action: 'TREASURY_CREATED', summary: `opened the treasury with ${c.members.length} members`, at: start })
  for (const g of c.goals) {
    await recordEvent(c.id, {
      actor: admin?.name ?? 'Admin',
      action: 'GOAL_CREATED',
      summary: `set a goal: ${g.title} (${formatMoney(g.perMemberCents, c.currency)} per member${g.kind === 'MONTHLY' ? ' each month' : ''})`,
      data: { goalId: g.id },
      at: start,
    })
  }
  for (const e of c.entries) {
    const amount = formatMoney(e.amountCents, c.currency, { cents: true })
    const summary =
      e.type === 'OPENING_BALANCE'
        ? `imported an opening balance of ${amount} from the previous treasurer's records`
        : e.type === 'PAYOUT'
          ? `paid out ${amount} to ${e.counterparty}: ${e.memo} (imported record)`
          : `paid ${amount}${e.memo ? ` (${e.memo})` : ''} (imported record)`
    await recordEvent(c.id, {
      actor: e.type === 'CONTRIBUTION' ? (e.counterparty ?? 'A member') : (admin?.name ?? 'Admin'),
      action: `${e.type}_IMPORTED`,
      summary,
      data: { entryId: e.id, amountCents: e.amountCents },
      at: e.createdAt,
    })
  }
}

export async function createDemoCollectives(prisma: PrismaClient) {
  const scholarship = await createCollective(prisma, {
    name: 'Whitmore Family Scholarship Fund',
    purpose:
      'Alumni-funded scholarships for first-generation college students from Riverside High. Five trustees approve every award.',
    kind: 'SCHOLARSHIP_FUND',
    paypalEmail: 'treasury@whitmorefund.org',
    domain: 'alumni.example',
    members: [
      { name: 'Grace Adeyemi', role: 'ADMIN' },
      { name: 'Daniel Brooks', role: 'APPROVER' },
      { name: 'Ifeoma Nwosu', role: 'APPROVER' },
      { name: 'Marcus Lee', role: 'APPROVER' },
      { name: 'Sarah Whitfield', role: 'APPROVER' },
      { name: 'Tunde Bakare' },
      { name: 'Emily Carter' },
      { name: 'Chidi Eze' },
      { name: 'Hannah Kim' },
      { name: 'Joshua Martins' },
      { name: 'Priya Nair' },
      { name: 'Olumide Shittu' },
    ],
    tiers: [
      { minCents: 0, maxCents: 50_000, requiredApprovals: 1 },
      { minCents: 50_000, maxCents: 500_000, requiredApprovals: 2 },
      { minCents: 500_000, maxCents: 2_500_000, requiredApprovals: 3 },
      { minCents: 2_500_000, maxCents: null, requiredApprovals: 4 },
    ],
    openingCents: 820_000,
    openingDaysAgo: 120,
    contributions: [
      { member: 'Tunde Bakare', cents: 100_000, daysAgo: 96, memo: 'Annual pledge' },
      { member: 'Emily Carter', cents: 50_000, daysAgo: 88 },
      { member: 'Chidi Eze', cents: 25_000, daysAgo: 80 },
      { member: 'Hannah Kim', cents: 75_000, daysAgo: 71, memo: 'Matched by employer' },
      { member: 'Joshua Martins', cents: 30_000, daysAgo: 60 },
      { member: 'Priya Nair', cents: 120_000, daysAgo: 44, memo: 'Annual pledge' },
      { member: 'Olumide Shittu', cents: 40_000, daysAgo: 31, goal: 'Fall 2026 awards' },
      { member: 'Grace Adeyemi', cents: 60_000, daysAgo: 18, goal: 'Fall 2026 awards' },
      { member: 'Marcus Lee', cents: 35_000, daysAgo: 9, goal: 'Fall 2026 awards' },
    ],
    goals: [{ title: 'Fall 2026 awards', kind: 'TARGET', perMemberCents: 50_000, dueInDays: 40 }],
    payouts: [{ title: 'Spring award — 2 scholarships', to: '2 students', cents: 300_000, daysAgo: 55 }],
  })

  const booster = await createCollective(prisma, {
    name: 'Westfield Eagles Booster Club',
    purpose:
      'Parent-run fund for the Westfield High varsity teams: travel, uniforms and equipment. Three officers share approval.',
    kind: 'BOOSTER_CLUB',
    paypalEmail: 'boosters@westfieldeagles.org',
    domain: 'parents.example',
    members: [
      { name: 'Linda Morales', role: 'ADMIN' },
      { name: 'Kevin Osei', role: 'APPROVER' },
      { name: 'Rachel Turner', role: 'APPROVER' },
      { name: 'Brian Walsh' },
      { name: 'Aisha Bello' },
      { name: 'Tom Henderson' },
      { name: 'Mei Chen' },
      { name: 'Carlos Rivera' },
    ],
    tiers: [
      { minCents: 0, maxCents: 25_000, requiredApprovals: 1 },
      { minCents: 25_000, maxCents: 200_000, requiredApprovals: 2 },
      { minCents: 200_000, maxCents: null, requiredApprovals: 3 },
    ],
    openingCents: 312_000,
    openingDaysAgo: 75,
    contributions: [
      { member: 'Brian Walsh', cents: 15_000, daysAgo: 62, memo: 'Season dues', goal: 'Season dues 2026' },
      { member: 'Aisha Bello', cents: 15_000, daysAgo: 61, memo: 'Season dues', goal: 'Season dues 2026' },
      { member: 'Tom Henderson', cents: 15_000, daysAgo: 58, memo: 'Season dues', goal: 'Season dues 2026' },
      { member: 'Mei Chen', cents: 25_000, daysAgo: 40, memo: 'Bake sale proceeds' },
      { member: 'Carlos Rivera', cents: 15_000, daysAgo: 33, memo: 'Season dues', goal: 'Season dues 2026' },
    ],
    goals: [
      { title: 'Season dues 2026', kind: 'TARGET', perMemberCents: 15_000, dueInDays: 10 },
      { title: 'Regional finals bus', kind: 'TARGET', perMemberCents: 5_000, dueInDays: 45 },
    ],
    payouts: [{ title: 'New basketball uniforms', to: 'Midwest Team Supply', cents: 96_000, daysAgo: 26 }],
  })

  return { scholarship, booster }
}

// Goals for demo treasuries created before goals existed (production backfill).
const DEMO_GOAL_BACKFILL: Record<string, { goals: { title: string; perMemberCents: number; dueInDays: number }[]; tags: { member: string; cents: number; goal: string }[] }> = {
  'Whitmore Family Scholarship Fund': {
    goals: [{ title: 'Fall 2026 awards', perMemberCents: 50_000, dueInDays: 40 }],
    tags: [
      { member: 'Olumide Shittu', cents: 40_000, goal: 'Fall 2026 awards' },
      { member: 'Grace Adeyemi', cents: 60_000, goal: 'Fall 2026 awards' },
      { member: 'Marcus Lee', cents: 35_000, goal: 'Fall 2026 awards' },
    ],
  },
  'Westfield Eagles Booster Club': {
    goals: [
      { title: 'Season dues 2026', perMemberCents: 15_000, dueInDays: 10 },
      { title: 'Regional finals bus', perMemberCents: 5_000, dueInDays: 45 },
    ],
    tags: ['Brian Walsh', 'Aisha Bello', 'Tom Henderson', 'Carlos Rivera'].map((member) => ({ member, cents: 15_000, goal: 'Season dues 2026' })),
  },
}

export async function backfillDemo(prisma: PrismaClient, collectiveId: string) {
  const c = await prisma.collective.findUniqueOrThrow({ where: { id: collectiveId }, include: { goals: true } })
  const plan = DEMO_GOAL_BACKFILL[c.name]
  if (plan && c.goals.length === 0) {
    for (const g of plan.goals) {
      const goal = await prisma.goal.create({
        data: { collectiveId, title: g.title, kind: 'TARGET', perMemberCents: g.perMemberCents, dueDate: new Date(Date.now() + g.dueInDays * DAY) },
      })
      for (const t of plan.tags.filter((x) => x.goal === g.title)) {
        await prisma.ledgerEntry.updateMany({
          where: { collectiveId, type: 'CONTRIBUTION', source: 'IMPORTED', counterparty: t.member, amountCents: t.cents, goalId: null },
          data: { goalId: goal.id },
        })
      }
    }
  }
  await writeDemoHistory(prisma, collectiveId)
}
