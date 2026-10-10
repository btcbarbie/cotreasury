'use server'

import { randomBytes } from 'crypto'
import { cookies } from 'next/headers'
import { refresh } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { getViewer, viewerCookieName } from '@/lib/collectives'
import { canApprove, computeTreasury } from '@/lib/treasury'
import { assessSpend, describeRuleChange, ruleChangeApprovals, validateRules, type RulesPayload } from '@/lib/governance'
import type { DraftRequest } from '@/lib/treasurer'
import { executePayout, PAYOUT_KINDS, retryPayout } from '@/lib/payouts'
import { drawPanel, revealPanel, REVIEW_WINDOW_HOURS } from '@/lib/panel'
import { closeRejected, votersLeft } from '@/lib/voting'
import { recordEvent } from '@/lib/audit'
import { admitMember } from '@/lib/members'
import { markClosed, openPayoutCount, treasuryLock } from '@/lib/exit'
import { fairShares, type ExitPolicy } from '@/lib/exitPolicy'
import { normalizeReceiver, type ReceiverType } from '@/lib/recipients'
import { formatMoney } from '@/lib/money'

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

  const recipients: NewRecipient[] = []
  for (const r of draft.recipients ?? []) {
    if (!r.name || !r.receiver || !Number.isInteger(r.amountCents) || r.amountCents <= 0) continue
    const receiverType: ReceiverType = r.receiverType === 'PHONE' ? 'PHONE' : 'EMAIL'
    const checked = normalizeReceiver(receiverType, String(r.receiver).slice(0, 120))
    if (!checked.ok) return { ok: false, error: `${String(r.name).slice(0, 80)}: ${checked.error}` }
    recipients.push({ name: String(r.name).slice(0, 80), receiver: checked.receiver, receiverType, amountCents: r.amountCents })
  }
  if (recipients.length === 0) return { ok: false, error: 'Add at least one recipient.' }

  const r = await createPayoutProposal(collectiveId, viewer, { kind: 'SPEND', title: draft.title, description: draft.description, recipients })
  if (!r.ok) return r
  refresh()
  return { ok: true }
}

type NewRecipient = { name: string; receiver: string; receiverType: ReceiverType; amountCents: number }

/**
 * Create a payout request (spending or a leaving member's refund): amount,
 * affordability and approvals come from the ledger and rules, and a hidden
 * review panel is drawn when the group uses one.
 */
async function createPayoutProposal(
  collectiveId: string,
  maker: { id: string; name: string },
  input: { kind: 'SPEND' | 'REFUND'; title: string; description?: string | null; recipients: NewRecipient[] },
): Promise<Result> {
  const locked = await treasuryLock(collectiveId)
  if (locked) return { ok: false, error: locked }
  const a = await assessSpend(collectiveId, input.recipients, maker.id, { refund: input.kind === 'REFUND' })
  if (!a.affordable) return { ok: false, error: 'This would exceed the money available to spend.' }

  const collective = await prisma.collective.findUniqueOrThrow({
    where: { id: collectiveId },
    select: { approvalMode: true, members: { where: { role: { not: 'FORMER' } }, select: { id: true, role: true } } },
  })
  await prisma.$transaction(async (tx) => {
    const p = await tx.proposal.create({
      data: {
        collectiveId,
        kind: input.kind,
        title: String(input.title).slice(0, 120),
        description: String(input.description ?? '').slice(0, 500),
        amountCents: a.amountCents,
        requiredApprovals: a.requiredApprovals,
        proposedById: maker.id,
        aiAssessment: JSON.stringify({ draftedByAI: input.kind === 'SPEND' }),
        flags: JSON.stringify(a.flags),
        recipients: { create: input.recipients },
      },
    })
    const panel = collective.approvalMode !== 'FIXED'
    await recordEvent(
      collectiveId,
      {
        actor: maker.name,
        action: 'REQUEST_CREATED',
        summary: `${input.kind === 'REFUND' ? 'asked for a refund of' : 'requested'} ${formatMoney(a.amountCents, a.currency)} for "${p.title}" (needs ${a.requiredApprovals} approval${a.requiredApprovals === 1 ? '' : 's'}${panel ? ' from a hidden review panel' : ''})`,
        data: { proposalId: p.id, kind: input.kind, amountCents: a.amountCents, recipients: input.recipients.map((r) => r.receiver), flags: a.flags.map((f) => f.code) },
      },
      tx,
    )
    // Random / mixed review: draw the hidden panel with the request.
    if (panel) await drawPanel(tx, p, collective.members, collective.approvalMode)
  })
  return { ok: true }
}

