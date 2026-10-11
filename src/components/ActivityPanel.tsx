'use client'

import { useState, useTransition } from 'react'
import { Landmark, Loader2, ShieldAlert, ShieldCheck, Sparkles } from 'lucide-react'
import { checkIntegrity } from '@/app/c/[id]/actions'
import { Avatar } from './ui'

export type ActivityEvent = { id: string; seq: number; actor: string; action: string; summary: string; createdAt: string; hash: string }

type Check = Awaited<ReturnType<typeof checkIntegrity>>

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
  if (e.action === 'PANEL_DRAWN') {
    const m = text.match(/^drew a hidden review panel of (\d+) for (".+?")/)
    if (m) return `picked ${m[1]} reviewer${m[1] === '1' ? '' : 's'} at random for ${m[2]}. Their names stay hidden until the vote is over.`
  }
  if (e.action === 'PANEL_REVEALED') {
    const m = text.match(/^revealed the review panel for (".+?"): (.+?) \(seed [0-9a-f]+\)$/)
    if (m) return `revealed who reviewed ${m[1]}: ${m[2]}.`
  }
  if (e.action === 'REQUEST_CREATED') {
    const m = text.match(/^(requested|asked for a refund of) (\$[\d,.]+) for (".+?") \(needs (\d+) approvals?( from a hidden review panel)?\)$/)
    if (m) return `${m[1]} ${m[2]} for ${m[3]}. It needs ${m[4]} approval${m[4] === '1' ? '' : 's'}${m[5] ? ' from the hidden panel' : ''}.`
  }
  if (e.action === 'VOTE_APPROVE' || e.action === 'VOTE_REJECT') {
    const m = text.match(/^(approved|rejected) (".+?") \((\d+) of (\d+)\)$/)
    if (m) return `${m[1]} ${m[2]}: ${m[3]} of ${m[4]} approvals so far.`
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

export function ActivityPanel({ collectiveId, events }: { collectiveId: string; events: ActivityEvent[] }) {
  const [result, setResult] = useState<Check | null>(null)
  const [pending, start] = useTransition()

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-end gap-3">
        <button
          className="btn btn-ghost !h-8"
          onClick={() => start(async () => setResult(await checkIntegrity(collectiveId)))}
          disabled={pending}
          title="Confirms no past event was edited or deleted"
        >
          {pending ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />} Check integrity
        </button>
        {result &&
          (result.ok ? (
            <div className="flex w-full items-center gap-2 rounded-lg bg-accent-soft px-3 py-2 text-sm text-accent">
              <ShieldCheck size={16} /> All {result.count} events are intact. Latest seal <span className="font-mono text-xs">{result.head?.slice(0, 16)}</span>
            </div>
          ) : (
            <div className="flex w-full items-center gap-2 rounded-lg bg-red-soft px-3 py-2 text-sm text-red">
              <ShieldAlert size={16} /> History was altered: {result.reason}
            </div>
          ))}
      </div>

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
