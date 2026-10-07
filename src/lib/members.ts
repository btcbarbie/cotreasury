import { prisma } from './prisma'
import { recordEvent } from './audit'

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Add someone as a MEMBER (contribute and see everything; approving needs a
 * governed rule change). A former member with the same email is welcomed back.
 */
export async function admitMember(
  collectiveId: string,
  input: { name: string; email: string },
  event: { actor: string; action: 'MEMBER_ADDED' | 'MEMBER_JOINED'; summary: (name: string) => string },
): Promise<{ ok: true; memberId: string } | { ok: false; error: string }> {
  const name = input.name?.trim().slice(0, 80) ?? ''
  const email = input.email?.trim().toLowerCase() ?? ''
  if (!name || !EMAIL.test(email)) return { ok: false, error: 'Add a name and a valid email.' }
  const existing = await prisma.member.findUnique({ where: { collectiveId_email: { collectiveId, email } } })
  if (existing && existing.role !== 'FORMER') return { ok: false, error: 'Someone with that email is already a member.' }
  // New members start with nothing unread: they only hear about what happens after they join.
  const head = await prisma.auditEvent.findFirst({ where: { collectiveId }, orderBy: { seq: 'desc' }, select: { seq: true } })
  const member = existing
    ? await prisma.member.update({ where: { id: existing.id }, data: { name, role: 'MEMBER', lastSeenSeq: head?.seq ?? 0 } })
    : await prisma.member.create({ data: { collectiveId, name, email, role: 'MEMBER', lastSeenSeq: head?.seq ?? 0 } })
  await recordEvent(collectiveId, { actor: event.actor, action: event.action, summary: event.summary(name), data: { email } })
  return { ok: true, memberId: member.id }
}
