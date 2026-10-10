'use client'

import { useEffect, useState, useTransition } from 'react'
import dynamic from 'next/dynamic'
import { AlertTriangle, BookOpen, Check, History, LayoutGrid, Loader2, RotateCcw, Scale, Send, ShieldCheck, SlidersHorizontal, UsersRound, X } from 'lucide-react'
import { decideRequest, refreshCollective, retryRequestPayout, cancelClose, checkPayPalNow } from '@/app/c/[id]/actions'
import { formatMoney } from '@/lib/money'
import { Avatar, RoleBadge } from './ui'
import { RulesPanel } from './RulesPanel'
import { AddMemberButton, TreasuryDetailsCard } from './SettingsPanels'
import { ExitPanel, type ExitInfo } from './ExitPanel'
import { OverviewPanel } from './OverviewPanel'
import { CollapsibleSection, MinimizeButton } from './Collapsible'
import { AttentionPanel, attentionItems } from './AttentionPanel'
import { ActivityPanel, type ActivityEvent } from './ActivityPanel'
import type { GoalProgress } from '@/lib/goals'
import type { LedgerRow } from './LedgerGrid'
import { receiverLabel } from '@/lib/recipients'

// AG Grid touches window on import; render it client-side only.
const LedgerGrid = dynamic(() => import('./LedgerGrid').then((m) => m.LedgerGrid), {
  ssr: false,
  loading: () => <div className="h-[520px] animate-pulse bg-bg" />,
})

type Member = { id: string; name: string; email: string; role: string }
type Tier = { minCents: number; maxCents: number | null; requiredApprovals: number }
type Proposal = {
  id: string
  kind: string
  flags: { code: string; message: string; extraApproval: boolean }[]
  title: string
  description: string | null
  amountCents: number
  requiredApprovals: number
  status: string
  wontPass: boolean
  createdAt: string
  proposedBy: string | null
  proposedById: string | null
  approvals: { memberId: string; memberName: string; decision: string }[]
  recipients: { id: string; name: string; receiver: string; amountCents: number; status: string; paypalItemId: string | null }[]
  paypalBatchId: string | null
  failureReason: string | null
  panel: { size: number; iAmReviewer: boolean; canVote: boolean } | null
}

const TABS = ['Overview', 'Activity log', 'Ledger', 'Settings'] as const
type Tab = (typeof TABS)[number]
const TAB_ICONS: Record<Tab, typeof Scale> = { Overview: LayoutGrid, 'Activity log': History, Ledger: BookOpen, Settings: SlidersHorizontal }

