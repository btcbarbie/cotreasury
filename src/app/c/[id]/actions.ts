'use server'

import { cookies } from 'next/headers'
import { refresh } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { getViewer, viewerCookieName } from '@/lib/collectives'
import { canApprove } from '@/lib/treasury'
import { assessSpend, describeRuleChange, ruleChangeApprovals, validateRules, type RulesPayload } from '@/lib/governance'
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

  const recipients = (draft.recipients ?? [])
    .filter((r) => r.name && r.receiver && Number.isInteger(r.amountCents) && r.amountCents > 0)
    .map((r) => ({ name: String(r.name).slice(0, 80), receiver: String(r.receiver).trim().slice(0, 120), amountCents: r.amountCents }))
  if (recipients.length === 0) return { ok: false, error: 'Add at least one recipient.' }

  const a = await assessSpend(collectiveId, recipients, viewer.id)
  if (!a.affordable) return { ok: false, error: 'This would exceed the money available to spend.' }

  await prisma.proposal.create({
    data: {
      collectiveId,
      kind: 'SPEND',
      title: String(draft.title).slice(0, 120),
      description: String(draft.description ?? '').slice(0, 500),
      amountCents: a.amountCents,
      requiredApprovals: a.requiredApprovals,
      proposedById: viewer.id,
      aiAssessment: JSON.stringify({ draftedByAI: true }),
      flags: JSON.stringify(a.flags),
      recipients: { create: recipients.map((r) => ({ ...r, receiverType: 'EMAIL' })) },
    },
  })
  refresh()
  return { ok: true }
}

/** Propose new spending rules / approvers. Applied only after approval (dual admin control). */
export async function proposeRuleChange(collectiveId: string, rules: RulesPayload): Promise<Result> {
  const viewer = await getViewer(collectiveId)
  if (!viewer || !canApprove(viewer.role)) return { ok: false, error: 'Only approvers can propose rule changes.' }
  const c = await prisma.collective.findUniqueOrThrow({ where: { id: collectiveId }, include: { members: true, tiers: { orderBy: { minCents: 'asc' } }, proposals: true } })
  if (c.proposals.some((p) => p.kind === 'RULE_CHANGE' && p.status === 'PENDING_APPROVAL')) {
    return { ok: false, error: 'A rule change is already waiting for approval.' }
  }
  const admin = c.members.find((m) => m.role === 'ADMIN')
  if (admin && !rules.approverIds.includes(admin.id)) return { ok: false, error: 'The admin always stays an approver.' }
  const invalid = validateRules(rules, new Set(c.members.map((m) => m.id)))
  if (invalid) return { ok: false, error: invalid }

  const current: RulesPayload = {
    tiers: c.tiers.map((t) => ({ minCents: t.minCents, maxCents: t.maxCents, requiredApprovals: t.requiredApprovals })),
    approverIds: c.members.filter((m) => canApprove(m.role)).map((m) => m.id),
    newPayeeRule: c.newPayeeRule,
  }
  const lines = describeRuleChange(current, rules, new Map(c.members.map((m) => [m.id, m.name])), c.currency)
  if (lines.length === 0) return { ok: false, error: 'Nothing changed.' }

  await prisma.proposal.create({
    data: {
      collectiveId,
      kind: 'RULE_CHANGE',
      title: 'Change spending rules',
      description: lines.join('\n'),
      amountCents: 0,
      requiredApprovals: await ruleChangeApprovals(collectiveId, viewer.id),
      proposedById: viewer.id,
      changePayload: JSON.stringify(rules),
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
    if (status === proposal.status) return
    if (status === 'APPROVED' && proposal.kind === 'RULE_CHANGE' && proposal.changePayload) {
      // Apply the approved rules atomically with the final approval.
      const rules = JSON.parse(proposal.changePayload) as RulesPayload
      await tx.governanceTier.deleteMany({ where: { collectiveId: proposal.collectiveId } })
      await tx.governanceTier.createMany({ data: rules.tiers.map((t) => ({ ...t, collectiveId: proposal.collectiveId })) })
      await tx.member.updateMany({ where: { collectiveId: proposal.collectiveId, role: 'APPROVER', id: { notIn: rules.approverIds } }, data: { role: 'MEMBER' } })
      await tx.member.updateMany({ where: { collectiveId: proposal.collectiveId, role: 'MEMBER', id: { in: rules.approverIds } }, data: { role: 'APPROVER' } })
      await tx.collective.update({ where: { id: proposal.collectiveId }, data: { newPayeeRule: rules.newPayeeRule } })
      await tx.proposal.update({ where: { id: proposalId }, data: { status: 'COMPLETED' } })
      return
    }
    await tx.proposal.update({ where: { id: proposalId }, data: { status } })
  })
  refresh()
  return { ok: true }
}
