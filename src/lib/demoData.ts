import type { PrismaClient } from '@prisma/client'
import { recordEvent } from './audit'
import { formatMoney } from './money'

// Demo history is clearly marked source=IMPORTED so it can never be mistaken
// for a PayPal-verified event. Everything created after this (contributions,
// payouts) goes through real PayPal sandbox calls and webhooks.

const DAY = 24 * 60 * 60 * 1000

/** The showcase treasuries every visitor sees. */
export const DEMO_NAMES = ['The Maya Thompson Scholarship 🎓', "Girls' Trip to Lisbon 🇵🇹", '💍 The Johnsons']
/** Earlier demo stories, replaced at startup. */
export const RETIRED_DEMO_NAMES = ['Whitmore Family Scholarship Fund', 'Westfield Eagles Booster Club']

function daysAgo(n: number) {
  return new Date(Date.now() - n * DAY)
}

type MemberSeed = { name: string; role?: 'MEMBER' | 'APPROVER' | 'ADMIN' }

function emailFor(name: string, domain: string) {
  return `${name.toLowerCase().replace(/[^a-z]+/g, '.').replace(/^\.|\.$/g, '')}@${domain}`
}

type DemoSeed = {
    name: string
    purpose: string
    kind: string
    exitPolicy: 'NO_REFUNDS' | 'UNSPENT_SHARE' | 'VOTE'
    maxMembers: number
    paypalEmail: string
    domain: string
    members: MemberSeed[]
    tiers: { minCents: number; maxCents: number | null; requiredApprovals: number }[]
    openingCents: number
    openingDaysAgo: number
    contributions: { member: string; cents: number; daysAgo: number; memo?: string; goal?: string }[]
    payouts: { title: string; to: string; cents: number; daysAgo: number }[]
    goals: { title: string; kind: 'TARGET' | 'MONTHLY'; perMemberCents: number; dueInDays?: number; startedDaysAgo?: number }[]
}

