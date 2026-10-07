import Anthropic from '@anthropic-ai/sdk'
import { prisma } from './prisma'
import { computeTreasury, tierFor, canApprove } from './treasury'
import { formatMoney } from './money'
import { assessSpend, type Flag } from './governance'
import { goalProgress } from './goals'
import type { ReceiverType } from './recipients'

// The AI Treasurer. It can READ the ledger and run deterministic checks, and it
// can DRAFT a spending request. It cannot approve, submit, change rules or move
// money: those tools simply don't exist for it. Every number it states comes
// from a tool result computed in code.

const MODEL = process.env.CLAUDE_MODEL || 'claude-opus-5-5'
// Pin the endpoint so a shell-level ANTHROPIC_BASE_URL (e.g. from dev tooling) can't redirect calls.
const client = new Anthropic({ baseURL: process.env.COTREASURY_ANTHROPIC_URL || 'https://api.anthropic.com' })

export type DraftRequest = {
  title: string
  description: string
  recipients: { name: string; receiver: string; receiverType?: ReceiverType; amountCents: number }[]
  amountCents: number
  requiredApprovals: number
  flags: Flag[]
}

// A contribution the AI has lined up. Paying it still happens in PayPal, by the member.
export type ContributionDraft = { amountCents: number; goalId: string | null; goalTitle: string | null }

export type TreasurerReply = {
  answer: string
  checks: string[] // human-readable trace of what the Treasurer looked at
  draft: DraftRequest | null
  contribution: ContributionDraft | null
}

export type Viewer = { id: string; name: string; role: string }

const TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: 'prepare_contribution',
    description:
      "Line up a contribution for the member you're talking to, so they can pay it with PayPal in one click. This does NOT take any money: the member still confirms and pays in PayPal themselves. Use goal_title to attribute it to one of the collective's goals (exact title from the treasury state), or omit it for the general fund.",
    input_schema: {
      type: 'object',
      properties: {
        amount_cents: { type: 'integer', description: 'Amount in cents' },
        goal_title: { type: 'string', description: 'Exact goal title, or empty for the general fund' },
      },
      required: ['amount_cents', 'goal_title'],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: 'get_treasury_state',
    description:
      "Read the collective's current financial state from the ledger: balance, committed and pending money, available-to-spend, goals with who has and hasn't paid, approval rules, approvers, open requests and recent ledger activity. Call this before stating any figure.",
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
    strict: true,
  },
  {
    name: 'check_affordability',
    description:
      'Deterministically check whether a proposed spend fits the treasury: available before/after, whether it is affordable, how many approvals the rules require for that amount, and any risk flags. Use for every "can we afford" question.',
    input_schema: {
      type: 'object',
      properties: {
        amount_cents: { type: 'integer', description: 'Total proposed spend in cents' },
      },
      required: ['amount_cents'],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: 'draft_spending_request',
    description:
      'Prepare a spending request for the approvers to review. This does NOT submit or approve anything: a human must review the draft and submit it, then approvers vote. Only draft when the user asks to proceed or clearly wants to make the payment, and only if affordable. Recipients are paid via PayPal by email.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short title, e.g. "Fall scholarships — 4 awards"' },
        description: { type: 'string', description: 'One or two sentences on purpose and scope' },
        recipients: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              receiver: { type: 'string', description: "Recipient's PayPal email" },
              amount_cents: { type: 'integer' },
            },
            required: ['name', 'receiver', 'amount_cents'],
            additionalProperties: false,
          },
        },
      },
      required: ['title', 'description', 'recipients'],
      additionalProperties: false,
    },
    strict: true,
  },
]

const SYSTEM = `You are the AI Treasurer for a group that pools money (a scholarship fund, group trip, household, club, or similar). Members trust you to be precise and neutral.

How you work:
- Never guess or compute money figures yourself. Get every number from your tools, and quote them as given.
- For "can we afford…" questions, call check_affordability with the total in cents, then explain: available now, available after, and how many approvals the group's rules require (and who can give them).
- You can draft a spending request, but you cannot submit, approve, or change rules. Say so plainly if asked. Approvers decide; PayPal executes; the ledger records.
- The group runs bank-style dual controls (see other_controls and new_recipient_rule in the treasury state). When a draft carries risk flags, say which ones and why they change the number of approvals.
- If something is not affordable, say so and suggest what would be (e.g. fewer awards), using check_affordability to confirm.
- When drafting payouts to named people without emails, use placeholder emails like firstname.lastname@example.com and mention they must be confirmed before submitting.
- You are talking to the member described in "you_are" in the treasury state. "I", "me" and "my" mean them.
- To help someone add funds: work out which goal and how much (their outstanding amount is in you_are.owes), confirm if unclear, then call prepare_contribution. They pay in PayPal themselves.
- To help someone request a payout: you need who is being paid, their PayPal email, the amount, and what it's for. Ask for whatever is missing, one short question at a time, then call check_affordability and draft_spending_request.
- Be brief: 2–5 short sentences, plain language, no headings. Use **bold** sparingly for key figures.`

