'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle, ArrowDownLeft, Bell, Check, FileText, Scale, Send, Target, X } from 'lucide-react'
import { markNotificationsSeen } from '@/app/c/[id]/actions'
import type { MemberNotification } from '@/lib/notifications'

const LOOK: Record<string, { Icon: typeof Bell; tone: string }> = {
  CONTRIBUTION_CONFIRMED: { Icon: ArrowDownLeft, tone: 'bg-accent-soft text-accent' },
  CONTRIBUTION_DECLINED: { Icon: AlertTriangle, tone: 'bg-red-soft text-red' },
  PAYOUT_SENT: { Icon: Send, tone: 'bg-blue-soft text-blue' },
  PAYOUT_SUCCEEDED: { Icon: Send, tone: 'bg-accent-soft text-accent' },
  PAYOUT_UNCLAIMED: { Icon: Send, tone: 'bg-amber-soft text-amber' },
  PAYOUT_FAILED: { Icon: AlertTriangle, tone: 'bg-red-soft text-red' },
  PAYOUT_RETURNED: { Icon: AlertTriangle, tone: 'bg-red-soft text-red' },
  REQUEST_CREATED: { Icon: FileText, tone: 'bg-amber-soft text-amber' },
  REQUEST_APPROVED: { Icon: Check, tone: 'bg-accent-soft text-accent' },
  REQUEST_REJECTED: { Icon: X, tone: 'bg-red-soft text-red' },
  RULE_CHANGE_PROPOSED: { Icon: Scale, tone: 'bg-violet-soft text-violet' },
  RULES_CHANGED: { Icon: Scale, tone: 'bg-violet-soft text-violet' },
  GOAL_CREATED: { Icon: Target, tone: 'bg-teal-soft text-teal' },
  UNAPPROVED_MOVEMENT: { Icon: AlertTriangle, tone: 'bg-red-soft text-red' },
}

const SHOW = 6

/**
 * "Since you were last here": significant events this member hasn't seen.
 * Seeing the card counts as viewing them, so they won't appear next visit;
 * the ledger and activity log keep the full history.
 */
export function NotificationsCard({ collectiveId, items, headSeq }: { collectiveId: string; items: MemberNotification[]; headSeq: number }) {
  const [hidden, setHidden] = useState(false)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    if (items.length === 0) return
    const t = setTimeout(() => void markNotificationsSeen(collectiveId, headSeq), 1500)
    return () => clearTimeout(t)
  }, [collectiveId, headSeq, items.length])

  if (hidden || items.length === 0) return null
  const shown = expanded ? items : items.slice(0, SHOW)

  return (
    <section className="card mt-6 overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
        <div className="flex items-center gap-2 font-semibold tracking-tight">
          <span className="relative inline-flex h-7 w-7 items-center justify-center rounded-lg bg-ink text-white">
            <Bell size={14} />
            <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-red ring-2 ring-white" />
          </span>
          Since you were last here
          <span className="tabular text-sm font-normal text-muted">{items.length}</span>
        </div>
        <button
          onClick={() => {
            setHidden(true)
            void markNotificationsSeen(collectiveId, headSeq)
          }}
          className="text-muted hover:text-ink"
          aria-label="Dismiss"
        >
          <X size={18} />
        </button>
      </div>
      <ul className="divide-y divide-line">
        {shown.map((n) => {
          const look = LOOK[n.action] ?? { Icon: Bell, tone: 'bg-bg text-muted' }
          return (
            <li key={n.seq} className="flex items-start gap-3 px-5 py-3">
              <span className={`mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${look.tone}`}>
                <look.Icon size={14} />
              </span>
              <div className="min-w-0 flex-1 text-sm">
                <span className="font-medium">{n.actor}</span> {n.summary}
                <div className="mt-0.5 text-xs text-faint">
                  {new Date(n.createdAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                </div>
              </div>
            </li>
          )
        })}
      </ul>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-bg/50 px-5 py-2.5 text-sm">
        {items.length > SHOW && !expanded ? (
          <button className="text-muted hover:text-ink" onClick={() => setExpanded(true)}>
            Show {items.length - SHOW} more
          </button>
        ) : (
          <span className="text-xs text-muted">These clear once you&apos;ve seen them.</span>
        )}
        <span className="flex gap-4">
          <a href="#ledger" className="font-medium text-ink hover:underline">
            Open ledger
          </a>
          <a href="#activity" className="font-medium text-ink hover:underline">
            Open activity log
          </a>
        </span>
      </div>
    </section>
  )
}
