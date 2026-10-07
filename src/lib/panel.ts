import { createHash, randomBytes } from 'crypto'
import type { Prisma } from '@prisma/client'
import { prisma } from './prisma'
import { recordEvent } from './audit'
import { canApprove } from './treasury'

// Random review panels. For a spend request the server draws R reviewers from
// the collective using a secret seed. The seed's hash is sealed in the activity
// log at draw time; the seed itself is revealed once the request is decided, so
// anyone can re-run the draw and confirm nobody hand-picked the panel.

export const REVIEW_WINDOW_HOURS = 48
const HOUR = 60 * 60 * 1000

type Member = { id: string; role: string }

/** Deterministic shuffle driven by the seed (sorted input, so it's reproducible). */
export function seededOrder<T extends { id: string }>(items: T[], seed: string, salt: string): T[] {
  const out = [...items].sort((a, b) => a.id.localeCompare(b.id))
  for (let i = out.length - 1; i > 0; i--) {
    const h = createHash('sha256').update(`${seed}:${salt}:${i}`).digest()
    const j = h.readUInt32BE(0) % (i + 1)
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/** Officer pool and member pool for a request, never including the person who asked. */
function pools(members: Member[], makerId: string | null, mode: string) {
  const eligible = members.filter((m) => m.id !== makerId && m.role !== 'FORMER')
  if (mode === 'MIXED') {
    return { officers: eligible.filter((m) => canApprove(m.role)), others: eligible }
  }
  return { officers: [] as Member[], others: eligible }
}

/** Draw the panel inside the transaction that creates the request. */
export async function drawPanel(
  tx: Prisma.TransactionClient,
  p: { id: string; collectiveId: string; title: string; requiredApprovals: number; proposedById: string | null },
  members: Member[],
  mode: string,
) {
  const seed = randomBytes(16).toString('hex')
  const commitment = createHash('sha256').update(seed).digest('hex')
  const { officers, others } = pools(members, p.proposedById, mode)
  const seats: { memberId: string; seat: 'OFFICER' | 'MEMBER' }[] = []
  let need = p.requiredApprovals
  if (mode === 'MIXED' && officers.length > 0) {
    seats.push({ memberId: seededOrder(officers, seed, 'OFFICER')[0].id, seat: 'OFFICER' })
    need -= 1
  }
  for (const m of seededOrder(others, seed, 'MEMBER')) {
    if (need <= 0) break
    if (seats.some((s) => s.memberId === m.id)) continue
    seats.push({ memberId: m.id, seat: 'MEMBER' })
    need -= 1
  }
  const expiresAt = new Date(Date.now() + REVIEW_WINDOW_HOURS * HOUR)
  await tx.proposalReviewer.createMany({ data: seats.map((s) => ({ ...s, proposalId: p.id, expiresAt })) })
  // A panel can't need more votes than it has seats (tiny groups).
  await tx.proposal.update({
    where: { id: p.id },
    data: { panelSeed: seed, panelCommitment: commitment, requiredApprovals: Math.max(1, Math.min(p.requiredApprovals, seats.length)) },
  })
  await recordEvent(
    p.collectiveId,
    {
      actor: 'CoTreasury',
      action: 'PANEL_DRAWN',
      summary: `drew a hidden review panel of ${seats.length} for "${p.title}" (seed fingerprint ${commitment.slice(0, 12)})`,
      data: { proposalId: p.id, commitment, eligible: others.length, mode, seats: seats.map((s) => s.seat) },
    },
    tx,
  )
}

/** Replace reviewers who let the review window pass without voting. */
export async function refreshPanels(collectiveId: string) {
  const now = new Date()
  const stale = await prisma.proposalReviewer.findMany({
    where: { status: 'ACTIVE', expiresAt: { lt: now }, proposal: { collectiveId, status: 'PENDING_APPROVAL', panelSeed: { not: null } } },
    include: { proposal: { include: { reviewers: true, collective: { include: { members: true } } } } },
  })
  for (const r of stale) {
    const p = r.proposal
    const used = new Set(p.reviewers.map((x) => x.memberId))
    const { officers, others } = pools(p.collective.members, p.proposedById, p.collective.approvalMode)
    const pool = r.seat === 'OFFICER' ? officers : others
    const next = seededOrder(pool, p.panelSeed!, r.seat).find((m) => !used.has(m.id))
    await prisma.$transaction(async (tx) => {
      await tx.proposalReviewer.update({ where: { id: r.id }, data: { status: 'REPLACED' } })
      if (next) {
        await tx.proposalReviewer.create({
          data: { proposalId: p.id, memberId: next.id, seat: r.seat, expiresAt: new Date(now.getTime() + REVIEW_WINDOW_HOURS * HOUR) },
        })
      }
      await recordEvent(
        p.collectiveId,
        {
          actor: 'CoTreasury',
          action: 'REVIEWER_REASSIGNED',
          summary: next
            ? `a reviewer on "${p.title}" didn't respond within ${REVIEW_WINDOW_HOURS}h, so the next member in the draw was asked`
            : `a reviewer on "${p.title}" didn't respond within ${REVIEW_WINDOW_HOURS}h and no one is left to draw`,
          data: { proposalId: p.id, seat: r.seat },
        },
        tx,
      )
    })
  }
}

/** After the decision: publish the seed and who sat on the panel. */
export async function revealPanel(tx: Prisma.TransactionClient, proposalId: string) {
  const p = await tx.proposal.findUnique({ where: { id: proposalId }, include: { reviewers: { include: { member: { select: { name: true } } } } } })
  if (!p?.panelSeed) return
  const sat = p.reviewers.filter((r) => r.status !== 'REPLACED').map((r) => r.member.name)
  await recordEvent(
    p.collectiveId,
    {
      actor: 'CoTreasury',
      action: 'PANEL_REVEALED',
      summary: `revealed the review panel for "${p.title}": ${sat.join(', ')} (seed ${p.panelSeed})`,
      data: { proposalId, seed: p.panelSeed, commitment: p.panelCommitment, reviewers: sat },
    },
    tx,
  )
}
