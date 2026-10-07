// Goal progress, computed from confirmed ledger entries only. Like the rest of
// the treasury math this is deterministic; the AI only reads the result.

type Goal = { id: string; title: string; kind: string; perMemberCents: number; dueDate: Date | null; startMonth: Date | null }
type Member = { id: string; name: string }
type Entry = { goalId: string | null; memberId: string | null; amountCents: number; status: string; type: string }

export type GoalProgress = {
  id: string
  title: string
  kind: 'TARGET' | 'MONTHLY'
  perMemberCents: number
  dueDate: string | null
  daysLeft: number | null // relative to when the page was rendered on the server
  monthsDue: number
  expectedPerMemberCents: number
  targetCents: number
  collectedCents: number
  pendingCents: number
  members: { id: string; name: string; paidCents: number; upToDate: boolean }[]
  upToDateCount: number
}

function monthsBetween(start: Date, now: Date) {
  return Math.max(1, (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth()) + 1)
}

export function goalProgress(goals: Goal[], members: Member[], entries: Entry[], now = new Date()): GoalProgress[] {
  return goals.map((g) => {
    const kind = g.kind === 'MONTHLY' ? 'MONTHLY' : 'TARGET'
    const monthsDue = kind === 'MONTHLY' && g.startMonth ? monthsBetween(g.startMonth, now) : 1
    const expectedPerMember = g.perMemberCents * monthsDue
    const forGoal = entries.filter((e) => e.goalId === g.id && e.type === 'CONTRIBUTION')
    const paid = new Map<string, number>()
    let collected = 0
    let pending = 0
    for (const e of forGoal) {
      if (e.status === 'CONFIRMED') {
        collected += e.amountCents
        if (e.memberId) paid.set(e.memberId, (paid.get(e.memberId) ?? 0) + e.amountCents)
      } else if (e.status === 'PENDING') pending += e.amountCents
    }
    const rows = members.map((m) => {
      const p = paid.get(m.id) ?? 0
      return { id: m.id, name: m.name, paidCents: p, upToDate: p >= expectedPerMember }
    })
    return {
      id: g.id,
      title: g.title,
      kind,
      perMemberCents: g.perMemberCents,
      dueDate: g.dueDate?.toISOString() ?? null,
      daysLeft: g.dueDate ? Math.ceil((g.dueDate.getTime() - now.getTime()) / 86_400_000) : null,
      monthsDue,
      expectedPerMemberCents: expectedPerMember,
      targetCents: expectedPerMember * members.length,
      collectedCents: collected,
      pendingCents: pending,
      members: rows,
      upToDateCount: rows.filter((r) => r.upToDate).length,
    }
  })
}
