'use client'

import { useState, useTransition } from 'react'
import { Loader2 } from 'lucide-react'
import { joinTreasury } from '@/app/join/actions'

export function JoinForm({ code }: { code: string }) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  function join(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    start(async () => {
      const r = await joinTreasury(code, { name, email })
      if (r && !r.ok) setError(r.error)
    })
  }

  return (
    <form onSubmit={join} className="mt-5 grid gap-2">
      <input className="input" placeholder="Your name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
      <input className="input" placeholder="Your email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      {error && <div className="rounded-lg bg-red-soft px-3 py-2 text-sm text-red">{error}</div>}
      <button className="btn btn-primary mt-1" disabled={pending}>
        {pending && <Loader2 size={14} className="animate-spin" />} Join the treasury
      </button>
      <p className="text-xs text-muted">You join as a member. To become an approver, the group votes on a rule change.</p>
    </form>
  )
}
