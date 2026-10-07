'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { Avatar, RoleBadge } from './ui'
import { switchViewer } from '@/app/c/[id]/actions'

type Member = { id: string; name: string; role: string }

export function ViewerSwitcher({
  collectiveId,
  viewerId,
  members,
}: {
  collectiveId: string
  viewerId: string
  members: Member[]
}) {
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const ref = useRef<HTMLDivElement>(null)
  const viewer = members.find((m) => m.id === viewerId) ?? members[0]

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  function choose(id: string) {
    setOpen(false)
    if (id === viewerId) return
    startTransition(() => switchViewer(collectiveId, id))
  }

  // Officers first, then members, so approvers are easy to find in the demo.
  const order = { ADMIN: 0, APPROVER: 1, MEMBER: 2 } as Record<string, number>
  const sorted = [...members].sort((a, b) => order[a.role] - order[b.role])

  return (
    <div ref={ref} className="relative shrink-0">
      <div className="label mb-1.5 sm:text-right">Viewing as</div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`card flex w-full sm:w-auto items-center gap-2.5 py-2 pl-2 pr-3 text-left transition hover:border-line-strong ${pending ? 'opacity-60' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <Avatar name={viewer.name} />
        <div className="min-w-0">
          <div className="whitespace-nowrap text-sm font-medium leading-tight">{viewer.name}</div>
          <div className="mt-0.5">
            <RoleBadge role={viewer.role} />
          </div>
        </div>
        <ChevronDown size={15} className="ml-auto sm:ml-3 text-muted" />
      </button>

      {open && (
        <div
          role="listbox"
          className="card absolute right-0 z-30 mt-2 max-h-80 w-full sm:w-72 overflow-auto p-1.5 shadow-[0_8px_30px_rgba(0,0,0,0.08)]"
        >
          {sorted.map((m) => (
            <button
              key={m.id}
              role="option"
              aria-selected={m.id === viewerId}
              onClick={() => choose(m.id)}
              className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-bg"
            >
              <Avatar name={m.name} size={26} />
              <span className="flex-1 truncate text-sm">{m.name}</span>
              <RoleBadge role={m.role} />
              <Check size={14} className={m.id === viewerId ? 'text-ink' : 'invisible'} />
            </button>
          ))}
          <div className="mt-1 border-t border-line px-2 pt-2 pb-1 text-xs text-faint">
            Demo mode: switch members to try approvals.
          </div>
        </div>
      )}
    </div>
  )
}
