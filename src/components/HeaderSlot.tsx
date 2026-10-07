'use client'

import { useSyncExternalStore, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

const noop = () => () => {}

/** Renders page-specific controls (e.g. "Viewing as") into the site header. */
export function HeaderSlot({ children }: { children: ReactNode }) {
  const target = useSyncExternalStore(
    noop,
    () => document.getElementById('header-slot'),
    () => null,
  )
  return target ? createPortal(children, target) : null
}
