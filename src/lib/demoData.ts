import type { PrismaClient } from '@prisma/client'

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
    contributions: { member: string; cents: number; daysAgo: number; memo?: string }[]
    payouts: { title: string; to: string; cents: number; daysAgo: number }[]
  },
) {
  const collective = await prisma.collective.create({
    data: {
      name: data.name,
      purpose: data.purpose,
      kind: data.kind,
      paypalEmail: data.paypalEmail,
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

  return collective
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
      { member: 'Olumide Shittu', cents: 40_000, daysAgo: 31 },
      { member: 'Grace Adeyemi', cents: 60_000, daysAgo: 18 },
      { member: 'Marcus Lee', cents: 35_000, daysAgo: 9 },
    ],
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
      { member: 'Brian Walsh', cents: 15_000, daysAgo: 62, memo: 'Season dues' },
      { member: 'Aisha Bello', cents: 15_000, daysAgo: 61, memo: 'Season dues' },
      { member: 'Tom Henderson', cents: 15_000, daysAgo: 58, memo: 'Season dues' },
      { member: 'Mei Chen', cents: 25_000, daysAgo: 40, memo: 'Bake sale proceeds' },
      { member: 'Carlos Rivera', cents: 15_000, daysAgo: 33, memo: 'Season dues' },
    ],
    payouts: [{ title: 'New basketball uniforms', to: 'Midwest Team Supply', cents: 96_000, daysAgo: 26 }],
  })

  return { scholarship, booster }
}