/**
 * Leave the group. Nobody can be made to stay, so this needs no vote. Any
 * refund follows the group's exit policy and is approved like any payout.
 */
export async function leaveTreasury(collectiveId: string, input: { refundCents?: number } = {}): Promise<Result> {
  const viewer = await getViewer(collectiveId)
  if (!viewer) return { ok: false, error: 'Not a member of this collective.' }
  if (viewer.role === 'ADMIN') return { ok: false, error: 'The admin can’t leave. To end the group, propose closing the treasury.' }
  const locked = await treasuryLock(collectiveId)
  if (locked) return { ok: false, error: locked }
  const c = await prisma.collective.findUniqueOrThrow({
    where: { id: collectiveId },
    include: { members: { where: { role: { not: 'FORMER' } } }, tiers: true, entries: true, proposals: true },
  })
  if (c.proposals.some((p) => p.proposedById === viewer.id && ['PENDING_APPROVAL', 'APPROVED', 'EXECUTING'].includes(p.status))) {
    return { ok: false, error: 'You have a request still open. Wait for it to finish before you leave.' }
  }
  if (canApprove(viewer.role)) {
    const needed = Math.max(2, ...c.tiers.map((t) => t.requiredApprovals))
    const left = c.members.filter((m) => canApprove(m.role) && m.id !== viewer.id).length
    if (left < needed) return { ok: false, error: `The rules need ${needed} approvers. Ask the group to add another approver before you leave.` }
  }

  const available = computeTreasury(c.entries, c.proposals).availableCents
  const mine = fairShares(c.members, c.entries, available).find((s) => s.memberId === viewer.id)!
  const policy = c.exitPolicy as ExitPolicy
  const refundCents =
    policy === 'UNSPENT_SHARE'
      ? mine.shareCents
      : policy === 'VOTE'
        ? Math.max(0, Math.min(Math.round(input.refundCents ?? mine.shareCents), mine.contributedCents, available))
        : 0

  await prisma.$transaction(async (tx) => {
    await tx.member.update({ where: { id: viewer.id }, data: { role: 'FORMER' } })
    // Their panel seats are re-drawn the next time anyone opens the treasury.
    await tx.proposalReviewer.updateMany({ where: { memberId: viewer.id, status: 'ACTIVE' }, data: { expiresAt: new Date() } })
    await recordEvent(
      collectiveId,
      {
        actor: viewer.name,
        action: 'MEMBER_LEFT',
        summary: `left the group${refundCents > 0 ? `; a ${formatMoney(refundCents, c.currency, { cents: true })} refund goes to the group for approval` : policy === 'NO_REFUNDS' ? ' (no refunds: contributions stay with the cause)' : ''}`,
        data: { memberId: viewer.id, policy, refundCents, contributedCents: mine.contributedCents },
      },
      tx,
    )
  })

  if (refundCents > 0) {
    const r = await createPayoutProposal(collectiveId, viewer, {
      kind: 'REFUND',
      title: `Refund for ${viewer.name} (left the group)`,
      description:
        policy === 'UNSPENT_SHARE'
          ? `${viewer.name} put in ${formatMoney(mine.contributedCents, c.currency)}. Their share of the ${formatMoney(available, c.currency)} left is ${formatMoney(refundCents, c.currency, { cents: true })}, in proportion to what they contributed.`
          : `${viewer.name} asked for ${formatMoney(refundCents, c.currency, { cents: true })} back. They put in ${formatMoney(mine.contributedCents, c.currency)}; their proportional share of what's left would be ${formatMoney(mine.shareCents, c.currency, { cents: true })}.`,
      recipients: [{ name: viewer.name, receiver: viewer.email, receiverType: 'EMAIL', amountCents: refundCents }],
    })
    if (!r.ok) return r
  }
  refresh()
  return { ok: true }
}