async function loadState(collectiveId: string) {
  const c = await prisma.collective.findUniqueOrThrow({
    where: { id: collectiveId },
    include: {
      members: { where: { role: { not: 'FORMER' } } },
      goals: true,
      tiers: { orderBy: { minCents: 'asc' } },
      entries: { orderBy: { createdAt: 'desc' } },
      proposals: { include: { approvals: true } },
    },
  })
  return { c, treasury: computeTreasury(c.entries, c.proposals) }
}

async function runTool(collectiveId: string, name: string, input: Record<string, unknown>, viewer: Viewer | null) {
  const { c, treasury } = await loadState(collectiveId)
  const cur = c.currency
  const approvers = c.members.filter((m) => canApprove(m.role))

  if (name === 'get_treasury_state') {
    return {
      result: {
        collective: c.name,
        purpose: c.purpose,
        currency: cur,
        balance: formatMoney(treasury.confirmedBalanceCents, cur, { cents: true }),
        committed_not_yet_paid: formatMoney(treasury.committedCents + treasury.pendingOutCents, cur, { cents: true }),
        awaiting_approval: formatMoney(treasury.awaitingApprovalCents, cur, { cents: true }),
        available_to_spend: formatMoney(treasury.availableCents, cur, { cents: true }),
        approval_rules: c.tiers.map((t) => ({
          range: t.maxCents === null ? `${formatMoney(t.minCents, cur)}+` : `${formatMoney(t.minCents, cur)}–${formatMoney(t.maxCents, cur)}`,
          approvals_required: `${t.requiredApprovals} of ${approvers.length}`,
        })),
        approvers: approvers.map((a) => a.name),
        new_recipient_rule: 'ALWAYS ON: the first payment to a never-paid recipient needs one extra approval',
        other_controls: [
          'Maker-checker: whoever submits a request cannot approve it',
          'A requester paying themselves needs one extra approval',
          'Rule and approver changes must be approved at the strictest tier before they take effect',
        ],
        member_count: c.members.length,
        you_are: viewer
          ? {
              name: viewer.name,
              role: viewer.role === 'MEMBER' ? 'member (cannot approve)' : 'approver',
              owes: goalProgress(c.goals, c.members, c.entries)
                .map((g) => {
                  const me = g.members.find((m) => m.id === viewer.id)
                  const left = me ? Math.max(0, g.expectedPerMemberCents - me.paidCents) : 0
                  return { goal: g.title, still_to_pay: formatMoney(left, cur) }
                })
                .filter((x) => x.still_to_pay !== formatMoney(0, cur)),
            }
          : null,
        goals: goalProgress(c.goals, c.members, c.entries).map((g) => ({
          title: g.title,
          type: g.kind === 'MONTHLY' ? `monthly pledge (month ${g.monthsDue})` : 'one-off goal',
          per_member: formatMoney(g.perMemberCents, cur),
          due: g.dueDate?.slice(0, 10) ?? null,
          collected: formatMoney(g.collectedCents, cur),
          target: formatMoney(g.targetCents, cur),
          paid_in_full: g.members.filter((m) => m.upToDate).map((m) => m.name),
          not_paid_in_full: g.members.filter((m) => !m.upToDate).map((m) => `${m.name} (paid ${formatMoney(m.paidCents, cur)})`),
        })),
        open_requests: c.proposals
          .filter((p) => ['PENDING_APPROVAL', 'APPROVED', 'EXECUTING'].includes(p.status))
          .map((p) => ({
            kind: p.kind,
            title: p.title,
            amount: formatMoney(p.amountCents, cur),
            status: p.wontPassAt ? 'CANNOT_PASS (no money will move; remaining voters can still vote)' : p.status,
            approvals: `${p.approvals.filter((a) => a.decision === 'APPROVE').length} of ${p.requiredApprovals}`,
            rejections: p.approvals.filter((a) => a.decision === 'REJECT').length,
            risk_flags: p.flags ? (JSON.parse(p.flags) as Flag[]).map((f) => f.message) : [],
          })),
        recent_ledger: c.entries.slice(0, 8).map((e) => ({
          date: e.createdAt.toISOString().slice(0, 10),
          type: e.type,
          amount: `${e.direction === 'IN' ? '+' : '-'}${formatMoney(e.amountCents, cur, { cents: true })}`,
          memo: e.memo,
          status: e.status,
        })),
      },
      check: 'Read the ledger and spending rules',
    }
  }

  if (name === 'check_affordability') {
    const amount = Number(input.amount_cents)
    const tier = tierFor(amount, c.tiers)
    const after = treasury.availableCents - amount
    const flags: string[] = []
    if (after < 0) flags.push('Exceeds available funds')
    else if (after < treasury.confirmedBalanceCents * 0.1) flags.push('Leaves less than 10% of the balance in reserve')
    return {
      result: {
        proposed: formatMoney(amount, cur, { cents: true }),
        available_now: formatMoney(treasury.availableCents, cur, { cents: true }),
        available_after: formatMoney(after, cur, { cents: true }),
        affordable: after >= 0,
        approvals_required: tier ? `${tier.requiredApprovals} of ${approvers.length}` : 'no matching rule',
        approvers: approvers.map((a) => a.name),
        flags,
      },
      check: `Checked ${formatMoney(amount, cur)} against available funds and rules`,
    }
  }

  if (name === 'draft_spending_request') {
    const recipients = ((input.recipients as { name: string; receiver: string; amount_cents: number }[]) ?? []).map((r) => ({
      name: r.name,
      receiver: r.receiver,
      amountCents: Math.round(r.amount_cents),
    }))
    if (recipients.length === 0 || recipients.some((r) => !(r.amountCents > 0))) {
      return { result: { error: 'A request needs at least one recipient with an amount.' }, check: 'Draft rejected' }
    }
    // Same deterministic assessment the server uses when the request is submitted.
    const a = await assessSpend(collectiveId, recipients, null)
    if (!a.affordable) {
      return { result: { error: `Not affordable: ${formatMoney(a.amountCents, cur)} exceeds available ${formatMoney(a.availableCents, cur)}.` }, check: 'Draft rejected: not affordable' }
    }
    const draft: DraftRequest = {
      title: String(input.title).slice(0, 120),
      description: String(input.description).slice(0, 500),
      recipients,
      amountCents: a.amountCents,
      requiredApprovals: a.requiredApprovals,
      flags: a.flags,
    }
    return {
      result: {
        drafted: true,
        total: formatMoney(a.amountCents, cur),
        approvals_by_amount: `${a.baseApprovals} of ${a.approverCount}`,
        approvals_required: `${a.requiredApprovals} (after risk controls; the submitter cannot approve their own request)`,
        risk_flags: a.flags.map((f) => f.message),
        note: 'Shown to the user to review and submit. Not submitted.',
      },
      check: a.flags.length ? `Drafted a request · ${a.flags.length} risk flag${a.flags.length > 1 ? 's' : ''}` : 'Drafted a request for the approvers',
      draft,
    }
  }

  if (name === 'prepare_contribution') {
    const amount = Math.round(Number(input.amount_cents))
    if (!(amount >= 100 && amount <= 1_000_000)) return { result: { error: 'Contributions must be between $1 and $10,000.' }, check: 'Contribution not prepared' }
    const title = String(input.goal_title ?? '').trim()
    const goal = title ? c.goals.find((g) => g.title.toLowerCase() === title.toLowerCase()) : null
    if (title && !goal) return { result: { error: `No goal called "${title}". Goals: ${c.goals.map((g) => g.title).join(', ') || 'none'}.` }, check: 'Contribution not prepared' }
    const contribution: ContributionDraft = { amountCents: amount, goalId: goal?.id ?? null, goalTitle: goal?.title ?? null }
    return {
      result: { prepared: true, amount: formatMoney(amount, cur), for: goal?.title ?? 'general fund', note: 'Shown to the member with a Pay with PayPal button. Nothing has been paid.' },
      check: `Lined up ${formatMoney(amount, cur)} for ${goal?.title ?? 'the general fund'}`,
      contribution,
    }
  }

  return { result: { error: `Unknown tool ${name}` }, check: `Unknown tool ${name}` }
}

