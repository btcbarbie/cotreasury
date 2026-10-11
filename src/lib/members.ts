import { prisma } from './prisma'
import { recordEvent } from './audit'
import { newAccessToken } from './collectives'

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Add someone as a MEMBER (contribute and see everything; approving needs a
 * governed rule change). A former member with the same email is welcomed back.
 */
export async function admitMember(
  collectiveId: string,
  input: { name: string; email: string },
  event: { actor: string; action: 'MEMBER_ADDED' | 'MEMBER_JOINED'; summary: (name: string) => string },
): Promise<{ ok: true; memberId: string; accessToken: string | null } | { ok: false; error: string }> {
  const name = input.name?.trim().slice(0, 80) ?? ''
  const email = input.email?.trim().toLowerCase() ?? ''
  if (!name || !EMAIL.test(email)) return { ok: false, error: 'Add a name and a valid email.' }
  const existing = await prisma.member.findUnique({ where: { collectiveId_email: { collectiveId, email } } })
  if (existing && existing.role !== 'FORMER') return { ok: false, error: 'Someone with that email is already a member.' }
  const [c, active] = await Promise.all([
    prisma.collective.findUniqueOrThrow({ where: { id: collectiveId }, select: { maxMembers: true, isDemo: true } }),
    prisma.member.count({ where: { collectiveId, role: { not: 'FORMER' } } }),
  ])
  if (active >= c.maxMembers) {
    return { ok: false, error: `This treasury is full (${active} of ${c.maxMembers} members). The group can raise the limit with a rule change.` }
  }
  // New members start with nothing unread: they only hear about what happens after they join.
  const head = await prisma.auditEvent.findFirst({ where: { collectiveId }, orderBy: { seq: 'desc' }, select: { seq: true } })
  // Outside demos every member gets a fresh personal link (a returning member's old one stops working).
  const access = c.isDemo ? {} : { accessToken: newAccessToken(), accessClaimed: event.action === 'MEMBER_JOINED' }
  const member = existing
    ? await prisma.member.update({ where: { id: existing.id }, data: { name, role: 'MEMBER', lastSeenSeq: head?.seq ?? 0, ...access } })
    : await prisma.member.create({ data: { collectiveId, name, email, role: 'MEMBER', lastSeenSeq: head?.seq ?? 0, ...access } })
  await recordEvent(collectiveId, { actor: event.actor, action: event.action, summary: event.summary(name), data: { email } })
  return { ok: true, memberId: member.id, accessToken: member.accessToken }
}
