import { prisma } from './prisma'
import { recordEvent } from './audit'

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
