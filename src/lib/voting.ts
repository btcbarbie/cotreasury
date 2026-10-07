import type { Prisma } from '@prisma/client'
import { prisma } from './prisma'
import { recordEvent } from './audit'
import { revealPanel, REVIEW_WINDOW_HOURS } from './panel'
import { canApprove } from './treasury'

// A "no" never ends the vote on its own. A request is approved as soon as it
// has enough approvals; it fails only once it can no longer get them. Even
// then, voting stays open so everyone eligible is heard, and it closes as
// REJECTED when they have all voted or the review window passes.

const HOUR = 60 * 60 * 1000

type Open = { id: string; collectiveId: string; proposedById: string | null; panelSeed: string | null }

/** People who can still vote: unused panel seats, or approvers who haven't voted. */
export async function votersLeft(tx: Prisma.TransactionClient, p: Open): Promise<number> {
  if (p.panelSeed) return tx.proposalReviewer.count({ where: { proposalId: p.id, status: 'ACTIVE' } })
  const [members, voted] = await Promise.all([
    tx.member.findMany({ where: { collectiveId: p.collectiveId }, select: { id: true, role: true } }),
    tx.approval.findMany({ where: { proposalId: p.id }, select: { memberId: true } }),
  ])
  const done = new Set(voted.map((v) => v.memberId))
  return members.filter((m) => canApprove(m.role) && m.id !== p.proposedById && !done.has(m.id)).length
}

/** Close a request that can't pass, with the full tally on the record. */
export async function closeRejected(tx: Prisma.TransactionClient, proposalId: string, reason: 'ALL_VOTED' | 'WINDOW_PASSED') {
  // Guarded update: only one caller gets to close it.
  const { count } = await tx.proposal.updateMany({ where: { id: proposalId, status: 'PENDING_APPROVAL' }, data: { status: 'REJECTED' } })
  if (count === 0) return
  const p = await tx.proposal.findUniqueOrThrow({ where: { id: proposalId }, include: { approvals: true } })
  const yes = p.approvals.filter((a) => a.decision === 'APPROVE').length
  const no = p.approvals.length - yes
  await revealPanel(tx, proposalId)
  await recordEvent(
    p.collectiveId,
    {
      actor: 'CoTreasury',
      action: 'REQUEST_REJECTED',
      summary: `"${p.title}" was rejected: ${yes} approved, ${no} rejected, ${p.requiredApprovals} approval${p.requiredApprovals === 1 ? '' : 's'} needed${
        reason === 'WINDOW_PASSED' ? ` (voting closed after ${REVIEW_WINDOW_HOURS}h)` : ''
      }`,
      data: { proposalId, yes, no, required: p.requiredApprovals, reason },
    },
    tx,
  )
}

/** Close requests that couldn't pass once their remaining voters have had the review window. */
export async function closeStaleRequests(collectiveId: string) {
  const cutoff = new Date(Date.now() - REVIEW_WINDOW_HOURS * HOUR)
  const stale = await prisma.proposal.findMany({
    where: { collectiveId, status: 'PENDING_APPROVAL', wontPassAt: { lt: cutoff } },
    select: { id: true },
  })
  for (const p of stale) await prisma.$transaction((tx) => closeRejected(tx, p.id, 'WINDOW_PASSED'))
}