export function CollectiveTabs(props: {
  collectiveId: string
  collectiveName: string
  purpose: string
  approvalMode: string
  kind: string
  viewerName: string
  currency: string
  viewerId: string
  viewerRole: string
  exit: ExitInfo
  outsideCheck: { enabled: boolean; lastAt: string | null; since: string | null }
  exitPolicy: string
  maxMembers: number
  inviteCode: string | null
  goals: GoalProgress[]
  events: ActivityEvent[]
  members: Member[]
  tiers: Tier[]
  entries: LedgerRow[]
  proposals: Proposal[]
}) {
  const [tab, setTab] = useState<Tab>('Overview')
  const attention = attentionItems({
    proposals: props.proposals,
    entries: props.entries,
    goals: props.goals,
    viewerId: props.viewerId,
    viewerRole: props.viewerRole,
    currency: props.currency,
  })
  // The approver inbox banner links to #requests: open that tab when it's followed.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.('a[href^="#"]')
      const target = a?.getAttribute('href')
      const to: Record<string, Tab> = { '#requests': 'Overview', '#activity': 'Activity log', '#ledger': 'Ledger' }
      if (target && to[target]) {
        e.preventDefault()
        setTab(to[target])
        document.getElementById('requests')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }
    }
    document.addEventListener('click', onClick)
    return () => document.removeEventListener('click', onClick)
  }, [])
  // Live requests (waiting for votes, being paid, or failed) are worked on in
  // Overview → Needs attention; everything else is history in the activity log.
  const live = props.proposals.filter((p) => ['PENDING_APPROVAL', 'EXECUTING', 'FAILED'].includes(p.status))
  const otherItems = attention.filter((i) => !/^[pef]-/.test(i.key)) // unclaimed / returned payouts
  const needsCount = live.length + otherItems.length
  const counts: Partial<Record<Tab, number>> = {
    Overview: needsCount || undefined,
    'Activity log': props.events.length || undefined,
    Ledger: props.entries.length,
    Settings: props.members.length,
  }

  return (
    <div id="requests" className="mt-10 scroll-mt-20">
      {/* The four main views: big enough to read as the backbone of the page. */}
      <div className="no-scrollbar flex gap-1 overflow-x-auto border-b border-line sm:gap-2">
        {TABS.map((t) => {
          const Icon = TAB_ICONS[t]
          return (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`relative -mb-px flex shrink-0 items-center gap-2 border-b-[3px] px-3 py-3.5 text-base font-semibold tracking-tight transition sm:px-4 sm:text-lg ${
                tab === t ? 'border-ink text-ink' : 'border-transparent text-muted hover:text-ink'
              }`}
            >
              <Icon size={18} className={tab === t ? 'text-accent' : 'text-faint'} />
              {t}
              {counts[t] != null && (
                <span className={`tabular rounded-full px-2 py-0.5 text-xs font-medium ${tab === t ? 'bg-ink text-white' : 'bg-bg text-muted'}`}>{counts[t]}</span>
              )}
            </button>
          )
        })}
      </div>

      <div className="mt-5">
        {tab === 'Overview' && (
          <div className="grid gap-10">
            <OverviewPanel
              collectiveId={props.collectiveId}
              currency={props.currency}
              goals={props.goals}
              canManage={props.viewerRole === 'APPROVER' || props.viewerRole === 'ADMIN'}
              viewerId={props.viewerId}
            />
            <CollapsibleSection title="Needs attention" count={needsCount || undefined}>
              <div className="grid gap-3">
                {live.length === 0 && otherItems.length === 0 && <AttentionPanel items={[]} onOpenRequests={() => {}} />}
                {live.map((p) => (
                  <RequestCard
                    key={p.id}
                    p={p}
                    currency={props.currency}
                    viewerId={props.viewerId}
                    viewerRole={props.viewerRole}
                    approvers={props.members.filter((m) => m.role === 'APPROVER' || m.role === 'ADMIN')}
                  />
                ))}
                {otherItems.length > 0 && <AttentionPanel items={otherItems} onOpenRequests={() => {}} />}
              </div>
            </CollapsibleSection>
          </div>
        )}
        {tab === 'Activity log' && (
          <div className="grid gap-10">
            <CollapsibleSection title="Every action" count={props.events.length}>
              <ActivityPanel collectiveId={props.collectiveId} events={props.events} />
            </CollapsibleSection>
          </div>
        )}
        {tab === 'Ledger' && (
          <CollapsibleSection title="Ledger" count={props.entries.length}>
            <OutsideCheckBar collectiveId={props.collectiveId} check={props.outsideCheck} />
            <div className="card overflow-hidden">
              <LedgerGrid entries={props.entries} currency={props.currency} />
            </div>
          </CollapsibleSection>
        )}
        {tab === 'Settings' && (
          <div className="grid gap-10">
            <TreasuryDetailsCard
              key={`${props.collectiveName}|${props.purpose}`}
              collectiveId={props.collectiveId}
              name={props.collectiveName}
              purpose={props.purpose}
              isAdmin={props.viewerRole === 'ADMIN'}
            />
            <CollapsibleSection
              title={
                <>
                  Members{' '}
                  <span className="tabular text-sm font-normal text-muted">
                    {props.members.length} of {props.maxMembers}
                  </span>
                </>
              }
              actions={
                props.viewerRole === 'ADMIN' ? (
                  <AddMemberButton collectiveId={props.collectiveId} inviteCode={props.inviteCode} full={props.members.length >= props.maxMembers} />
                ) : undefined
              }
            >
              <MembersPanel members={props.members} />
            </CollapsibleSection>
            <CollapsibleSection title="Rules & governance">
              <RulesPanel
                collectiveId={props.collectiveId}
                tiers={props.tiers}
                members={props.members}
                currency={props.currency}
                approvalMode={props.approvalMode}
                exitPolicy={props.exitPolicy}
                maxMembers={props.maxMembers}
                viewerRole={props.viewerRole}
                ruleChangePending={props.proposals.some((p) => p.kind === 'RULE_CHANGE' && p.status === 'PENDING_APPROVAL')}
              />
            </CollapsibleSection>
            {/* Rarely needed, so tucked away: closed by default, quiet heading, last on the page. */}
            <CollapsibleSection title="Leave or close this treasury" defaultOpen={false} muted>
              <ExitPanel collectiveId={props.collectiveId} currency={props.currency} viewerRole={props.viewerRole} exit={props.exit} />
            </CollapsibleSection>
          </div>
        )}
      </div>
    </div>
  )
}

