import { prisma } from './prisma'
import { canApprove, computeTreasury, tierFor } from './treasury'
import { formatMoney } from './money'

// Bank-style dual-control rules, all deterministic. The AI Treasurer reads
// these results and explains them; it never decides them.

export type Flag = { code: string; message: string; extraApproval: boolean }

export type ApprovalMode = 'FIXED' | 'RANDOM' | 'MIXED'
export const APPROVAL_MODE_LABEL: Record<ApprovalMode, string> = {
  FIXED: 'Fixed approvers',
  RANDOM: 'Random review panel',
  MIXED: 'Mixed panel (1 officer + random members)',
}

export type RulesPayload = {
  tiers: { minCents: number; maxCents: number | null; requiredApprovals: number }[]
  approverIds: string[]
  newPayeeRule: boolean
  approvalMode?: ApprovalMode
  removeMemberIds?: string[]
}

type Recipient = { name: string; receiver: string; amountCents: number }

async function loadCollective(collectiveId: string) {
  return prisma.collective.findUniqueOrThrow({
    where: { id: collectiveId },
    include: {
      members: { where: { role: { not: 'FORMER' } } },
      tiers: { orderBy: { minCents: 'asc' } },
      entries: true,
      proposals: { include: { recipients: true } },
    },
  })
}

/**
 * Most approvals a request can ever collect: every approver except the person
 * who made it (maker-checker). Requirements are capped here so no request is
 * born unapprovable.
 */
function maxReachable(approverIds: string[], makerId: string | null) {
  return approverIds.filter((id) => id !== makerId).length
}

export async function assessSpend(collectiveId: string, recipients: Recipient[], makerId: string | null) {
  const c = await loadCollective(collectiveId)
  const treasury = computeTreasury(c.entries, c.proposals)
  const approverIds = c.members.filter((m) => canApprove(m.role)).map((m) => m.id)
  const amountCents = recipients.reduce((s, r) => s + r.amountCents, 0)
  const base = tierFor(amountCents, c.tiers)?.requiredApprovals ?? approverIds.length

  // Anyone this collective has actually paid before (completed payouts).
  const known = new Set(
    c.proposals
      .filter((p) => p.kind === 'SPEND' && p.status === 'COMPLETED')
      .flatMap((p) => p.recipients.map((r) => r.receiver.trim().toLowerCase())),
  )
  const memberByEmail = new Map(c.members.map((m) => [m.email.toLowerCase(), m]))

  const flags: Flag[] = []
  const newPayees = recipients.filter((r) => !known.has(r.receiver.trim().toLowerCase()))
  if (newPayees.length > 0) {
    flags.push({
      code: 'NEW_PAYEE',
      // Standard for every treasury: paying someone new always needs one extra approval.
      message: `First payment to ${newPayees.length === 1 ? newPayees[0].name : `${newPayees.length} new recipients`} (+1 approval)`,
      extraApproval: true,
    })
  }
  const self = recipients.find((r) => memberByEmail.get(r.receiver.trim().toLowerCase())?.id === makerId)
  if (self) flags.push({ code: 'SELF_PAYMENT', message: 'The requester is paying themselves (+1 approval)', extraApproval: true })
  const paysMember = recipients.filter((r) => {
    const m = memberByEmail.get(r.receiver.trim().toLowerCase())
    return m && m.id !== makerId
  })
  if (paysMember.length > 0) flags.push({ code: 'PAYS_MEMBER', message: `Pays a member of the group: ${paysMember.map((r) => r.name).join(', ')}`, extraApproval: false })
  const receivers = recipients.map((r) => r.receiver.trim().toLowerCase())
  if (new Set(receivers).size !== receivers.length) flags.push({ code: 'DUPLICATE_RECIPIENT', message: 'The same recipient appears more than once', extraApproval: false })
  if (treasury.availableCents > 0 && amountCents > treasury.availableCents * 0.5 && amountCents <= treasury.availableCents) {
    flags.push({ code: 'LARGE_SHARE', message: `Uses more than half of the ${formatMoney(treasury.availableCents, c.currency)} available`, extraApproval: false })
  }

  const extras = flags.filter((f) => f.extraApproval).length
  const requiredApprovals = Math.max(1, Math.min(base + extras, maxReachable(approverIds, makerId)))

  return {
    amountCents,
    affordable: amountCents <= treasury.availableCents,
    availableCents: treasury.availableCents,
    baseApprovals: base,
    requiredApprovals,
    approverCount: approverIds.length,
    flags,
    currency: c.currency,
  }
}

