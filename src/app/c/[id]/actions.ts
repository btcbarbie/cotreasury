'use server'

import { cookies } from 'next/headers'
import { refresh } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { getViewer, viewerCookieName } from '@/lib/collectives'
import { canApprove, computeTreasury, tierFor } from '@/lib/treasury'
import type { DraftRequest } from '@/lib/treasurer'

// Demo-mode identity switch: lets a judge act as different members (e.g. three
// approvers) without separate logins. Not an authentication mechanism.
export async function switchViewer(collectiveId: string, memberId: string) {
  const member = await prisma.member.findFirst({ where: { id: memberId, collectiveId } })
  if (!member) throw new Error('Member not found')
  const jar = await cookies()
  jar.set(viewerCookieName(collectiveId), member.id, { path: '/', sameSite: 'lax', httpOnly: true })
}

/** Re-render the current collective page with fresh ledger data. */
export async function refreshCollective() {
  refresh()
}

type Result = { ok: true } | { ok: false; error: string }

/**
 * A human (the "maker") submits a request, usually one drafted by the AI
 * Treasurer. Amount, affordability and required approvals are recomputed here
 * from the ledger; nothing in the draft is trusted.
 */
export async function submitRequest(collectiveId: string, draft: DraftRequest): Promise<Result> {
  const viewer = await getViewer(collectiveId)
  if (!viewer) return { ok: false, error: 'Not a member of this collective.' }

  const recipients = (draft.recipients ?? []).filter((r) => r.name && r.receiver && Number.isInteger(r.amountCents) && r.amountCents > 0)
  if (recipients.length === 0) return { ok: false, error: 'Add at least one recipient.' }
  const amountCents = recipients.reduce((s, r) => s + r.amountCents, 0)

  const c = await prisma.collective.findUniqueOrThrow({
    where: { id: collectiveId },
    include: { tiers: true, entries: true, proposals: true, members: true },
  })
  const treasury = computeTreasury(c.entries, c.proposals)
  if (amountCents > treasury.availableCents) return { ok: false, error: 'This would exceed the money available to spend.' }
  const tier = tierFor(amountCents, c.tiers)
  const approverCount = c.members.filter((m) => canApprove(m.role)).length

  await prisma.proposal.create({
    data: {
      collectiveId,
      title: String(draft.title).slice(0, 120),
      description: String(draft.description ?? '').slice(0, 500),
      amountCents,
      requiredApprovals: Math.min(tier?.requiredApprovals ?? approverCount, approverCount),
      proposedById: viewer.id,
      aiAssessment: JSON.stringify({ draftedByAI: true }),
      recipients: {
        create: recipients.map((r) => ({ name: r.name, receiver: r.receiver, receiverType: 'EMAIL', amountCents: r.amountCents })),
      },
    },
  })
  refresh()
  return { ok: true }
}

/**
 * Maker-checker: only approvers can decide, never on their own request, and
 * once each. One rejection stops the request.
 */
export async function decideRequest(proposalId: string, decision: 'APPROVE' | 'REJECT'): Promise<Result> {
  const proposal = await prisma.proposal.findUnique({ where: { id: proposalId }, include: { approvals: true } })
  if (!proposal) return { ok: false, error: 'Request not found.' }
  if (proposal.status !== 'PENDING_APPROVAL') return { ok: false, error: 'This request is no longer open for approval.' }

  const viewer = await getViewer(proposal.collectiveId)
  if (!viewer || !canApprove(viewer.role)) return { ok: false, error: 'Only approvers can decide on requests.' }
  if (proposal.proposedById === viewer.id) return { ok: false, error: 'You created this request, so another approver must review it.' }
  if (proposal.approvals.some((a) => a.memberId === viewer.id)) return { ok: false, error: 'You have already voted on this request.' }

  await prisma.$transaction(async (tx) => {
    await tx.approval.create({ data: { proposalId, memberId: viewer.id, decision } })
    const approvals = await tx.approval.count({ where: { proposalId, decision: 'APPROVE' } })
    const status = decision === 'REJECT' ? 'REJECTED' : approvals >= proposal.requiredApprovals ? 'APPROVED' : 'PENDING_APPROVAL'
    if (status !== proposal.status) await tx.proposal.update({ where: { id: proposalId }, data: { status } })
  })
  refresh()
  return { ok: true }
}
