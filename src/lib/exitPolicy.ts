// Exit policies and the fair-share maths. Pure functions (no database), so the
// same numbers show in the browser, on the server and to the AI Treasurer.

export type ExitPolicy = 'NO_REFUNDS' | 'UNSPENT_SHARE' | 'VOTE'

export const EXIT_POLICIES: { id: ExitPolicy; label: string; hint: string }[] = [
  { id: 'NO_REFUNDS', label: 'No refunds', hint: 'Money given is a gift to the cause. If the group closes, what’s left goes to one recipient the group chooses.' },
  { id: 'UNSPENT_SHARE', label: 'Refund your unspent share', hint: 'Anyone who leaves gets their share of what’s left, in proportion to what they put in. Closing splits the rest the same way.' },
  { id: 'VOTE', label: 'Decided by vote', hint: 'Each refund, and how to settle up when closing, is put to the group.' },
]

export function exitPolicyLabel(id: string) {
  return EXIT_POLICIES.find((p) => p.id === id)?.label ?? 'Decided by vote'
}

type Member = { id: string; name: string; email: string }
type Entry = { type: string; direction: string; status: string; amountCents: number; memberId: string | null }

export type Share = { memberId: string; name: string; email: string; contributedCents: number; shareCents: number }

/**
 * Each member's share of the money available now, in proportion to the
 * confirmed contributions they made. `settleAll` hands out the leftover cents
 * so the shares add up exactly (used when closing); otherwise shares round down.
 */
export function fairShares(members: Member[], entries: Entry[], availableCents: number, settleAll = false): Share[] {
  const paid = new Map<string, number>()
  for (const e of entries) {
    if (e.type === 'CONTRIBUTION' && e.direction === 'IN' && e.status === 'CONFIRMED' && e.memberId) {
      paid.set(e.memberId, (paid.get(e.memberId) ?? 0) + e.amountCents)
    }
  }
  const rows = members.map((m) => ({ memberId: m.id, name: m.name, email: m.email, contributedCents: paid.get(m.id) ?? 0, shareCents: 0 }))
  const total = rows.reduce((s, r) => s + r.contributedCents, 0)
  const pot = Math.max(0, availableCents)
  if (total === 0 || pot === 0) return rows
  for (const r of rows) r.shareCents = Math.floor((pot * r.contributedCents) / total)
  if (settleAll) {
    let left = pot - rows.reduce((s, r) => s + r.shareCents, 0)
    for (const r of [...rows].sort((a, b) => b.contributedCents - a.contributedCents)) {
      if (left <= 0) break
      if (r.contributedCents > 0) {
        r.shareCents += 1
        left -= 1
      }
    }
  }
  return rows
}
