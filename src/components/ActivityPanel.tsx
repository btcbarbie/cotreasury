'use client'

import { useState, useTransition } from 'react'
import { Landmark, Loader2, ShieldAlert, ShieldCheck, Sparkles } from 'lucide-react'
import { checkIntegrity } from '@/app/c/[id]/actions'
import { Avatar } from './ui'

export type ActivityEvent = { id: string; seq: number; actor: string; action: string; summary: string; createdAt: string; hash: string }

type Check = Awaited<ReturnType<typeof checkIntegrity>>

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
      <div className="card flex flex-wrap items-center justify-between gap-4 p-5">
        <div className="max-w-xl">
          <div className="font-medium">Every action, sealed in order</div>
          <p className="mt-1 text-sm text-muted">
            Each event is fingerprinted together with the one before it. If anyone edits or deletes past history, the integrity check fails, including for the people who run CoTreasury.
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => start(async () => setResult(await checkIntegrity(collectiveId)))} disabled={pending}>
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
                {/* Display only: the sealed text keeps "(imported record)"; the demo context already says it. */}
                <span className="font-medium">{e.actor}</span> {e.summary.replace(/\s*\(imported record\)/g, '')}
              </div>
              <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-faint">
                <span>
                  {new Date(e.createdAt).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}
                </span>
                <span className="font-mono">
                  #{e.seq} · seal {e.hash.slice(0, 12)}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
