'use client'

import { useEffect, useState } from 'react'
import { Send } from 'lucide-react'
import { NewRequestForm } from './NewRequestForm'

/** Header action: open the payment request form in a dialog from any tab. */
export function RequestPaymentButton({ collectiveId, currency }: { collectiveId: string; currency: string }) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <>
      <button className="btn btn-ghost" onClick={() => setOpen(true)}>
        <Send size={14} /> Request payout
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-ink/30 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
          <div className="w-full sm:max-w-2xl [&>.card]:rounded-b-none sm:[&>.card]:rounded-b-[14px] [&>.card]:shadow-[0_20px_60px_rgba(0,0,0,0.15)]">
            <NewRequestForm collectiveId={collectiveId} currency={currency} onClose={() => setOpen(false)} />
          </div>
        </div>
      )}
    </>
  )
}