export async function askTreasurer(
  collectiveId: string,
  history: { role: 'user' | 'assistant'; content: string }[],
  viewer: Viewer | null = null,
): Promise<TreasurerReply> {
  const messages: Anthropic.Beta.BetaMessageParam[] = history.map((m) => ({ role: m.role, content: m.content }))
  const checks: string[] = []
  let draft: DraftRequest | null = null
  let contribution: ContributionDraft | null = null

  for (let turn = 0; turn < 6; turn++) {
    // Server-side refusal fallback: if a safety classifier declines, the API
    // re-runs the request on Anthropic's recommended fallback model.
    const response = await client.beta.messages.create({
      model: MODEL,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      max_tokens: 4000,
      system: SYSTEM,
      tools: TOOLS,
      output_config: { effort: 'medium' },
      messages,
    })

    if (response.stop_reason === 'refusal') {
      return { answer: "I can't help with that request.", checks, draft, contribution }
    }

    const toolUses = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use')
    if (response.stop_reason !== 'tool_use' || toolUses.length === 0) {
      const answer = response.content
        .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
        .trim()
      return { answer: answer || 'Done.', checks, draft, contribution }
    }

    messages.push({ role: 'assistant', content: response.content })
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = []
    for (const t of toolUses) {
      try {
        const out = await runTool(collectiveId, t.name, (t.input ?? {}) as Record<string, unknown>, viewer)
        checks.push(out.check)
        if ('draft' in out && out.draft) draft = out.draft
        if ('contribution' in out && out.contribution) contribution = out.contribution
        results.push({ type: 'tool_result', tool_use_id: t.id, content: JSON.stringify(out.result) })
      } catch (e) {
        results.push({ type: 'tool_result', tool_use_id: t.id, content: (e as Error).message, is_error: true })
      }
    }
    messages.push({ role: 'user', content: results })
  }
  return { answer: 'I ran out of steps working on that. Try a more specific question.', checks, draft, contribution }
}
