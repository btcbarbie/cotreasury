'use client'

import { Landmark, Sparkles } from 'lucide-react'
import { Avatar } from './ui'

export type ActivityEvent = { id: string; seq: number; actor: string; action: string; summary: string; createdAt: string; hash: string }


/**
 * Plain-language version of an event, for display only: the sealed text is
 * never changed (the integrity check depends on it).
 */
function readable(e: ActivityEvent) {
  const text = e.summary.replace(/\s*\(imported record\)/g, '').replace(/\$([\d,]+)\.00\b/g, '$$$1')
  if (e.action === 'CONTRIBUTION_IMPORTED') {
    const m = text.match(/^paid (\$[\d,.]+)(?: \((.+)\))?$/)
    if (m) return `paid ${m[1]} to the treasury${m[2] && m[2] !== 'Member contribution' ? ` · ${m[2]}` : ''}`
  }
  if (e.action === 'PAYOUT_IMPORTED') {
    const m = text.match(/^paid out (\$[\d,.]+) to (.+?): (.+)$/)
    if (m) return `paid ${m[1]} from the treasury to ${m[2]} for ${m[3]}`
  }
  if (e.action === 'UNAPPROVED_MOVEMENT') {
    const m = text.match(/^found (\$[\d,.]+) (leaving|coming into) the group's PayPal account that wasn't made through CoTreasury(?: \((.+)\))?/)
    if (m) {
      const [, amount, way, detail = ''] = m
      const [what, ...rest] = detail.split(', ')
      const who = rest.join(', ')
      const bank = who ? who.replace(/^Bank account/, 'a bank account') : 'a bank account'
      if (/withdrawal/i.test(what)) return `${amount} was withdrawn to ${bank} outside CoTreasury. Nobody approved it.`
      if (/deposit/i.test(what)) return `${amount} was deposited from ${bank} outside CoTreasury.`
      return way === 'leaving'
        ? `${amount} left the PayPal account outside CoTreasury${who ? `, sent to ${who}` : ''}. Nobody approved it.`
        : `${amount} came into the PayPal account outside CoTreasury${who ? ` from ${who}` : ''}.`
    }
  }
  if (e.action === 'OPENING_BALANCE_IMPORTED') {
    const m = text.match(/opening balance of (\$[\d,.]+)/)
    if (m) return `carried over an opening balance of ${m[1]}`
  }
  return text
}

function ActorMark({ actor }: { actor: string }) {
  if (actor === 'PayPal')
    return <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-soft text-[10px] font-bold text-blue">PP</span>
  if (actor === 'CoTreasury')
    return (
      <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent">
        <Landmark size={13} />
      </span>
    )
  if (actor === 'AI Treasurer')
    return (
      <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-violet-soft text-violet">
        <Sparkles size={13} />
      </span>
    )
  return <Avatar name={actor} size={28} />
}

export function ActivityPanel({ events }: { events: ActivityEvent[] }) {

  return (
    <div className="grid gap-4">
      <div className="card divide-y divide-line">
        {events.length === 0 && <div className="px-5 py-10 text-center text-sm text-muted">No activity yet.</div>}
        {events.map((e) => (
          <div key={e.id} className="flex items-start gap-3 px-4 py-3">
            <ActorMark actor={e.actor} />
            <div className="min-w-0 flex-1">
              <div className="text-sm">
                {/* Outside movements read as a standalone sentence, without the "CoTreasury" actor in front. */}
                {e.action !== 'UNAPPROVED_MOVEMENT' && <span className="font-medium">{e.actor} </span>}
                {readable(e)}
              </div>
              <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-faint">
                <span>
                  {new Date(e.createdAt).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}
                </span>
                <span className="font-mono" title={`Seal ${e.hash}`}>
                  #{e.seq}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