/** Rule changes are governed too: they need the strictest tier's approval count. */
export async function ruleChangeApprovals(collectiveId: string, makerId: string) {
  const c = await loadCollective(collectiveId)
  const approverIds = c.members.filter((m) => canApprove(m.role)).map((m) => m.id)
  const strictest = Math.max(...c.tiers.map((t) => t.requiredApprovals), 1)
  return Math.max(1, Math.min(strictest, maxReachable(approverIds, makerId)))
}

/** Validate a proposed rule set. Returns an error message, or null if it's sound. */
export function validateRules(rules: RulesPayload, memberIds: Set<string>): string | null {
  if (rules.approvalMode && !['FIXED', 'RANDOM', 'MIXED'].includes(rules.approvalMode)) return 'Unknown approval mode.'
  if ((rules.removeMemberIds ?? []).some((id) => rules.approverIds.includes(id))) return 'Remove someone from the approvers before removing them from the group.'
  if (rules.approverIds.length < 2) return 'Keep at least two approvers so no one can approve alone.'
  if (rules.approverIds.some((id) => !memberIds.has(id))) return 'Approvers must be members of the group.'
  const tiers = [...rules.tiers].sort((a, b) => a.minCents - b.minCents)
  if (tiers.length === 0 || tiers[0].minCents !== 0) return 'The first rule must start at $0.'
  for (let i = 0; i < tiers.length; i++) {
    const t = tiers[i]
    if (!Number.isInteger(t.requiredApprovals) || t.requiredApprovals < 1) return 'Each rule needs at least 1 approval.'
    if (t.requiredApprovals > rules.approverIds.length) return `A rule needs ${t.requiredApprovals} approvals but there are only ${rules.approverIds.length} approvers.`
    const next = tiers[i + 1]
    if (next ? t.maxCents !== next.minCents : t.maxCents !== null) return 'Rules must cover every amount with no gaps.'
    if (i > 0 && t.requiredApprovals < tiers[i - 1].requiredApprovals) return 'Bigger amounts cannot need fewer approvals than smaller ones.'
  }
  return null
}

export function describeRuleChange(current: RulesPayload, next: RulesPayload, names: Map<string, string>, currency: string): string[] {
  const lines: string[] = []
  const fmt = (t: RulesPayload['tiers'][number]) =>
    t.maxCents === null ? `${formatMoney(t.minCents, currency)}+` : `${formatMoney(t.minCents, currency)}–${formatMoney(t.maxCents, currency)}`
  const sameRanges =
    current.tiers.length === next.tiers.length && current.tiers.every((t, i) => t.minCents === next.tiers[i].minCents && t.maxCents === next.tiers[i].maxCents)
  if (sameRanges) {
    // Same brackets: show exactly which thresholds move, e.g. "$5,000–$25,000: 3 → 2 approvals".
    next.tiers.forEach((t, i) => {
      const before = current.tiers[i].requiredApprovals
      if (before !== t.requiredApprovals) lines.push(`${fmt(t)}: ${before} → ${t.requiredApprovals} approvals${t.requiredApprovals < before ? ' (looser)' : ''}`)
    })
  } else {
    lines.push(`New approval brackets: ${next.tiers.map((t) => `${fmt(t)} needs ${t.requiredApprovals}`).join('; ')}`)
  }
  const added = next.approverIds.filter((id) => !current.approverIds.includes(id))
  const removed = current.approverIds.filter((id) => !next.approverIds.includes(id))
  if (added.length) lines.push(`Add approver${added.length > 1 ? 's' : ''}: ${added.map((id) => names.get(id)).join(', ')}`)
  if (removed.length) lines.push(`Remove approver${removed.length > 1 ? 's' : ''}: ${removed.map((id) => names.get(id)).join(', ')}`)
  const fromMode = current.approvalMode ?? 'FIXED'
  const toMode = next.approvalMode ?? fromMode
  if (fromMode !== toMode) lines.push(`Who reviews payouts: ${APPROVAL_MODE_LABEL[fromMode]} → ${APPROVAL_MODE_LABEL[toMode]}`)
  if (next.removeMemberIds?.length) lines.push(`Remove from the group: ${next.removeMemberIds.map((id) => names.get(id)).join(', ')}`)
  return lines
}
