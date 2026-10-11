import type { PrismaClient } from '@prisma/client'
import { recordEvent } from './audit'
import { formatMoney } from './money'

// Demo history is clearly marked source=IMPORTED so it can never be mistaken
// for a PayPal-verified event. Everything created after this (contributions,
// payouts) goes through real PayPal sandbox calls and webhooks.

const DAY = 24 * 60 * 60 * 1000

/** The showcase treasuries every visitor sees. */
export const DEMO_NAMES = ['Brightline Labs — Founders’ Fund 🚀', "Girls' Trip to Lisbon 🇵🇹", '💍 The Johnsons Household']
/** Showcase order on the landing page (by stable key, so renames don't matter). */
export const DEMO_ORDER = ['BRIGHTLINE', 'LISBON', 'JOHNSONS']
/** Earlier demo stories, replaced at startup. */
export const RETIRED_DEMO_NAMES = ['Whitmore Family Scholarship Fund', 'Westfield Eagles Booster Club', 'The Maya Thompson Scholarship 🎓']

function daysAgo(n: number) {
  return new Date(Date.now() - n * DAY)
}

type MemberSeed = { name: string; role?: 'MEMBER' | 'APPROVER' | 'ADMIN' }

function emailFor(name: string, domain: string) {
  return `${name.toLowerCase().replace(/[^a-z]+/g, '.').replace(/^\.|\.$/g, '')}@${domain}`
}

type DemoSeed = {
    /** Stable id: survives renames, so a renamed demo is never seeded twice. */
    demoKey: 'BRIGHTLINE' | 'LISBON' | 'JOHNSONS'
    name: string
    purpose: string
    kind: string
    exitPolicy: 'NO_REFUNDS' | 'UNSPENT_SHARE' | 'VOTE'
    approvalMode: 'FIXED' | 'RANDOM' | 'MIXED'
    maxMembers: number
    /** Key for this group's own sandbox account: PAYPAL_CLIENT_ID_<KEY> etc. Falls back to the shared one until set. */
    paypalAccount: string
    paypalEmail: string
    domain: string
    members: MemberSeed[]
    tiers: { minCents: number; maxCents: number | null; requiredApprovals: number }[]
    openingCents: number
    openingDaysAgo: number
    contributions: { member: string; cents: number; daysAgo: number; memo?: string; goal?: string }[]
    payouts: { title: string; to: string; cents: number; daysAgo: number }[]
    /** Money moved directly in PayPal, outside CoTreasury: shows up red, with an alert to everyone. */
    outside: { what: string; to: string; cents: number; daysAgo: number }[]
    goals: { title: string; kind: 'TARGET' | 'MONTHLY'; perMemberCents: number; dueInDays?: number; startedDaysAgo?: number }[]
}

