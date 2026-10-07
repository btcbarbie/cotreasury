// Deterministic treasury math. This is the only place balances, commitments
// and approval requirements are computed — the AI Treasurer reads these
// numbers, it never produces them.

type Entry = { direction: string; status: string; amountCents: number }
type Tier = { minCents: number; maxCents: number | null; requiredApprovals: number }
type ProposalLike = { status: string; amountCents: number }

export type TreasuryState = {
  confirmedBalanceCents: number
  pendingInCents: number
  pendingOutCents: number
  committedCents: number
  awaitingApprovalCents: number
  availableCents: number
}

export function computeTreasury(entries: Entry[], proposals: ProposalLike[]): TreasuryState {
  let confirmed = 0
  let pendingIn = 0
  let pendingOut = 0
  for (const e of entries) {
    const signed = e.direction === 'IN' ? e.amountCents : -e.amountCents
    if (e.status === 'CONFIRMED') confirmed += signed
    else if (e.status === 'PENDING') {
      if (e.direction === 'IN') pendingIn += e.amountCents
      else pendingOut += e.amountCents
    }
  }
  // Approved but not yet sent to PayPal: money the group has already agreed to spend.
  const committed = proposals
    .filter((p) => p.status === 'APPROVED')
    .reduce((s, p) => s + p.amountCents, 0)
  const awaiting = proposals
    .filter((p) => p.status === 'PENDING_APPROVAL')
    .reduce((s, p) => s + p.amountCents, 0)

  return {
    confirmedBalanceCents: confirmed,
    pendingInCents: pendingIn,
    pendingOutCents: pendingOut,
    committedCents: committed,
    awaitingApprovalCents: awaiting,
    availableCents: confirmed - pendingOut - committed,
  }
}

export function tierFor(amountCents: number, tiers: Tier[]): Tier | null {
  return (
    [...tiers]
      .sort((a, b) => a.minCents - b.minCents)
      .find((t) => amountCents >= t.minCents && (t.maxCents === null || amountCents < t.maxCents)) ?? null
  )
}

export function canApprove(role: string): boolean {
  return role === 'APPROVER' || role === 'ADMIN'
}