type ClosePlan = { mode: 'SPLIT' } | { mode: 'SINGLE'; name: string; receiver: string; receiverType: ReceiverType }

/**
 * Propose closing the treasury with its final settlement. Approved at the
 * strictest tier; while it's being voted on, new money movements pause.
 */
export async function proposeClose(collectiveId: string, plan: ClosePlan): Promise<Result> {
  const viewer = await getViewer(collectiveId)
  if (!viewer) return { ok: false, error: 'Not a member of this collective.' }
  const locked = await treasuryLock(collectiveId)
  if (locked) return { ok: false, error: locked }
  if (await openPayoutCount(collectiveId)) return { ok: false, error: 'Finish or reject the open payout requests first, so the final numbers are settled.' }
  if (await prisma.proposal.count({ where: { collectiveId, kind: 'RULE_CHANGE', status: 'PENDING_APPROVAL' } })) {
    return { ok: false, error: 'A rule change is waiting for approval. Settle it before proposing to close.' }
  }
  const c = await prisma.collective.findUniqueOrThrow({
    where: { id: collectiveId },
    include: { members: { where: { role: { not: 'FORMER' } } }, entries: true, proposals: true },
  })
  const policy = c.exitPolicy as ExitPolicy
  if (policy === 'UNSPENT_SHARE' && plan.mode !== 'SPLIT') return { ok: false, error: 'This group refunds unspent shares, so closing splits what’s left by contribution.' }
  if (policy === 'NO_REFUNDS' && plan.mode !== 'SINGLE') return { ok: false, error: 'This group gives no refunds, so what’s left goes to one recipient you choose.' }

  const available = computeTreasury(c.entries, c.proposals).availableCents
  let recipients: NewRecipient[] = []
  let line: string
  if (plan.mode === 'SPLIT') {
    recipients = fairShares(c.members, c.entries, available, true)
      .filter((s) => s.shareCents > 0)
      .map((s) => ({ name: s.name, receiver: s.email.toLowerCase(), receiverType: 'EMAIL' as const, amountCents: s.shareCents }))
    line = `Split the ${formatMoney(available, c.currency, { cents: true })} left between members in proportion to what each put in.`
  } else {
    const name = String(plan.name ?? '').trim().slice(0, 80)
    if (!name) return { ok: false, error: 'Who should receive what’s left?' }
    const checked = normalizeReceiver(plan.receiverType === 'PHONE' ? 'PHONE' : 'EMAIL', String(plan.receiver ?? ''))
    if (!checked.ok) return { ok: false, error: checked.error }
    if (available > 0) recipients = [{ name, receiver: checked.receiver, receiverType: plan.receiverType === 'PHONE' ? 'PHONE' : 'EMAIL', amountCents: available }]
    line = `Send the ${formatMoney(available, c.currency, { cents: true })} left to ${name}.`
  }

  const proposal = await prisma.proposal.create({
    data: {
      collectiveId,
      kind: 'CLOSE',
      title: 'Close the treasury',
      description: `${line}\nAfter the payout, the treasury becomes read-only. The ledger and activity log stay here for the record.`,
      amountCents: recipients.reduce((s, r) => s + r.amountCents, 0),
      requiredApprovals: await ruleChangeApprovals(collectiveId, viewer.id),
      proposedById: viewer.id,
      recipients: { create: recipients },
    },
  })
  await recordEvent(collectiveId, {
    actor: viewer.name,
    action: 'CLOSE_PROPOSED',
    summary: `proposed closing the treasury. ${line} New contributions and requests are paused during the vote`,
    data: { proposalId: proposal.id, plan: plan.mode, availableCents: available },
  })
  refresh()
  return { ok: true }
}

