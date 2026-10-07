'use client'

import { AlertTriangle, CalendarClock, CheckCircle2, Clock, Hourglass, Scale, Send, UserCheck } from 'lucide-react'
import { formatMoney } from '@/lib/money'
import type { GoalProgress } from '@/lib/goals'

type Proposal = {
  id: string
  kind: string
  title: string
  amountCents: number
  requiredApprovals: number
  status: string
  proposedById: string | null
  approvals: { memberId: string; decision: string }[]
  recipients: { name: string; receiver: string; amountCents: number; status: string }[]
  failureReason: string | null
}
type Entry = { id: string; type: string; status: string; amountCents: number; counterparty: string | null; createdAt: string }

export type AttentionItem = { key: string; group: string; tone: string; Icon: typeof Clock; title: string; detail: string; action?: 'requests' }

/** Everything in the treasury that is waiting on a person (or on PayPal), with the reason. */
export function attentionItems(p: { proposals: Proposal[]; entries: Entry[]; goals: GoalProgress[]; viewerId: string; viewerRole: string; currency: string }): AttentionItem[] {
  const m = (c: number) => formatMoney(c, p.currency)
  const isApprover = p.viewerRole === 'APPROVER' || p.viewerRole === 'ADMIN'
  const items: AttentionItem[] = []

  for (const x of p.proposals) {
    const yes = x.approvals.filter((a) => a.decision === 'APPROVE').length
    const label = x.kind === 'RULE_CHANGE' ? 'Rule change' : `${x.title} · ${m(x.amountCents)}`
    if (x.status === 'PENDING_APPROVAL') {
      const mine = isApprover && x.proposedById !== p.viewerId && !x.approvals.some((a) => a.memberId === p.viewerId)
      items.push({
        key: `p-${x.id}`,
        group: mine ? 'Waiting for you' : 'Waiting for approvers',
        tone: mine ? 'text-amber bg-amber-soft' : 'text-muted bg-bg',
        Icon: x.kind === 'RULE_CHANGE' ? Scale : mine ? UserCheck : Hourglass,
        title: label,
        detail: mine
          ? `Your sign-off is needed. ${yes} of ${x.requiredApprovals} approvals so far.`
          : `Needs ${x.requiredApprovals - yes} more approval${x.requiredApprovals - yes === 1 ? '' : 's'}${x.proposedById === p.viewerId ? '. You created it, so others must approve.' : '.'}`,
        action: 'requests',
      })
    }
    if (x.status === 'EXECUTING') {
      items.push({ key: `e-${x.id}`, group: 'Money moving', tone: 'text-blue bg-blue-soft', Icon: Send, title: label, detail: 'PayPal is sending this payout. Each recipient updates when PayPal confirms.', action: 'requests' })
    }
    if (x.status === 'FAILED') {
      items.push({ key: `f-${x.id}`, group: 'Problems', tone: 'text-red bg-red-soft', Icon: AlertTriangle, title: label, detail: x.failureReason ?? 'The payout failed.', action: 'requests' })
    }
    for (const r of x.recipients) {
      if (r.status === 'UNCLAIMED') {
        items.push({
          key: `u-${x.id}-${r.receiver}`,
          group: 'Money moving',
          tone: 'text-amber bg-amber-soft',
          Icon: Clock,
          title: `${r.name} hasn't claimed ${m(r.amountCents)}`,
          detail: `PayPal sent it to ${r.receiver}. Ask them to log in or sign up with that email to claim it; unclaimed money returns after 30 days.`,
        })
      }
    }
  }

  for (const e of p.entries) {
    if (e.type === 'CONTRIBUTION' && e.status === 'PENDING') {
      items.push({ key: `c-${e.id}`, group: 'Money moving', tone: 'text-blue bg-blue-soft', Icon: Hourglass, title: `${m(e.amountCents)} from ${e.counterparty ?? 'a member'}`, detail: 'Paid in PayPal, waiting for PayPal to confirm before it counts.' })
    }
  }

  for (const g of p.goals) {
    if (g.daysLeft === null) continue
    const days = g.daysLeft
    const unpaid = g.members.filter((x) => !x.upToDate)
    if (unpaid.length === 0 || days > 14) continue
    items.push({
      key: `g-${g.id}`,
      group: days < 0 ? 'Problems' : 'Coming up',
      tone: days < 0 ? 'text-red bg-red-soft' : 'text-amber bg-amber-soft',
      Icon: CalendarClock,
      title: `${g.title}: ${unpaid.length} member${unpaid.length === 1 ? '' : 's'} still to pay`,
      detail: `${days < 0 ? `Overdue by ${-days} day${days === -1 ? '' : 's'}` : `Due in ${days} day${days === 1 ? '' : 's'}`}. Not yet paid in full: ${unpaid.map((x) => x.name.split(' ')[0]).join(', ')}.`,
    })
  }
  return items
}

const ORDER = ['Waiting for you', 'Problems', 'Money moving', 'Coming up', 'Waiting for approvers']

export function AttentionPanel({ items, onOpenRequests }: { items: AttentionItem[]; onOpenRequests: () => void }) {
  if (items.length === 0) {
    return (
      <div className="card flex flex-col items-center px-6 py-14 text-center">
        <CheckCircle2 size={28} className="text-accent" />
        <div className="mt-3 font-medium">Nothing needs attention</div>
        <p className="mt-1 max-w-sm text-sm text-muted">Every request is decided, every payment is confirmed by PayPal, and no goal is close to its deadline with members still to pay.</p>
      </div>
    )
  }
  const groups = ORDER.map((g) => ({ g, list: items.filter((i) => i.group === g) })).filter((x) => x.list.length > 0)
  return (
    <div className="grid gap-5">
      {groups.map(({ g, list }) => (
        <section key={g}>
          <div className="label mb-2">
            {g} · {list.length}
          </div>
          <div className="card divide-y divide-line">
            {list.map((i) => (
              <div key={i.key} className="flex items-start gap-3 px-4 py-3.5">
                <span className={`mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${i.tone}`}>
                  <i.Icon size={15} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{i.title}</div>
                  <div className="mt-0.5 text-sm text-muted">{i.detail}</div>
                </div>
                {i.action === 'requests' && (
                  <button className="btn btn-ghost !h-8 shrink-0" onClick={onOpenRequests}>
                    Open
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