async function createCollective(prisma: PrismaClient, data: DemoSeed, demoOwner: string | null = null) {
  const collective = await prisma.collective.create({
    data: {
      name: data.name,
      purpose: data.purpose,
      kind: data.kind,
      exitPolicy: data.exitPolicy,
      approvalMode: data.approvalMode,
      maxMembers: data.maxMembers,
      paypalAccount: data.paypalAccount,
      paypalEmail: data.paypalEmail,
      isDemo: true,
      demoKey: data.demoKey,
      demoOwner,
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

  for (const o of data.outside) await createOutsideMovement(prisma, collective.id, o)

  await writeDemoHistory(prisma, collective.id)
  return collective
}

/** One example of money leaving the group's PayPal account outside CoTreasury. */
async function createOutsideMovement(prisma: PrismaClient, collectiveId: string, o: { what: string; to: string; cents: number; daysAgo: number }) {
  return prisma.ledgerEntry.create({
    data: {
      collectiveId,
      type: 'UNAPPROVED_MOVEMENT',
      direction: 'OUT',
      amountCents: o.cents,
      status: 'CONFIRMED', // the money really left; the balance reflects it
      source: 'IMPORTED',
      memo: `${o.what}, outside CoTreasury`,
      counterparty: o.to,
      createdAt: daysAgo(o.daysAgo),
      confirmedAt: daysAgo(o.daysAgo),
    },
  })
}

/** The same sealed alert the live outside-activity check writes (members get it as a notification). */
function outsideMovementEvent(e: { id: string; amountCents: number; memo: string | null; counterparty: string | null; createdAt: Date }, currency: string) {
  const what = (e.memo ?? 'Payment sent from PayPal').replace(/, outside CoTreasury$/, '')
  return {
    actor: 'CoTreasury',
    action: 'UNAPPROVED_MOVEMENT',
    summary: `found ${formatMoney(e.amountCents, currency, { cents: true })} leaving the group's PayPal account that wasn't made through CoTreasury (${what.charAt(0).toLowerCase() + what.slice(1)}${e.counterparty ? `, ${e.counterparty}` : ''}). Nobody approved it here`,
    data: { entryId: e.id, amountCents: e.amountCents },
    at: e.createdAt,
  }
}

/** Demos created before these examples existed get their story's examples once, each with its member alert. */
async function backfillOutsideMovements(prisma: PrismaClient, seed: DemoSeed) {
  const c = await prisma.collective.findFirst({ where: { isDemo: true, demoKey: seed.demoKey, demoOwner: null }, select: { id: true, currency: true } })
  if (!c) return
  if (await prisma.ledgerEntry.count({ where: { collectiveId: c.id, type: 'UNAPPROVED_MOVEMENT' } })) return
  for (const o of seed.outside) {
    const e = await createOutsideMovement(prisma, c.id, o)
    await recordEvent(c.id, outsideMovementEvent(e, c.currency))
  }
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
    if (e.type === 'UNAPPROVED_MOVEMENT') {
      await recordEvent(c.id, outsideMovementEvent(e, c.currency))
      continue
    }
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
    demoKey: 'BRIGHTLINE',
    name: DEMO_NAMES[0],
    purpose:
      'Three co-founders, one pre-launch budget. We’re pooling our own money to build Brightline before we incorporate: software, legal fees and our first prototype. Every spend over $500 needs two of us to agree.',
    kind: 'BUSINESS',
    exitPolicy: 'UNSPENT_SHARE',
    approvalMode: 'FIXED', // all three founders are the approvers
    maxMembers: 5,
    paypalAccount: 'MAYA', // this demo's own sandbox business account (the key kept from the earlier story)
    paypalEmail: 'founders@brightline.example',
    domain: 'brightline.example',
    members: [
      { name: 'Ethan Brooks', role: 'ADMIN' },
      { name: 'Priya Raman', role: 'APPROVER' },
      { name: 'Marcus Chen', role: 'APPROVER' },
    ],
    tiers: [
      { minCents: 0, maxCents: 50_000, requiredApprovals: 1 },
      { minCents: 50_000, maxCents: null, requiredApprovals: 2 },
    ],
    openingCents: 0,
    openingDaysAgo: 80,
    goals: [
      { title: 'Pre-launch budget', kind: 'TARGET', perMemberCents: 500_000, dueInDays: 45 },
      { title: 'Tools & hosting', kind: 'MONTHLY', perMemberCents: 15_000, startedDaysAgo: 80 },
    ],
    contributions: [
      { member: 'Ethan Brooks', cents: 500_000, daysAgo: 78, goal: 'Pre-launch budget' },
      { member: 'Priya Raman', cents: 500_000, daysAgo: 76, goal: 'Pre-launch budget' },
      { member: 'Marcus Chen', cents: 300_000, daysAgo: 74, memo: 'First part', goal: 'Pre-launch budget' },
      { member: 'Ethan Brooks', cents: 15_000, daysAgo: 72, goal: 'Tools & hosting' },
      { member: 'Priya Raman', cents: 15_000, daysAgo: 72, goal: 'Tools & hosting' },
      { member: 'Marcus Chen', cents: 15_000, daysAgo: 71, goal: 'Tools & hosting' },
      { member: 'Ethan Brooks', cents: 15_000, daysAgo: 42, goal: 'Tools & hosting' },
      { member: 'Priya Raman', cents: 15_000, daysAgo: 41, goal: 'Tools & hosting' },
      { member: 'Marcus Chen', cents: 15_000, daysAgo: 40, goal: 'Tools & hosting' },
      { member: 'Marcus Chen', cents: 200_000, daysAgo: 20, memo: 'Second part', goal: 'Pre-launch budget' },
      { member: 'Ethan Brooks', cents: 15_000, daysAgo: 11, goal: 'Tools & hosting' },
      { member: 'Priya Raman', cents: 15_000, daysAgo: 10, goal: 'Tools & hosting' },
      { member: 'Marcus Chen', cents: 15_000, daysAgo: 10, goal: 'Tools & hosting' },
    ],
    payouts: [
      { title: 'Incorporation & legal fees', to: 'Harbor Legal LLP', cents: 185_000, daysAgo: 50 },
      { title: 'Prototype parts', to: 'Proto Supply Co.', cents: 240_000, daysAgo: 30 },
      { title: 'Design & dev tools (annual)', to: 'Toolstack Inc.', cents: 60_000, daysAgo: 15 },
    ],
    outside: [{ what: 'Payment sent from PayPal', to: 'Ethan Brooks', cents: 35_000, daysAgo: 9 }],
  },
  {
    demoKey: 'LISBON',
    name: DEMO_NAMES[1],
    purpose:
      "Eight of us. One trip. One place to keep the money together. We're finally doing the trip we've been talking about for years. Everyone is putting in what they can, and we're using this treasury to keep contributions, bookings, and spending in one place.",
    kind: 'GROUP_TRIP',
    exitPolicy: 'UNSPENT_SHARE',
    approvalMode: 'RANDOM', // a hidden panel drawn from all eight for each payout
    maxMembers: 8,
    paypalAccount: 'LISBON',
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
    outside: [
      { what: 'Payment sent from PayPal', to: 'Lisboa Car Rentals', cents: 25_000, daysAgo: 12 },
      { what: 'Payment sent from PayPal', to: 'Chloe Bennett', cents: 6_000, daysAgo: 4 },
    ],
  },
  {
    demoKey: 'JOHNSONS',
    name: DEMO_NAMES[2],
    purpose:
      "Long-term partnership. We're building our life together, so we want our finances to work that way too. Both of us can contribute, see what's happening, and make decisions about our shared money without one person having to manage everything alone.",
    kind: 'HOUSEHOLD',
    exitPolicy: 'VOTE',
    approvalMode: 'FIXED',
    maxMembers: 2,
    paypalAccount: 'JOHNSONS',
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
    outside: [{ what: 'Payment sent from PayPal', to: 'BestTech Online', cents: 18_000, daysAgo: 20 }],
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
  // 1. Give demos created before demoKey existed their key: by exact name, by a
  //    renamed name that still starts with the original, or by PayPal account key.
  const unkeyed = await prisma.collective.findMany({ where: { isDemo: true, demoKey: null, demoOwner: null }, select: { id: true, name: true, paypalAccount: true } })
  for (const c of unkeyed) {
    const seed =
      DEMO_SEEDS.find((d) => d.name === c.name) ??
      DEMO_SEEDS.find((d) => c.name.startsWith(d.name)) ??
      DEMO_SEEDS.find((d) => c.paypalAccount && d.paypalAccount === c.paypalAccount && !RETIRED_DEMO_NAMES.includes(c.name))
    if (seed) await prisma.collective.update({ where: { id: c.id }, data: { demoKey: seed.demoKey } })
  }

  // 2. One showcase treasury per key: keep the oldest (the original, even if
  //    renamed); drop copies an earlier name-based startup check created.
  for (const seed of DEMO_SEEDS) {
    const copies = await prisma.collective.findMany({ where: { isDemo: true, demoKey: seed.demoKey, demoOwner: null }, orderBy: { createdAt: 'asc' }, select: { id: true } })
    if (copies.length > 1) await prisma.collective.deleteMany({ where: { id: { in: copies.slice(1).map((c) => c.id) } } })
  }

  // 3. Demos created before these settings existed get their story's values.
  for (const seed of DEMO_SEEDS) {
    const where = { isDemo: true, demoKey: seed.demoKey, demoOwner: null }
    await prisma.collective.updateMany({ where: { ...where, exitPolicy: 'VOTE', status: 'OPEN' }, data: { exitPolicy: seed.exitPolicy } })
    await prisma.collective.updateMany({ where: { ...where, maxMembers: 50 }, data: { maxMembers: seed.maxMembers } })
    await prisma.collective.updateMany({ where: { ...where, paypalAccount: null }, data: { paypalAccount: seed.paypalAccount } })
  }
  // Story updates (2026-10-11): Brightline refunds a leaving founder's share;
  // Lisbon reviews payouts with a random hidden panel.
  await prisma.collective.updateMany({ where: { isDemo: true, demoKey: 'BRIGHTLINE', demoOwner: null, exitPolicy: 'NO_REFUNDS' }, data: { exitPolicy: 'UNSPENT_SHARE' } })
  await prisma.collective.updateMany({ where: { isDemo: true, demoKey: 'LISBON', demoOwner: null, approvalMode: 'FIXED' }, data: { approvalMode: 'RANDOM' } })
  for (const seed of DEMO_SEEDS) await backfillOutsideMovements(prisma, seed)

  // 4. Seed any showcase treasury that's missing (by key, never by name).
  const existing = new Set((await prisma.collective.findMany({ where: { isDemo: true, demoKey: { not: null }, demoOwner: null }, select: { demoKey: true } })).map((c) => c.demoKey))
  const created: string[] = []
  for (const seed of DEMO_SEEDS.filter((d) => !existing.has(d.demoKey))) {
    await createCollective(prisma, seed)
    created.push(seed.name)
  }
  return created
}

/** This browser's private copy of a demo story, made fresh from the template's seed. */
export async function createDemoCopy(prisma: PrismaClient, demoKey: string, owner: string) {
  const seed = DEMO_SEEDS.find((d) => d.demoKey === demoKey)
  if (!seed) return null
  return createCollective(prisma, seed, owner)
}

/** Private demo copies older than 30 days are removed (visitors get a fresh one next time). */
export async function cleanUpDemoCopies(prisma: PrismaClient) {
  const cutoff = new Date(Date.now() - 30 * DAY)
  const { count } = await prisma.collective.deleteMany({ where: { isDemo: true, demoOwner: { not: null }, createdAt: { lt: cutoff } } })
  return count
}

/** Seal the activity history for a demo that doesn't have one yet. */
export async function backfillDemo(prisma: PrismaClient, collectiveId: string) {
  await writeDemoHistory(prisma, collectiveId)
}