async function createCollective(prisma: PrismaClient, data: DemoSeed) {
  const collective = await prisma.collective.create({
    data: {
      name: data.name,
      purpose: data.purpose,
      kind: data.kind,
      exitPolicy: data.exitPolicy,
      maxMembers: data.maxMembers,
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

  if (data.openingCents > 0) await prisma.ledgerEntry.create({
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

const DEMO_SEEDS: DemoSeed[] = [
  {
    name: DEMO_NAMES[0],
    purpose:
      "Help us give Maya a chance to start college without carrying the whole burden herself. Maya has been accepted to Howard University. We're a group of family friends and former classmates putting money together to help cover her first year. Everyone can see what has come in, what's been approved, and what's been paid.",
    kind: 'SCHOLARSHIP_FUND',
    exitPolicy: 'NO_REFUNDS',
    maxMembers: 25,
    paypalEmail: 'maya.scholarship@example.com',
    domain: 'friends.example',
    members: [
      { name: 'Angela Brooks', role: 'ADMIN' },
      { name: 'Marcus Reed', role: 'APPROVER' },
      { name: 'Keisha Johnson', role: 'APPROVER' },
      { name: 'David Kim', role: 'APPROVER' },
      { name: 'Tiana Williams' },
      { name: 'Jordan Ellis' },
      { name: 'Olivia Grant' },
      { name: 'Brandon Hayes' },
      { name: 'Naomi Foster' },
      { name: 'Chris Adeyemi' },
    ],
    tiers: [
      { minCents: 0, maxCents: 50_000, requiredApprovals: 1 },
      { minCents: 50_000, maxCents: 300_000, requiredApprovals: 2 },
      { minCents: 300_000, maxCents: null, requiredApprovals: 3 },
    ],
    openingCents: 0,
    openingDaysAgo: 70,
    goals: [
      { title: 'First-year tuition gap', kind: 'TARGET', perMemberCents: 60_000, dueInDays: 35 },
      { title: 'Books & laptop', kind: 'TARGET', perMemberCents: 10_000, dueInDays: 20 },
    ],
    contributions: [
      { member: 'Angela Brooks', cents: 60_000, daysAgo: 64, goal: 'First-year tuition gap' },
      { member: 'Marcus Reed', cents: 60_000, daysAgo: 60, goal: 'First-year tuition gap' },
      { member: 'Keisha Johnson', cents: 30_000, daysAgo: 55, memo: 'First half', goal: 'First-year tuition gap' },
      { member: 'David Kim', cents: 60_000, daysAgo: 50, goal: 'First-year tuition gap' },
      { member: 'Tiana Williams', cents: 25_000, daysAgo: 41, memo: 'From our old study group', goal: 'First-year tuition gap' },
      { member: 'Jordan Ellis', cents: 10_000, daysAgo: 33, goal: 'Books & laptop' },
      { member: 'Olivia Grant', cents: 60_000, daysAgo: 27, memo: 'Matched by my employer', goal: 'First-year tuition gap' },
      { member: 'Brandon Hayes', cents: 10_000, daysAgo: 19, goal: 'Books & laptop' },
      { member: 'Naomi Foster', cents: 15_000, daysAgo: 12, goal: 'First-year tuition gap' },
      { member: 'Chris Adeyemi', cents: 10_000, daysAgo: 6, goal: 'Books & laptop' },
    ],
    payouts: [{ title: 'Enrollment deposit', to: 'Howard University', cents: 50_000, daysAgo: 30 }],
  },
  {
    name: DEMO_NAMES[1],
    purpose:
      "Eight of us. One trip. One place to keep the money together. We're finally doing the trip we've been talking about for years. Everyone is putting in what they can, and we're using this treasury to keep contributions, bookings, and spending in one place.",
    kind: 'GROUP_TRIP',
    exitPolicy: 'UNSPENT_SHARE',
    maxMembers: 8,
    paypalEmail: 'lisbon.trip@example.com',
    domain: 'friends.example',
    members: [
      { name: 'Chloe Bennett', role: 'ADMIN' },
      { name: 'Jasmine Okoro', role: 'APPROVER' },
      { name: 'Sofia Martins', role: 'APPROVER' },
      { name: 'Amara Nwosu' },
      { name: 'Lauren Price' },
      { name: 'Nadia Haddad' },
      { name: 'Emily Tran' },
      { name: 'Zoe Carter' },
    ],
    tiers: [
      { minCents: 0, maxCents: 20_000, requiredApprovals: 1 },
      { minCents: 20_000, maxCents: null, requiredApprovals: 2 },
    ],
    openingCents: 0,
    openingDaysAgo: 90,
    goals: [
      { title: 'Flights & apartment', kind: 'TARGET', perMemberCents: 90_000, dueInDays: 50 },
      { title: 'Spending money', kind: 'TARGET', perMemberCents: 30_000, dueInDays: 70 },
    ],
    contributions: [
      { member: 'Chloe Bennett', cents: 90_000, daysAgo: 80, goal: 'Flights & apartment' },
      { member: 'Jasmine Okoro', cents: 90_000, daysAgo: 78, goal: 'Flights & apartment' },
      { member: 'Sofia Martins', cents: 45_000, daysAgo: 70, memo: 'First half', goal: 'Flights & apartment' },
      { member: 'Amara Nwosu', cents: 90_000, daysAgo: 66, goal: 'Flights & apartment' },
      { member: 'Lauren Price', cents: 60_000, daysAgo: 52, goal: 'Flights & apartment' },
      { member: 'Nadia Haddad', cents: 90_000, daysAgo: 45, goal: 'Flights & apartment' },
      { member: 'Emily Tran', cents: 30_000, daysAgo: 30, goal: 'Flights & apartment' },
      { member: 'Zoe Carter', cents: 90_000, daysAgo: 21, goal: 'Flights & apartment' },
      { member: 'Sofia Martins', cents: 45_000, daysAgo: 14, memo: 'Second half', goal: 'Flights & apartment' },
      { member: 'Chloe Bennett', cents: 15_000, daysAgo: 5, goal: 'Spending money' },
    ],
    payouts: [
      { title: 'Apartment deposit: Alfama, 6 nights', to: 'Alfama apartment host', cents: 140_000, daysAgo: 40 },
      { title: 'Fado night reservation', to: 'Fado house in Alfama', cents: 24_000, daysAgo: 10 },
    ],
  },
  {
    name: DEMO_NAMES[2],
    purpose:
      "Long-term partnership. We're building our life together, so we want our finances to work that way too. Both of us can contribute, see what's happening, and make decisions about our shared money without one person having to manage everything alone.",
    kind: 'HOUSEHOLD',
    exitPolicy: 'VOTE',
    maxMembers: 2,
    paypalEmail: 'the.johnsons@example.com',
    domain: 'home.example',
    members: [
      { name: 'Aaliyah Johnson', role: 'ADMIN' },
      { name: 'Andre Johnson', role: 'APPROVER' },
    ],
    // Two people: every payment needs the other partner's yes.
    tiers: [{ minCents: 0, maxCents: null, requiredApprovals: 1 }],
    openingCents: 0,
    openingDaysAgo: 95,
    goals: [
      { title: 'Monthly household pot', kind: 'MONTHLY', perMemberCents: 150_000, startedDaysAgo: 95 },
      { title: 'Emergency fund', kind: 'TARGET', perMemberCents: 250_000, dueInDays: 120 },
    ],
    contributions: [
      { member: 'Aaliyah Johnson', cents: 150_000, daysAgo: 92, goal: 'Monthly household pot' },
      { member: 'Andre Johnson', cents: 150_000, daysAgo: 91, goal: 'Monthly household pot' },
      { member: 'Aaliyah Johnson', cents: 150_000, daysAgo: 62, goal: 'Monthly household pot' },
      { member: 'Andre Johnson', cents: 150_000, daysAgo: 61, goal: 'Monthly household pot' },
      { member: 'Andre Johnson', cents: 50_000, daysAgo: 45, memo: 'Bonus from work', goal: 'Emergency fund' },
      { member: 'Aaliyah Johnson', cents: 150_000, daysAgo: 31, goal: 'Monthly household pot' },
      { member: 'Andre Johnson', cents: 150_000, daysAgo: 30, goal: 'Monthly household pot' },
      { member: 'Aaliyah Johnson', cents: 75_000, daysAgo: 16, goal: 'Emergency fund' },
      { member: 'Aaliyah Johnson', cents: 150_000, daysAgo: 2, goal: 'Monthly household pot' },
    ],
    payouts: [
      { title: 'Rent', to: 'Parkside Apartments', cents: 210_000, daysAgo: 88 },
      { title: 'Rent', to: 'Parkside Apartments', cents: 210_000, daysAgo: 58 },
      { title: 'Car insurance (6 months)', to: 'Car insurer', cents: 59_000, daysAgo: 40 },
      { title: 'Rent', to: 'Parkside Apartments', cents: 210_000, daysAgo: 28 },
    ],
  },
]

/** Seed every showcase treasury (fresh database). */
export async function createDemoCollectives(prisma: PrismaClient) {
  const out = []
  for (const seed of DEMO_SEEDS) out.push(await createCollective(prisma, seed))
  return out
}

/** Seed any showcase treasury that's missing; returns the names it created. */
export async function ensureDemoCollectives(prisma: PrismaClient) {
  const existing = new Set((await prisma.collective.findMany({ where: { isDemo: true }, select: { name: true } })).map((c) => c.name))
  // Demos still on the default policy (created before exit policies existed) get their story's policy.
  for (const seed of DEMO_SEEDS) {
    await prisma.collective.updateMany({ where: { isDemo: true, name: seed.name, exitPolicy: 'VOTE', status: 'OPEN' }, data: { exitPolicy: seed.exitPolicy } })
    await prisma.collective.updateMany({ where: { isDemo: true, name: seed.name, maxMembers: 50 }, data: { maxMembers: seed.maxMembers } })
  }
  const created: string[] = []
  for (const seed of DEMO_SEEDS.filter((d) => !existing.has(d.name))) {
    await createCollective(prisma, seed)
    created.push(seed.name)
  }
  return created
}

/** Seal the activity history for a demo that doesn't have one yet. */
export async function backfillDemo(prisma: PrismaClient, collectiveId: string) {
  await writeDemoHistory(prisma, collectiveId)
}
