'use client'

import { useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'

/** Small chevron button used to minimise/expand a card or section. */
export function MinimizeButton({ open, onToggle, label }: { open: boolean; onToggle: () => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-label={`${open ? 'Minimise' : 'Expand'}${label ? ` ${label}` : ''}`}
      title={open ? 'Minimise' : 'Expand'}
      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted transition hover:bg-bg hover:text-ink"
    >
      <ChevronDown size={16} className={`transition-transform ${open ? '' : '-rotate-90'}`} />
    </button>
  )
}

/** A titled section whose body can be minimised. */
export function CollapsibleSection({
  title,
  count,
  actions,
  defaultOpen = true,
  muted = false,
  children,
}: {
  title: ReactNode
  count?: number
  actions?: ReactNode
  defaultOpen?: boolean
  /** Small grey heading, for sections people rarely need. */
  muted?: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className={`flex items-center gap-1.5 text-left tracking-tight ${muted ? 'text-sm text-muted hover:text-ink' : 'font-semibold'}`}
        >
          <ChevronDown size={16} className={`text-muted transition-transform ${open ? '' : '-rotate-90'}`} />
          {title}
          {count != null && <span className="tabular text-sm font-normal text-muted">{count}</span>}
        </button>
        {open && actions}
      </div>
      {open && children}
    </section>
  )
}