/** Propose new spending rules / approvers. Applied only after approval (dual admin control). */
export async function proposeRuleChange(collectiveId: string, rules: RulesPayload): Promise<Result> {
  const viewer = await getViewer(collectiveId)
  if (!viewer || !canApprove(viewer.role)) return { ok: false, error: 'Only approvers can propose rule changes.' }
  const locked = await treasuryLock(collectiveId)
  if (locked) return { ok: false, error: locked }
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
    approvalMode: c.approvalMode as RulesPayload['approvalMode'],
    exitPolicy: c.exitPolicy as ExitPolicy,
    maxMembers: c.maxMembers,
  }
  const staying = c.members.filter((m) => m.role !== 'FORMER' && !(rules.removeMemberIds ?? []).includes(m.id)).length
  if (rules.maxMembers != null && rules.maxMembers < staying) return { ok: false, error: `The group already has ${staying} members, so the limit can’t go below that.` }
  if ((rules.removeMemberIds ?? []).includes(viewer.id)) return { ok: false, error: 'You can’t propose removing yourself.' }
  if (admin && (rules.removeMemberIds ?? []).includes(admin.id)) return { ok: false, error: 'The admin can’t be removed.' }
  const lines = describeRuleChange(current, rules, new Map(c.members.map((m) => [m.id, m.name])), c.currency)
  if (lines.length === 0) return { ok: false, error: 'Nothing changed.' }

  const ruleProposal = await prisma.proposal.create({
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
  await recordEvent(collectiveId, {
    actor: viewer.name,
    action: 'RULE_CHANGE_PROPOSED',
    summary: `proposed a rule change: ${lines.join('; ')}`,
    data: { proposalId: ruleProposal.id, rules },
  })
  refresh()
  return { ok: true }
}

/**
 * Maker-checker: only approvers can decide, never on their own request, and
 * once each. A "no" doesn't end the vote: the request is approved once it has
 * enough approvals, and only fails when it can no longer get them. Everyone
 * eligible still gets to vote before it closes (see lib/voting.ts).
 */
export async function decideRequest(proposalId: string, decision: 'APPROVE' | 'REJECT'): Promise<Result> {
  const proposal = await prisma.proposal.findUnique({ where: { id: proposalId }, include: { approvals: true } })
  if (!proposal) return { ok: false, error: 'Request not found.' }
  if (proposal.status !== 'PENDING_APPROVAL') return { ok: false, error: 'This request is no longer open for approval.' }

  const viewer = await getViewer(proposal.collectiveId)
  if (!viewer) return { ok: false, error: 'Not a member of this collective.' }
  if (proposal.proposedById === viewer.id) return { ok: false, error: 'You created this request, so someone else must review it.' }
  // Panel requests: only the members drawn for the panel can vote. Otherwise: approvers.
  const seat = proposal.panelSeed
    ? await prisma.proposalReviewer.findFirst({ where: { proposalId, memberId: viewer.id, status: 'ACTIVE' } })
    : null
  if (proposal.panelSeed ? !seat : !canApprove(viewer.role)) {
    return { ok: false, error: proposal.panelSeed ? 'Only the members drawn for this review panel can decide.' : 'Only approvers can decide on requests.' }
  }
  if (proposal.approvals.some((a) => a.memberId === viewer.id)) return { ok: false, error: 'You have already voted on this request.' }

  await prisma.$transaction(async (tx) => {
    await tx.approval.create({ data: { proposalId, memberId: viewer.id, decision } })
    if (seat) await tx.proposalReviewer.update({ where: { id: seat.id }, data: { status: 'VOTED' } })
    const approvals = await tx.approval.count({ where: { proposalId, decision: 'APPROVE' } })
    const left = await votersLeft(tx, proposal)
    const wontPass = approvals + left < proposal.requiredApprovals
    const status = approvals >= proposal.requiredApprovals ? 'APPROVED' : wontPass && left === 0 ? 'REJECTED' : 'PENDING_APPROVAL'
    await recordEvent(
      proposal.collectiveId,
      {
        actor: proposal.panelSeed ? 'A panel reviewer' : viewer.name,
        action: decision === 'APPROVE' ? 'VOTE_APPROVE' : 'VOTE_REJECT',
        summary: `${decision === 'APPROVE' ? 'approved' : 'rejected'} "${proposal.title}" (${approvals} of ${proposal.requiredApprovals})`,
        data: { proposalId, decision },
      },
      tx,
    )
    if (wontPass && !proposal.wontPassAt && status === 'PENDING_APPROVAL') {
      // Settled: no money will move. Remaining voters still get their say.
      await tx.proposal.update({ where: { id: proposalId }, data: { wontPassAt: new Date() } })
      await recordEvent(
        proposal.collectiveId,
        {
          actor: 'CoTreasury',
          action: 'REQUEST_WONT_PASS',
          summary: `"${proposal.title}" can no longer reach ${proposal.requiredApprovals} approval${proposal.requiredApprovals === 1 ? '' : 's'}, so no money will move. Voting stays open until everyone has voted or ${REVIEW_WINDOW_HOURS}h pass`,
          data: { proposalId },
        },
        tx,
      )
    }
    if (status === 'REJECTED') return closeRejected(tx, proposalId, 'ALL_VOTED')
    if (status === 'APPROVED') {
      await revealPanel(tx, proposalId)
      await recordEvent(
        proposal.collectiveId,
        {
          actor: 'CoTreasury',
          action: proposal.kind === 'RULE_CHANGE' ? 'RULES_CHANGED' : proposal.kind === 'CLOSE' ? 'TREASURY_CLOSING' : 'REQUEST_APPROVED',
          summary:
            proposal.kind === 'RULE_CHANGE'
              ? `new spending rules took effect: ${proposal.description?.replace(/\n/g, '; ')}`
              : proposal.kind === 'CLOSE'
                ? `the group approved closing the treasury (${proposal.requiredApprovals} approval${proposal.requiredApprovals === 1 ? '' : 's'}); paying out the final settlement`
                : `"${proposal.title}" reached ${proposal.requiredApprovals} approval${proposal.requiredApprovals === 1 ? '' : 's'}`,
          data: { proposalId },
        },
        tx,
      )
    }
    if (status === proposal.status) return
    if (status === 'APPROVED' && proposal.kind === 'RULE_CHANGE' && proposal.changePayload) {
      // Apply the approved rules atomically with the final approval.
      const rules = JSON.parse(proposal.changePayload) as RulesPayload
      await tx.governanceTier.deleteMany({ where: { collectiveId: proposal.collectiveId } })
      await tx.governanceTier.createMany({ data: rules.tiers.map((t) => ({ ...t, collectiveId: proposal.collectiveId })) })
      await tx.member.updateMany({ where: { collectiveId: proposal.collectiveId, role: 'APPROVER', id: { notIn: rules.approverIds } }, data: { role: 'MEMBER' } })
      await tx.member.updateMany({ where: { collectiveId: proposal.collectiveId, role: 'MEMBER', id: { in: rules.approverIds } }, data: { role: 'APPROVER' } })
      await tx.collective.update({
        where: { id: proposal.collectiveId },
        data: {
          newPayeeRule: rules.newPayeeRule,
          ...(rules.approvalMode ? { approvalMode: rules.approvalMode } : {}),
          ...(rules.exitPolicy ? { exitPolicy: rules.exitPolicy } : {}),
          ...(rules.maxMembers != null ? { maxMembers: rules.maxMembers } : {}),
        },
      })
      if (rules.removeMemberIds?.length) {
        // Former members keep their history (payments, votes) but can no longer act.
        await tx.member.updateMany({ where: { collectiveId: proposal.collectiveId, id: { in: rules.removeMemberIds }, role: { not: 'ADMIN' } }, data: { role: 'FORMER' } })
      }
      await tx.proposal.update({ where: { id: proposalId }, data: { status: 'COMPLETED' } })
      return
    }
    if (status === 'APPROVED' && proposal.kind === 'CLOSE') {
      await tx.collective.update({ where: { id: proposal.collectiveId }, data: { status: 'CLOSING' } })
    }
    await tx.proposal.update({ where: { id: proposalId }, data: { status } })
  })

  // The collective has decided: the final approval sends the money through PayPal.
  const after = await prisma.proposal.findUnique({ where: { id: proposalId }, select: { status: true, kind: true, collectiveId: true, _count: { select: { recipients: true } } } })
  if (after?.kind === 'CLOSE' && after.status === 'APPROVED' && after._count.recipients === 0) {
    // Nothing left to pay out: close straight away.
    await prisma.proposal.update({ where: { id: proposalId }, data: { status: 'COMPLETED' } })
    await markClosed(after.collectiveId)
    refresh()
    return { ok: true }
  }
  if (after && PAYOUT_KINDS.includes(after.kind) && after.status === 'APPROVED') {
    const sent = await executePayout(proposalId)
    refresh()
    return sent.ok ? { ok: true } : { ok: false, error: sent.error ?? 'PayPal payout failed.' }
  }
  refresh()
  return { ok: true }
}

/** Approvers can resend a payout that PayPal rejected outright (nothing was paid). */
export async function retryRequestPayout(proposalId: string): Promise<Result> {
  const p = await prisma.proposal.findUnique({ where: { id: proposalId } })
  if (!p) return { ok: false, error: 'Request not found.' }
  const viewer = await getViewer(p.collectiveId)
  if (!viewer || !canApprove(viewer.role)) return { ok: false, error: 'Only approvers can retry a payout.' }
  const r = await retryPayout(proposalId)
  refresh()
  return r.ok ? { ok: true } : { ok: false, error: r.error ?? 'Retry failed.' }
}

/**
 * The final settlement failed and nothing was paid (e.g. PayPal had too little
 * money): approvers can reopen the treasury instead of leaving it stuck closing.
 */
export async function cancelClose(proposalId: string): Promise<Result> {
  const p = await prisma.proposal.findUnique({ where: { id: proposalId }, include: { recipients: true } })
  if (!p || p.kind !== 'CLOSE' || p.status !== 'FAILED') return { ok: false, error: 'There is no failed closing to cancel.' }
  const viewer = await getViewer(p.collectiveId)
  if (!viewer || !canApprove(viewer.role)) return { ok: false, error: 'Only approvers can cancel closing.' }
  if (p.recipients.some((r) => r.status === 'SUCCEEDED' || r.status === 'UNCLAIMED')) {
    return { ok: false, error: 'Part of the settlement was already paid, so the treasury can’t reopen. Retry the rest instead.' }
  }
  const { count } = await prisma.collective.updateMany({ where: { id: p.collectiveId, status: 'CLOSING' }, data: { status: 'OPEN' } })
  if (count === 0) return { ok: false, error: 'This treasury isn’t closing.' }
  await prisma.proposal.update({ where: { id: p.id }, data: { status: 'REJECTED', failureReason: `${p.failureReason ?? 'The settlement failed.'} Closing was cancelled.` } })
  await recordEvent(p.collectiveId, {
    actor: viewer.name,
    action: 'TREASURY_REOPENED',
    summary: 'cancelled closing after the final settlement failed (nothing was paid); the treasury is open again',
    data: { proposalId: p.id },
  })
  refresh()
  return { ok: true }
}

/** Approvers set what the collective is saving for. Goals don't move money, so no vote is needed. */
export async function addGoal(
  collectiveId: string,
  input: { title: string; kind: 'TARGET' | 'MONTHLY'; perMemberCents: number; dueDate?: string | null },
): Promise<Result> {
  const viewer = await getViewer(collectiveId)
  const locked = await treasuryLock(collectiveId)
  if (locked) return { ok: false, error: locked }
  if (!viewer || !canApprove(viewer.role)) return { ok: false, error: 'Only approvers can add goals.' }
  const title = input.title?.trim() ?? ''
  if (title.length < 3 || title.length > 80) return { ok: false, error: 'Give the goal a short name.' }
  if (!Number.isInteger(input.perMemberCents) || input.perMemberCents < 100 || input.perMemberCents > 10_000_000) {
    return { ok: false, error: 'Enter an amount per member.' }
  }
  const kind = input.kind === 'MONTHLY' ? 'MONTHLY' : 'TARGET'
  const due = kind === 'TARGET' && input.dueDate ? new Date(input.dueDate) : null
  if (due && isNaN(due.getTime())) return { ok: false, error: 'Pick a valid due date.' }
  const now = new Date()
  const goal = await prisma.goal.create({
    data: {
      collectiveId,
      title,
      kind,
      perMemberCents: input.perMemberCents,
      dueDate: due,
      startMonth: kind === 'MONTHLY' ? new Date(now.getFullYear(), now.getMonth(), 1) : null,
    },
  })
  await recordEvent(collectiveId, {
    actor: viewer.name,
    action: 'GOAL_CREATED',
    summary: `set a goal: ${title} (${formatMoney(input.perMemberCents, 'USD')} per member${kind === 'MONTHLY' ? ' each month' : due ? `, due ${due.toDateString()}` : ''})`,
    data: { goalId: goal.id },
  })
  refresh()
  return { ok: true }
}

export async function checkIntegrity(collectiveId: string) {
  const { verifyChain } = await import('@/lib/audit')
  return verifyChain(collectiveId)
}

/** The member has seen their notifications up to `seq`; never moves backwards. */
export async function markNotificationsSeen(collectiveId: string, seq: number) {
  const viewer = await getViewer(collectiveId)
  if (!viewer || !Number.isInteger(seq) || seq <= viewer.lastSeenSeq) return
  await prisma.member.update({ where: { id: viewer.id }, data: { lastSeenSeq: seq } })
}

/** Admin: rename the treasury or reword its purpose. Logged, not governed (moves no money). */
export async function updateTreasuryDetails(collectiveId: string, input: { name: string; purpose: string }): Promise<Result> {
  const viewer = await getViewer(collectiveId)
  if (!viewer || viewer.role !== 'ADMIN') return { ok: false, error: 'Only the admin can edit the treasury details.' }
  const name = input.name?.trim() ?? ''
  const purpose = input.purpose?.trim() ?? ''
  if (name.length < 3 || name.length > 80) return { ok: false, error: 'Give the treasury a name (3–80 characters).' }
  if (purpose.length < 10 || purpose.length > 400) return { ok: false, error: 'Describe the shared purpose in a sentence or two.' }
  const before = await prisma.collective.findUniqueOrThrow({ where: { id: collectiveId }, select: { name: true, purpose: true } })
  if (before.name === name && before.purpose === purpose) return { ok: true }
  await prisma.collective.update({ where: { id: collectiveId }, data: { name, purpose } })
  await recordEvent(collectiveId, {
    actor: viewer.name,
    action: 'TREASURY_EDITED',
    summary: before.name !== name ? `renamed the treasury from "${before.name}" to "${name}"` : 'updated the shared purpose',
    data: { before, after: { name, purpose } },
  })
  refresh()
  return { ok: true }
}

/** Admin: add a member (contributor). Making someone an approver is a governed rule change. */
export async function addMember(collectiveId: string, input: { name: string; email: string }): Promise<Result> {
  const viewer = await getViewer(collectiveId)
  if ((await prisma.collective.findUnique({ where: { id: collectiveId }, select: { status: true } }))?.status !== 'OPEN') return { ok: false, error: 'This treasury is closed to new members.' }
  if (!viewer || viewer.role !== 'ADMIN') return { ok: false, error: 'Only the admin can add members.' }
  const r = await admitMember(collectiveId, input, { actor: viewer.name, action: 'MEMBER_ADDED', summary: (name) => `added ${name} to the group` })
  if (!r.ok) return r
  refresh()
  return { ok: true }
}

/** Admin: create or reset the invite link (the old one stops working), or turn it off. */
export async function setInviteLink(collectiveId: string, on: boolean): Promise<Result> {
  const viewer = await getViewer(collectiveId)
  if (!viewer || viewer.role !== 'ADMIN') return { ok: false, error: 'Only the admin can manage the invite link.' }
  const before = await prisma.collective.findUnique({ where: { id: collectiveId }, select: { inviteCode: true } })
  await prisma.collective.update({ where: { id: collectiveId }, data: { inviteCode: on ? randomBytes(12).toString('base64url') : null } })
  await recordEvent(collectiveId, {
    actor: viewer.name,
    action: on ? 'INVITE_LINK_CREATED' : 'INVITE_LINK_DISABLED',
    summary: on ? (before?.inviteCode ? 'reset the invite link; the old link no longer works' : 'created an invite link for new members') : 'turned off the invite link',
  })
  refresh()
  return { ok: true }
}
