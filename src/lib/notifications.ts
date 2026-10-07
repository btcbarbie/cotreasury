import { prisma } from './prisma'

// Member notifications are derived from the sealed activity log: every
// significant event after the member's lastSeenSeq, excluding their own actions.

export const NOTIFY_ACTIONS = new Set([
  'CONTRIBUTION_CONFIRMED',
  'CONTRIBUTION_DECLINED',
  'PAYOUT_SENT',
  'PAYOUT_SUCCEEDED',
  'PAYOUT_UNCLAIMED',
  'PAYOUT_FAILED',
  'PAYOUT_RETURNED',
  'REQUEST_CREATED',
  'REQUEST_APPROVED',
  'REQUEST_WONT_PASS',
  'REQUEST_REJECTED',
  'RULE_CHANGE_PROPOSED',
  'RULES_CHANGED',
  'GOAL_CREATED',
  'MEMBER_JOINED',
  'MEMBER_LEFT',
  'CLOSE_PROPOSED',
  'TREASURY_CLOSING',
  'TREASURY_CLOSED',
  'TREASURY_REOPENED',
  'UNAPPROVED_MOVEMENT',
])

export type MemberNotification = { seq: number; actor: string; action: string; summary: string; createdAt: string }

export async function unseenFor(collectiveId: string, member: { name: string; lastSeenSeq: number }) {
  const events = await prisma.auditEvent.findMany({
    where: { collectiveId, seq: { gt: member.lastSeenSeq }, action: { in: [...NOTIFY_ACTIONS] }, actor: { not: member.name } },
    orderBy: { seq: 'desc' },
    take: 30,
  })
  const head = await prisma.auditEvent.findFirst({ where: { collectiveId }, orderBy: { seq: 'desc' }, select: { seq: true } })
  return {
    items: events.map((e) => ({ seq: e.seq, actor: e.actor, action: e.action, summary: e.summary, createdAt: e.createdAt.toISOString() })),
    // Everything up to here counts as seen once the member has looked.
    headSeq: head?.seq ?? 0,
  }
}
