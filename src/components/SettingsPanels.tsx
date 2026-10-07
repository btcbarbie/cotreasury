'use client'

import { useState, useSyncExternalStore, useTransition } from 'react'
import { Check, Copy, Link2, Loader2, Pencil, Plus, RotateCcw, UserPlus, X } from 'lucide-react'
import { addMember, setInviteLink, updateTreasuryDetails } from '@/app/c/[id]/actions'

/** Name and purpose: the admin edits directly; the change is sealed in the activity log. */
export function TreasuryDetailsCard({ collectiveId, name, purpose, isAdmin }: { collectiveId: string; name: string; purpose: string; isAdmin: boolean }) {
  const [editing, setEditing] = useState(false)
  const [n, setN] = useState(name)
  const [p, setP] = useState(purpose)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  function save() {
    setError(null)
    start(async () => {
      const r = await updateTreasuryDetails(collectiveId, { name: n, purpose: p })
      if (!r.ok) return setError(r.error)
      setEditing(false)
    })
  }

  return (
    <div className="card p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-medium">Treasury details</div>
          <p className="mt-1 text-sm text-muted">{isAdmin ? 'Only the admin can edit these. Every change is logged.' : 'Only the admin can edit these.'}</p>
        </div>
        {isAdmin && !editing && (
          <button className="btn btn-ghost !h-8" onClick={() => setEditing(true)}>
            <Pencil size={13} /> Edit
          </button>
        )}
      </div>
      {editing ? (
        <div className="mt-4 grid gap-3">
          <label className="block">
            <span className="label">Name</span>
            <input className="input mt-1.5" value={n} maxLength={80} onChange={(e) => setN(e.target.value)} />
          </label>
          <label className="block">
            <span className="label">Shared purpose</span>
            <textarea className="input mt-1.5 !h-24 resize-none py-2.5 leading-relaxed" value={p} maxLength={400} onChange={(e) => setP(e.target.value)} />
          </label>
          {error && <div className="rounded-lg bg-red-soft px-3 py-2 text-sm text-red">{error}</div>}
          <div className="flex justify-end gap-2">
            <button className="btn btn-ghost" onClick={() => (setEditing(false), setN(name), setP(purpose))} disabled={pending}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={save} disabled={pending}>
              {pending && <Loader2 size={14} className="animate-spin" />} Save
            </button>
          </div>
        </div>
      ) : (
        <dl className="mt-4 grid gap-3 text-sm">
          <div>
            <dt className="label">Name</dt>
            <dd className="mt-1">{name}</dd>
          </div>
          <div>
            <dt className="label">Shared purpose</dt>
            <dd className="mt-1 text-ink/80">{purpose}</dd>
          </div>
        </dl>
      )}
    </div>
  )
}

/** Add a member. New members join as contributors; approver roles change through governed rule changes. */
export function AddMemberButton({ collectiveId }: { collectiveId: string }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  function save() {
    setError(null)
    start(async () => {
      const r = await addMember(collectiveId, { name, email })
      if (!r.ok) return setError(r.error)
      setName('')
      setEmail('')
      setOpen(false)
    })
  }

  if (!open) {
    return (
      <button className="btn btn-ghost !h-8" onClick={() => setOpen(true)}>
        <UserPlus size={14} /> Add member
      </button>
    )
  }
  return (
    <div className="card w-full p-4">
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium">Add a member</div>
        <button onClick={() => setOpen(false)} className="text-muted hover:text-ink" aria-label="Close">
          <X size={16} />
        </button>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_1.3fr_auto]">
        <input className="input" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
        <input className="input" placeholder="email@example.com" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <button className="btn btn-primary" onClick={save} disabled={pending}>
          {pending ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Add
        </button>
      </div>
      <p className="mt-2 text-xs text-muted">They join as a member who can contribute and see everything. To make them an approver, propose a rule change.</p>
      {error && <div className="mt-2 rounded-lg bg-red-soft px-3 py-2 text-sm text-red">{error}</div>}
    </div>
  )
}

const noopSubscribe = () => () => {}

/** Admin: a shareable link anyone can use to join as a member. */
export function InviteLinkCard({ collectiveId, code }: { collectiveId: string; code: string | null }) {
  const [pending, start] = useTransition()
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // The site's own address, read after hydration so server and client render the same.
  const origin = useSyncExternalStore(noopSubscribe, () => window.location.origin, () => '')
  const url = code ? `${origin}/join/${code}` : ''

  function set(on: boolean) {
    setError(null)
    start(async () => {
      const r = await setInviteLink(collectiveId, on)
      if (!r.ok) setError(r.error)
    })
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setError('Couldn’t copy. Select the link and copy it manually.')
    }
  }

  return (
    <div className="card mb-4 p-4">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Link2 size={15} className="text-muted" /> Invite link
      </div>
      {code ? (
        <>
          <div className="mt-3 flex gap-2">
            <input className="input min-w-0 flex-1 font-mono !text-xs" readOnly value={url} onFocus={(e) => e.target.select()} aria-label="Invite link" />
            <button className="btn btn-primary !h-10" onClick={copy}>
              {copied ? <Check size={14} strokeWidth={3} /> : <Copy size={14} />} {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted">Anyone with this link can join as a member. Share it in your group chat or email.</p>
            <div className="flex gap-3 text-xs">
              <button className="inline-flex items-center gap-1 text-muted hover:text-ink" onClick={() => set(true)} disabled={pending}>
                <RotateCcw size={12} /> Reset link
              </button>
              <button className="text-muted hover:text-red" onClick={() => set(false)} disabled={pending}>
                Turn off
              </button>
            </div>
          </div>
        </>
      ) : (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-muted">Create a link to share in your group chat. Whoever opens it can join as a member.</p>
          <button className="btn btn-ghost !h-8" onClick={() => set(true)} disabled={pending}>
            {pending ? <Loader2 size={14} className="animate-spin" /> : <Link2 size={14} />} Create invite link
          </button>
        </div>
      )}
      {error && <div className="mt-2 rounded-lg bg-red-soft px-3 py-2 text-sm text-red">{error}</div>}
    </div>
  )
}
