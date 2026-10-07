'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { MY_TREASURIES_COOKIE, myTreasuryIds, viewerCookieName } from '@/lib/collectives'
import { validateRules } from '@/lib/governance'
import { recordEvent } from '@/lib/audit'
import { formatMoney } from '@/lib/money'

export type NewTreasury = {
  name: string
  purpose: string
  kind: string
  creator: { name: string; email: string }
  people: { name: string; email: string; role: 'APPROVER' | 'MEMBER' }[]
  tiers: { minCents: number; maxCents: number | null; requiredApprovals: number }[]
  newPayeeRule: boolean
  approvalMode?: 'FIXED' | 'RANDOM' | 'MIXED'
  paypalEmail: string
}

const KINDS = new Set(['SCHOLARSHIP_FUND', 'GROUP_TRIP', 'HOUSEHOLD', 'BOOSTER_CLUB', 'COMMUNITY_FUND', 'OTHER'])
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Everything is re-validated here; the wizard's own checks are only for UX. */
export async function createTreasury(input: NewTreasury): Promise<{ ok: false; error: string }> {
  const name = input.name?.trim() ?? ''
  const purpose = input.purpose?.trim() ?? ''
  if (name.length < 3 || name.length > 80) return { ok: false, error: 'Give the treasury a name (3–80 characters).' }
  if (purpose.length < 10 || purpose.length > 400) return { ok: false, error: 'Describe the shared purpose in a sentence or two.' }
  if (!KINDS.has(input.kind)) return { ok: false, error: 'Pick what kind of group this is.' }

  const creator = { name: input.creator?.name?.trim() ?? '', email: input.creator?.email?.trim().toLowerCase() ?? '' }
  if (!creator.name || !EMAIL.test(creator.email)) return { ok: false, error: 'Add your name and a valid email.' }

  const people = (input.people ?? [])
    .map((p) => ({ name: p.name?.trim() ?? '', email: p.email?.trim().toLowerCase() ?? '', role: p.role === 'APPROVER' ? 'APPROVER' : 'MEMBER' }))
    .filter((p) => p.name || p.email)
  if (people.length > 50) return { ok: false, error: 'Up to 50 people for now.' }
  for (const p of people) {
    if (!p.name || !EMAIL.test(p.email)) return { ok: false, error: `Check the name and email for ${p.name || p.email}.` }
  }
  const emails = [creator.email, ...people.map((p) => p.email)]
  if (new Set(emails).size !== emails.length) return { ok: false, error: 'Each person needs a different email.' }

  // Validate rules against index-based ids: creator (admin) is always an approver.
  const approverIds = ['0', ...people.flatMap((p, i) => (p.role === 'APPROVER' ? [String(i + 1)] : []))]
  const tiers = [...(input.tiers ?? [])].sort((a, b) => a.minCents - b.minCents)
  const invalid = validateRules({ tiers, approverIds, newPayeeRule: !!input.newPayeeRule }, new Set(emails.map((_, i) => String(i))))
  if (invalid) return { ok: false, error: invalid }

  const paypalEmail = input.paypalEmail?.trim().toLowerCase() || creator.email
  if (!EMAIL.test(paypalEmail)) return { ok: false, error: 'Enter a valid PayPal account email.' }

  const collective = await prisma.collective.create({
    data: {
      name,
      purpose,
      kind: input.kind,
      paypalEmail,
      newPayeeRule: true, // standard for every treasury
      approvalMode: ['RANDOM', 'MIXED'].includes(input.approvalMode ?? '') ? input.approvalMode! : 'FIXED',
      tiers: { create: tiers.map((t) => ({ minCents: t.minCents, maxCents: t.maxCents, requiredApprovals: t.requiredApprovals })) },
      members: {
        create: [{ name: creator.name, email: creator.email, role: 'ADMIN' }, ...people],
      },
    },
    include: { members: true },
  })
  const admin = collective.members.find((m) => m.role === 'ADMIN')!
  const approverNames = collective.members.filter((m) => m.role !== 'MEMBER').map((m) => m.name)
  await recordEvent(collective.id, {
    actor: admin.name,
    action: 'TREASURY_CREATED',
    summary: `opened the treasury with ${collective.members.length} people; approvers: ${approverNames.join(', ')}`,
    data: { purpose, paypalEmail },
  })
  await recordEvent(collective.id, {
    actor: admin.name,
    action: 'RULES_SET',
    summary: `set the spending rules: ${tiers
      .map((t) => `${t.maxCents === null ? `${formatMoney(t.minCents, 'USD')}+` : `${formatMoney(t.minCents, 'USD')}–${formatMoney(t.maxCents, 'USD')}`} needs ${t.requiredApprovals}`)
      .join('; ')}; +1 for new recipients (standard); payouts reviewed by ${input.approvalMode === 'RANDOM' ? 'a random review panel' : input.approvalMode === 'MIXED' ? 'a mixed panel' : 'the fixed approvers'}`,
    data: { tiers, newPayeeRule: !!input.newPayeeRule },
  })

  const jar = await cookies()
  const mine = [...new Set([...(await myTreasuryIds()), collective.id])].slice(-20)
  jar.set(MY_TREASURIES_COOKIE, mine.join(','), { path: '/', sameSite: 'lax', httpOnly: true, maxAge: 60 * 60 * 24 * 180 })
  jar.set(viewerCookieName(collective.id), admin.id, { path: '/', sameSite: 'lax', httpOnly: true })

  redirect(`/c/${collective.id}?created=1`)
}
