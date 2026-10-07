'use client'

import { useSyncExternalStore, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

// Notify React once right after hydration so it re-reads the snapshot on the
// client (the server snapshot is null because there is no document there).
const subscribeOnce = (onChange: () => void) => {
  const t = setTimeout(onChange)
  return () => clearTimeout(t)
}

/** Renders page-specific controls (e.g. "Viewing as") into the site header. */
export function HeaderSlot({ children }: { children: ReactNode }) {
  const target = useSyncExternalStore(
    subscribeOnce,
    () => document.getElementById('header-slot'),
    () => null,
  )
  return target ? createPortal(children, target) : null
}
