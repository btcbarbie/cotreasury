'use client'

import { AlertTriangle, CheckCircle2, Clock, Hourglass, Scale, Send, UserCheck } from 'lucide-react'
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
        group: 'Needs approval',
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
      items.push({ key: `e-${x.id}`, group: 'Being paid out', tone: 'text-blue bg-blue-soft', Icon: Send, title: label, detail: 'PayPal is sending this payout. Each recipient updates when PayPal confirms.', action: 'requests' })
    }
    if (x.status === 'FAILED') {
      items.push({ key: `f-${x.id}`, group: 'Problems', tone: 'text-red bg-red-soft', Icon: AlertTriangle, title: label, detail: x.failureReason ?? 'The payout failed.', action: 'requests' })
    }
    for (const r of x.recipients) {
      if (r.status === 'RETURNED') {
        items.push({
          key: `r-${x.id}-${r.receiver}`,
          group: 'Problems',
          tone: 'text-red bg-red-soft',
          Icon: AlertTriangle,
          title: `${m(r.amountCents)} to ${r.name} came back`,
          detail: `PayPal returned the payout to ${r.receiver}. Check the email and raise a new request.`,
        })
      }
      if (r.status === 'UNCLAIMED') {
        items.push({
          key: `u-${x.id}-${r.receiver}`,
          group: 'Problems',
          tone: 'text-amber bg-amber-soft',
          Icon: Clock,
          title: `${r.name} hasn't claimed ${m(r.amountCents)}`,
          detail: `PayPal sent it to ${r.receiver}. Ask them to log in or sign up with that email to claim it; unclaimed money returns after 30 days.`,
        })
      }
    }
  }

  return items
}

const ORDER = ['Needs approval', 'Being paid out', 'Problems']

export function AttentionPanel({ items, onOpenRequests }: { items: AttentionItem[]; onOpenRequests: () => void }) {
  if (items.length === 0) {
    return (
      <div className="card flex flex-col items-center px-6 py-14 text-center">
        <CheckCircle2 size={28} className="text-accent" />
        <div className="mt-3 font-medium">Nothing needs attention</div>
        <p className="mt-1 max-w-sm text-sm text-muted">No payouts are waiting for approval, being sent, or stuck.</p>
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