const RECIPIENT_STATUS: Record<string, { label: string; pill: string; spin?: boolean }> = {
  SENT: { label: 'Sending', pill: 'pill-blue', spin: true },
  SUCCEEDED: { label: 'Paid', pill: 'pill-green' },
  UNCLAIMED: { label: 'Sent · awaiting claim', pill: 'pill-amber' },
  FAILED: { label: 'Failed', pill: 'pill-red' },
  RETURNED: { label: 'Returned', pill: 'pill-red' },
}

const PROPOSAL_STATUS: Record<string, { label: string; pill: string }> = {
  PENDING_APPROVAL: { label: 'Awaiting approval', pill: 'pill-amber' },
  APPROVED: { label: 'Approved', pill: 'pill-blue' },
  EXECUTING: { label: 'Sending via PayPal', pill: 'pill-blue' },
  COMPLETED: { label: 'Paid via PayPal', pill: 'pill-green' },
  REJECTED: { label: 'Rejected', pill: 'pill-red' },
  FAILED: { label: 'Failed', pill: 'pill-red' },
}

function RequestCard({
  p,
  currency,
  viewerId,
  viewerRole,
  approvers,
}: {
  p: Proposal
  currency: string
  viewerId: string
  viewerRole: string
  approvers: Member[]
}) {
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [liveStatus, setLiveStatus] = useState<Record<string, string>>({})
  const executing = p.status === 'EXECUTING'

  // While PayPal is sending, poll the payout status and refresh the page when it settles.
  useEffect(() => {
    if (!executing) return
    let stop = false
    const tick = async () => {
      if (stop) return
      const res = await fetch(`/api/proposals/${p.id}/payout`, { cache: 'no-store' })
      if (res.ok) {
        const d = (await res.json()) as { status: string; recipients: { id: string; status: string }[] }
        setLiveStatus(Object.fromEntries(d.recipients.map((r) => [r.id, r.status])))
        if (d.status !== 'EXECUTING') return void (await refreshCollective())
      }
      setTimeout(tick, 3000)
    }
    const t = setTimeout(tick, 2000)
    return () => {
      stop = true
      clearTimeout(t)
    }
  }, [executing, p.id])

  function retry() {
    setError(null)
    start(async () => {
      const r = await retryRequestPayout(p.id)
      if (!r.ok) setError(r.error)
    })
  }

  function reopen() {
    setError(null)
    start(async () => {
      const r = await cancelClose(p.id)
      if (!r.ok) setError(r.error)
    })
  }

  const approvals = p.approvals.filter((a) => a.decision === 'APPROVE').length
  const rejections = p.approvals.length - approvals
  const isRule = p.kind === 'RULE_CHANGE'
  const s =
    isRule && p.status === 'COMPLETED'
      ? { label: 'Applied', pill: 'pill-green' }
      : p.wontPass && p.status === 'PENDING_APPROVAL'
        ? { label: 'Won’t pass · voting open', pill: 'pill-red' }
        : (PROPOSAL_STATUS[p.status] ?? { label: p.status, pill: 'pill-gray' })
  const isApprover = viewerRole === 'APPROVER' || viewerRole === 'ADMIN'
  const isMaker = p.proposedById === viewerId
  const voted = p.approvals.some((a) => a.memberId === viewerId)
  const open = p.status === 'PENDING_APPROVAL'

  function decide(decision: 'APPROVE' | 'REJECT') {
    setError(null)
    start(async () => {
      const r = await decideRequest(p.id, decision)
      if (!r.ok) setError(r.error)
    })
  }

  // Panel requests: only drawn reviewers vote. Fixed: any approver except the maker, once.
  const canVote = p.panel ? p.panel.canVote : open && isApprover && !isMaker && !voted
  let note: string | null = null
  if (p.wontPass && open) {
    note = canVote
      ? 'This can no longer get enough approvals, so no money will move. You can still vote so the group’s decision is on the record.'
      : 'This can no longer get enough approvals, so no money will move. It closes as rejected once everyone has voted or the review window ends.'
  } else if (p.panel && open) {
    note = p.panel.canVote
      ? 'You were drawn at random to review this. Nobody else can see who is on the panel until it is decided.'
      : isMaker
        ? 'A hidden review panel was drawn at random. You will see who reviewed it once it is decided.'
        : voted
          ? 'Your vote is in. Waiting for the rest of the panel.'
          : 'Reviewed by a hidden panel drawn at random; their names are revealed once it is decided.'
  } else if (open && !isApprover) note = 'Only approvers can sign off on requests.'
  else if (open && isMaker) note = 'You created this request, so another approver has to review it.'
  else if (open && voted) note = 'You have signed off. Waiting for the other approvers.'

  // Collapsed to one line unless it's your turn to vote or something went wrong.
  const [expanded, setExpanded] = useState(canVote || p.status === 'FAILED')

  return (
    <div className="card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {isRule && (
              <span className="pill pill-violet">
                <Scale size={12} /> Rule change
              </span>
            )}
            {p.kind === 'REFUND' && <span className="pill pill-amber">Refund</span>}
            {p.kind === 'CLOSE' && <span className="pill pill-red">Close treasury</span>}
            <span className="font-medium">{p.title}</span>
            <span className={`pill ${s.pill}`}>{s.label}</span>
          </div>
          {!expanded && (
            <div className="mt-1 text-xs text-muted">
              {approvals} of {p.requiredApprovals} approvals{rejections > 0 ? ` · ${rejections} rejected` : ''} · requested by {p.proposedBy ?? 'unknown'}
              {canVote && <span className="ml-1 font-medium text-amber">· your vote is needed</span>}
            </div>
          )}
          {expanded && p.description &&
            (isRule ? (
              <ul className="mt-2 grid gap-1 text-sm text-ink/80">
                {p.description.split('\n').map((l, i) => (
                  <li key={i}>• {l}</li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 whitespace-pre-line text-sm text-muted">{p.description}</p>
            ))}
          {expanded && (
            <div className="mt-1 text-xs text-faint">
              Requested by {p.proposedBy ?? 'unknown'} · {new Date(p.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            </div>
          )}
        </div>
        <div className="flex items-start gap-2">
          {!isRule && <div className="tabular text-xl font-semibold">{formatMoney(p.amountCents, currency)}</div>}
          <MinimizeButton open={expanded} onToggle={() => setExpanded(!expanded)} label="request" />
        </div>
      </div>

      {expanded && (
        <>

      {p.flags.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {p.flags.map((f) => (
            <span key={f.code} className="pill pill-amber" title="Automated risk check">
              <AlertTriangle size={12} /> {f.message}
            </span>
          ))}
        </div>
      )}

      {p.recipients.length > 0 && (
        <ul className="mt-4 divide-y divide-line rounded-lg bg-bg/70 text-sm">
          {p.recipients.map((r) => {
            const rs = RECIPIENT_STATUS[liveStatus[r.id] ?? r.status]
            return (
              <li key={r.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <span className="min-w-0 truncate">
                  {r.name} <span className="text-muted">· {receiverLabel(r.receiver)}</span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  {rs && (
                    <span className={`pill ${rs.pill} !h-[20px] !text-[11px]`}>
                      {rs.spin && <Loader2 size={11} className="animate-spin" />} {rs.label}
                    </span>
                  )}
                  <span className="tabular">{formatMoney(r.amountCents, currency)}</span>
                </span>
              </li>
            )
          })}
        </ul>
      )}

      {executing && (
        <div className="mt-3 flex items-center gap-2 rounded-lg bg-blue-soft px-3 py-2 text-sm text-blue">
          <Send size={14} /> Approved by the collective. PayPal is sending the money; each recipient updates when PayPal confirms.
        </div>
      )}
      {p.status === 'COMPLETED' && !isRule && p.paypalBatchId && (
        <div className="mt-3 text-xs text-muted">
          PayPal payout batch <span className="font-mono">{p.paypalBatchId}</span>
        </div>
      )}
      {p.status === 'FAILED' && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-red-soft px-3 py-2 text-sm text-red">
          <span>{p.failureReason ?? 'The payout failed.'}</span>
          {isApprover && !p.recipients.some((r) => r.status === 'SUCCEEDED' || r.status === 'UNCLAIMED') && (
            <span className="flex gap-2">
              {p.kind === 'CLOSE' && (
                <button className="btn btn-ghost !h-7 !text-xs" onClick={reopen} disabled={pending}>
                  Cancel closing
                </button>
              )}
              <button className="btn btn-ghost !h-7 !text-xs" onClick={retry} disabled={pending}>
                <RotateCcw size={12} /> Retry payout
              </button>
            </span>
          )}
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {p.panel ? (
            <span className="pill pill-violet">
              <UsersRound size={12} /> {open ? 'Hidden review panel' : 'Review panel'} of {p.panel.size}
            </span>
          ) : (
          <div className="flex -space-x-1.5">
            {approvers.map((m) => {
              const vote = p.approvals.find((a) => a.memberId === m.id)
              const tone = vote?.decision === 'APPROVE' ? 'bg-accent text-white' : vote?.decision === 'REJECT' ? 'bg-red text-white' : 'bg-bg text-faint'
              return (
                <span
                  key={m.id}
                  title={`${m.name}${vote ? (vote.decision === 'APPROVE' ? ' approved' : ' rejected') : m.id === p.proposedById ? ' (requester)' : ''}`}
                  className={`inline-flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-semibold ring-2 ring-white ${tone}`}
                >
                  {vote?.decision === 'APPROVE' ? <Check size={12} strokeWidth={3} /> : vote?.decision === 'REJECT' ? <X size={12} strokeWidth={3} /> : m.name.split(' ').map((w) => w[0]).join('').slice(0, 2)}
                </span>
              )
            })}
          </div>
          )}
          <span className="text-sm text-muted">
            <span className="tabular font-medium text-ink">{approvals}</span> of {p.requiredApprovals} approvals
            {rejections > 0 && <span className="text-red"> · {rejections} rejected</span>}
          </span>
        </div>
        {canVote && (
          <div className="flex gap-2">
            <button className="btn btn-ghost !h-8" onClick={() => decide('REJECT')} disabled={pending}>
              Reject
            </button>
            <button className="btn btn-primary !h-8 !bg-accent" onClick={() => decide('APPROVE')} disabled={pending}>
              {pending ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} strokeWidth={3} />}{' '}
              {!isRule && !p.wontPass && approvals + 1 >= p.requiredApprovals ? (p.kind === 'CLOSE' ? 'Approve & close treasury' : 'Approve & release payout') : 'Approve'}
            </button>
          </div>
        )}
      </div>
      {note && <div className="mt-3 text-xs text-muted">{note}</div>}
      {error && <div className="mt-3 rounded-lg bg-red-soft px-3 py-2 text-sm text-red">{error}</div>}
        </>
      )}
    </div>
  )
}

function MembersPanel({ members }: { members: Member[] }) {
  return (
    <div className="card divide-y divide-line">
      {members.map((m) => (
        <div key={m.id} className="flex items-center gap-3 px-5 py-3">
          <Avatar name={m.name} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{m.name}</div>
            <div className="truncate text-xs text-muted">{m.email}</div>
          </div>
          <RoleBadge role={m.role} />
        </div>
      ))}
    </div>
  )
}

/** Is the ledger checked against PayPal's own history, and when was it last checked? One quiet line. */
function OutsideCheckBar({ collectiveId, check }: { collectiveId: string; check: { enabled: boolean; lastAt: string | null; since: string | null } }) {
  const [pending, start] = useTransition()
  const [note, setNote] = useState<string | null>(null)
  if (!check.enabled) {
    return (
      <p className="mb-2 flex items-center gap-1.5 text-xs text-muted">
        <ShieldCheck size={12} /> Payments made directly in PayPal are checked once this group has its own PayPal account.
      </p>
    )
  }
  function run() {
    setNote(null)
    start(async () => {
      const r = await checkPayPalNow(collectiveId)
      setNote(r.ok ? (r.flagged ? `${r.flagged} new outside movement${r.flagged === 1 ? '' : 's'}` : 'All matches') : r.error)
    })
  }
  return (
    <p className="mb-2 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted" title="Anything done directly in PayPal shows up red. PayPal's history can lag by a few minutes.">
      <ShieldCheck size={12} className="text-accent" /> Checked against PayPal
      {check.lastAt && <> · {new Date(check.lastAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</>}
      <span>·</span>
      <button className="inline-flex items-center gap-1 font-medium text-ink underline-offset-2 hover:underline disabled:opacity-50" onClick={run} disabled={pending}>
        {pending && <Loader2 size={11} className="animate-spin" />} Check now
      </button>
      {note && <span className="text-accent">· {note}</span>}
    </p>
  )
}
