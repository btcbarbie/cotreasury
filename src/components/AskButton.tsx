'use client'

import { useEffect, useState } from 'react'
import { Sparkles } from 'lucide-react'
import { TreasurerPanel } from './TreasurerPanel'

/**
 * The single way into the AI: a floating Ask button, bottom right. The chat
 * stays mounted while closed so a conversation survives closing and reopening.
 */
export function AskButton(props: { collectiveId: string; kind: string; currency: string; brief: string }) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <>
      <div
        className={`fixed right-4 bottom-4 z-40 h-[min(34rem,calc(100dvh-6rem))] w-[min(25rem,calc(100vw-2rem))] sm:right-6 sm:bottom-6 ${open ? '' : 'hidden'}`}
        role="dialog"
        aria-label="AI Treasurer"
      >
        <TreasurerPanel {...props} onClose={() => setOpen(false)} />
      </div>
      {/* While the chat is open it has its own close button, so the Ask button steps aside. */}
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="fixed right-4 bottom-4 z-40 inline-flex h-12 items-center gap-2 rounded-full bg-ink px-5 font-medium text-white shadow-[0_8px_28px_rgba(0,0,0,0.25)] transition hover:bg-ink/90 sm:right-6 sm:bottom-6"
        >
          <Sparkles size={17} className="text-violet-soft" /> Ask
        </button>
      )}
    </>
  )
}
