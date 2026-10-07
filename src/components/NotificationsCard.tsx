'use client'

import { useEffect, useRef, useState } from 'react'
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
  REQUEST_WONT_PASS: { Icon: X, tone: 'bg-red-soft text-red' },
  REQUEST_REJECTED: { Icon: X, tone: 'bg-red-soft text-red' },
  RULE_CHANGE_PROPOSED: { Icon: Scale, tone: 'bg-violet-soft text-violet' },
  RULES_CHANGED: { Icon: Scale, tone: 'bg-violet-soft text-violet' },
  GOAL_CREATED: { Icon: Target, tone: 'bg-teal-soft text-teal' },
  UNAPPROVED_MOVEMENT: { Icon: AlertTriangle, tone: 'bg-red-soft text-red' },
}

const SHOW = 6

/**
 * A small pill: "3 new updates since you were last here". Opening it counts as
 * viewing them; once closed, the pill is gone (and stays gone next visit). The
 * ledger and activity log keep the full history.
 */
export function NotificationsCard({ collectiveId, items, headSeq }: { collectiveId: string; items: MemberNotification[]; headSeq: number }) {
  const [open, setOpen] = useState(false)
  const [seen, setSeen] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && close()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  })

  function openList() {
    setOpen(true)
    void markNotificationsSeen(collectiveId, headSeq)
  }
  function close() {
    setOpen(false)
    setSeen(true)
  }

  if (items.length === 0 || (seen && !open)) return null
  const shown = expanded ? items : items.slice(0, SHOW)

  return (
    <div ref={ref} className="relative w-fit">
      <button
        onClick={() => (open ? close() : openList())}
        className="inline-flex items-center gap-2 rounded-full border border-dashed border-amber/60 bg-amber-soft/60 px-3 py-1 text-sm font-medium text-amber transition hover:bg-amber-soft"
      >
        <Bell size={13} />
        {items.length} new update{items.length === 1 ? '' : 's'} since you were last here
      </button>

      {open && (
        <div className="card absolute left-0 top-full z-30 mt-2 w-[min(26rem,calc(100vw-2rem))] overflow-hidden shadow-[0_12px_40px_rgba(0,0,0,0.12)]">
          <ul className="max-h-80 divide-y divide-line overflow-y-auto">
            {shown.map((n) => {
              const look = LOOK[n.action] ?? { Icon: Bell, tone: 'bg-bg text-muted' }
              return (
                <li key={n.seq} className="flex items-start gap-3 px-4 py-2.5">
                  <span className={`mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${look.tone}`}>
                    <look.Icon size={12} />
                  </span>
                  <div className="min-w-0 flex-1 text-sm">
                    <span className="font-medium">{n.actor}</span> {n.summary}
                    <div className="text-xs text-faint">
                      {new Date(n.createdAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
          <div className="flex items-center justify-between gap-3 border-t border-line bg-bg/60 px-4 py-2 text-xs">
            {items.length > SHOW && !expanded ? (
              <button className="text-muted hover:text-ink" onClick={() => setExpanded(true)}>
                Show {items.length - SHOW} more
              </button>
            ) : (
              <span className="text-muted">Marked as seen</span>
            )}
            <span className="flex gap-3">
              <a href="#ledger" onClick={close} className="font-medium text-ink hover:underline">
                Ledger
              </a>
              <a href="#activity" onClick={close} className="font-medium text-ink hover:underline">
                Activity log
              </a>
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
