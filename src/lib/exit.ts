import { prisma } from './prisma'
import type { Prisma } from '@prisma/client'
import { recordEvent } from './audit'
import { formatMoney } from './money'

const OPEN_PAYOUTS = ['PENDING_APPROVAL', 'APPROVED', 'EXECUTING']

/**
 * Why money can't move in this treasury right now, or null if it can.
 * Closed and closing treasuries are frozen; so is one whose members are voting
 * on closing it, so the settlement plan they vote on stays accurate.
 */
export async function treasuryLock(collectiveId: string): Promise<string | null> {
  const c = await prisma.collective.findUnique({ where: { id: collectiveId }, select: { status: true } })
  if (!c) return 'Treasury not found.'
  if (c.status === 'CLOSED') return 'This treasury is closed. Its ledger stays here for the record.'
  if (c.status === 'CLOSING') return 'This treasury is closing: the final settlement is being paid out.'
  const voting = await prisma.proposal.count({ where: { collectiveId, kind: 'CLOSE', status: 'PENDING_APPROVAL' } })
  return voting > 0 ? 'The group is voting on closing this treasury, so new contributions and requests are paused.' : null
}

/** Payout requests still being decided or paid (spending and refunds). */
export function openPayoutCount(collectiveId: string) {
  return prisma.proposal.count({ where: { collectiveId, kind: { in: ['SPEND', 'REFUND'] }, status: { in: OPEN_PAYOUTS } } })
}

/** A leaving member's refund was paid: now they leave (their history stays). */
export async function completeLeave(proposalId: string) {
  const p = await prisma.proposal.findUnique({ where: { id: proposalId }, include: { proposedBy: true } })
  const m = p?.proposedBy
  if (!p || p.kind !== 'REFUND' || !m || m.role === 'FORMER') return
  await prisma.$transaction(async (tx) => {
    await tx.member.update({ where: { id: m.id }, data: { role: 'FORMER', leaving: false } })
    // Their panel seats are re-drawn the next time anyone opens the treasury.
    await tx.proposalReviewer.updateMany({ where: { memberId: m.id, status: 'ACTIVE' }, data: { expiresAt: new Date() } })
    await recordEvent(
      p.collectiveId,
      { actor: m.name, action: 'MEMBER_LEFT', summary: `left the group after their ${formatMoney(p.amountCents, 'USD', { cents: true })} refund was paid`, data: { memberId: m.id, proposalId } },
      tx,
    )
  })
}

/** A leaving member's refund was rejected: they stay a full member. */
export async function cancelLeave(tx: Prisma.TransactionClient, proposalId: string) {
  const p = await tx.proposal.findUnique({ where: { id: proposalId }, include: { proposedBy: true } })
  const m = p?.proposedBy
  if (!p || p.kind !== 'REFUND' || !m?.leaving) return
  await tx.member.update({ where: { id: m.id }, data: { leaving: false } })
  await recordEvent(p.collectiveId, { actor: m.name, action: 'MEMBER_STAYED', summary: 'stays in the group: their refund wasn’t approved', data: { memberId: m.id, proposalId } }, tx)
}

/** The final settlement has been paid: the treasury becomes read-only. */
export async function markClosed(collectiveId: string) {
  const { count } = await prisma.collective.updateMany({ where: { id: collectiveId, status: { not: 'CLOSED' } }, data: { status: 'CLOSED', closedAt: new Date() } })
  if (count === 0) return
  await recordEvent(collectiveId, {
    actor: 'CoTreasury',
    action: 'TREASURY_CLOSED',
    summary: 'closed the treasury after the final settlement. The ledger and this log stay here, read-only',
  })
}
