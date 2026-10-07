import { Suspense } from 'react'
import { notFound } from 'next/navigation'
import { connection } from 'next/server'
import Link from 'next/link'
import { Archive, ArrowDownLeft, ArrowUpRight, ChevronLeft, PartyPopper, Clock, Landmark } from 'lucide-react'
import { getCollectiveView } from '@/lib/collectives'
import { formatMoney } from '@/lib/money'
import { ViewerSwitcher } from '@/components/ViewerSwitcher'
import { HeaderSlot } from '@/components/HeaderSlot'
import { CollectiveTabs } from '@/components/CollectiveTabs'
import { ContributeButton } from '@/components/ContributeDialog'
import { RequestPaymentButton } from '@/components/RequestPaymentButton'
import { TreasurerPanel } from '@/components/TreasurerPanel'
import { canApprove } from '@/lib/treasury'
import { goalProgress } from '@/lib/goals'
import { getMerchantAccount } from '@/lib/paypal'
import { unseenFor } from '@/lib/notifications'
import { NotificationsCard } from '@/components/NotificationsCard'
import { ApprovalsPill } from '@/components/ApprovalsPill'
import { treasuryLock } from '@/lib/exit'
import { fairShares } from '@/lib/exitPolicy'
import type { ExitInfo } from '@/components/ExitPanel'

export default function CollectivePage({ params, searchParams }: PageProps<'/c/[id]'>) {
  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6 pt-4 pb-8">
      <Suspense fallback={<div className="mt-6 h-64 card animate-pulse" />}>
        <CollectiveContent params={params} searchParams={searchParams} />
      </Suspense>
    </div>
  )
}

async function CollectiveContent({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  await connection() // live treasury data and today's date: always render per request
  const { id } = await params
  const sp = await searchParams
  const justCreated = sp.created === '1'
  const justJoined = sp.joined === '1'
  const [view, account] = await Promise.all([getCollectiveView(id), getMerchantAccount()])
  if (!view) notFound()
  const { collective, viewer, treasury } = view
  const notifications = await unseenFor(collective.id, viewer)
  const lock = await treasuryLock(collective.id)
  const closeVote = collective.proposals.some((p) => p.kind === 'CLOSE' && p.status === 'PENDING_APPROVAL')
  const myShare = fairShares(collective.members, collective.entries, treasury.availableCents).find((s) => s.memberId === viewer.id)
  const exit: ExitInfo = {
    policy: collective.exitPolicy,
    status: collective.status,
    lock,
    availableCents: treasury.availableCents,
    strictestApprovals: Math.max(1, ...collective.tiers.map((t) => t.requiredApprovals)),
    openPayouts: collective.proposals.filter((p) => ['SPEND', 'REFUND'].includes(p.kind) && ['PENDING_APPROVAL', 'APPROVED', 'EXECUTING'].includes(p.status)).length,
    rulePending: collective.proposals.some((p) => p.kind === 'RULE_CHANGE' && p.status === 'PENDING_APPROVAL'),
    me: { contributedCents: myShare?.contributedCents ?? 0, shareCents: myShare?.shareCents ?? 0 },
    closeShares: fairShares(collective.members, collective.entries, treasury.availableCents, true).map(({ memberId, name, contributedCents, shareCents }) => ({ memberId, name, contributedCents, shareCents })),
  }
  const cur = collective.currency

  // Only PayPal-confirmed money counts: inflow − outflow = current balance.
  const inflow = collective.entries.filter((e) => e.direction === 'IN' && e.status === 'CONFIRMED').reduce((s, e) => s + e.amountCents, 0)
  const outflow = collective.entries.filter((e) => e.direction === 'OUT' && e.status === 'CONFIRMED').reduce((s, e) => s + e.amountCents, 0)
  const stats = [
    { label: 'Total inflow', value: inflow, sign: '+', hint: 'All money in, confirmed by PayPal', Icon: ArrowDownLeft, tone: 'bg-accent-soft text-accent', valueTone: 'text-accent' },
    { label: 'Total outflow', value: outflow, sign: '−', hint: 'All money out, confirmed by PayPal', Icon: ArrowUpRight, tone: 'bg-red-soft text-red' },
    { label: 'Current balance', value: treasury.confirmedBalanceCents, sign: '=', hint: 'Total inflow minus total outflow', Icon: Landmark, tone: 'bg-teal-soft text-teal', primary: true },
    { label: 'Awaiting approval', value: treasury.awaitingApprovalCents, hint: 'Requests still being voted on', Icon: Clock, tone: 'bg-amber-soft text-amber' },
  ]

  // Approver inbox: open requests this viewer is allowed to vote on and hasn't yet.
  // Can this viewer vote on p right now? Panel requests: only an active panel seat. Otherwise: approvers.
  const mySeat = (p: (typeof collective.proposals)[number]) => p.reviewers.some((r) => r.memberId === viewer.id && r.status === 'ACTIVE')
  const canVote = (p: (typeof collective.proposals)[number]) =>
    p.status === 'PENDING_APPROVAL' &&
    p.proposedById !== viewer.id &&
    !p.approvals.some((a) => a.memberId === viewer.id) &&
    (p.panelSeed ? mySeat(p) : canApprove(viewer.role))
  const pendingForMe = collective.proposals.some(canVote)
    ? collective.proposals
        .filter(canVote)
        .map((p) => ({
          id: p.id,
          kind: p.kind,
          title: p.title,
          description: p.description,
          amountCents: p.amountCents,
          requestedBy: p.proposedBy?.name ?? null,
          approvals: p.approvals.filter((a) => a.decision === 'APPROVE').length,
          rejections: p.approvals.filter((a) => a.decision === 'REJECT').length,
          required: p.requiredApprovals,
          wontPass: !!p.wontPassAt,
          recipients: p.recipients.map((r) => ({ name: r.name, receiver: r.receiver, amountCents: r.amountCents })),
          flags: p.flags ? (JSON.parse(p.flags) as { message: string }[]).map((f) => f.message) : [],
          panel: !!p.panelSeed,
        }))
    : []

  // Deterministic opening brief for the AI Treasurer panel: facts from the ledger, no model call.
  const approverCount = collective.members.filter((m) => canApprove(m.role)).length
  const openCount = collective.proposals.filter((p) => p.status === 'PENDING_APPROVAL').length
  const topTier = collective.tiers.find((t) => t.requiredApprovals >= 3) ?? collective.tiers.at(-1)
  const brief = [
    `**${formatMoney(treasury.availableCents, cur)}** is available to spend right now.`,
    openCount === 0 ? 'No requests are waiting for approval.' : `**${openCount}** request${openCount === 1 ? ' is' : 's are'} waiting for approval.`,
    topTier
      ? `Spending ${formatMoney(topTier.minCents, cur)} or more needs **${topTier.requiredApprovals} of ${approverCount}** approvers. Ask me whether something fits and I'll draft the request.`
      : '',
  ].join(' ')

  return (
    <>
      {/* Demo identity lives in the site header, top right. */}
      <HeaderSlot>
        <ViewerSwitcher
          collectiveId={collective.id}
          viewerId={viewer.id}
          members={collective.members.map((m) => ({ id: m.id, name: m.name, role: m.role }))}
        />
      </HeaderSlot>
      <Link href="/" className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
        <ChevronLeft size={15} /> All treasuries
      </Link>

      <div className="mt-5 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">{collective.name}</h1>
          <p className="mt-1.5 max-w-2xl text-muted">{collective.purpose}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
            <span className="pill pill-green">
              <span className="h-1.5 w-1.5 rounded-full bg-accent" /> PayPal sandbox account
            </span>
            {/* The account that really holds the money, as reported by PayPal, not a label we typed in. */}
            <span className="truncate font-mono text-xs text-ink/80" title={account.merchantId ? `PayPal merchant ID ${account.merchantId}` : undefined}>
              {account.email ?? 'PayPal sandbox business account'}
            </span>
            <span className="text-xs text-muted">· shared by all demo treasuries; in real use each group connects its own</span>
          </div>
        </div>
        <div className="flex shrink-0 flex-col gap-3 sm:items-end">
          {/* Closed, closing or voting on closing: money can't move, so no buttons that would move it. */}
          {!lock && (
          <div className="flex flex-wrap gap-2 sm:justify-end">
          <RequestPaymentButton collectiveId={collective.id} currency={cur} />
          <ContributeButton
            collectiveId={collective.id}
            collectiveName={collective.name}
            currency={cur}
            clientId={process.env.PAYPAL_CLIENT_ID ?? ''}
            viewerName={viewer.name}
            goals={collective.goals.map((g) => ({ id: g.id, title: g.title }))}
          />
          </div>
          )}
        </div>
      </div>

      <div className="mt-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className={`card p-4 sm:p-5 ${s.primary ? 'border-accent/25 shadow-[0_1px_0_rgba(15,123,95,0.06)]' : ''}`} title={s.hint}>
            <div className="flex items-center gap-2 text-xs sm:text-sm text-muted">
              <span className={`inline-flex h-6 w-6 items-center justify-center rounded-md ${s.tone}`}>
                <s.Icon size={13} strokeWidth={2.2} />
              </span>
              {s.label}
            </div>
            <div className={`tabular mt-2 font-semibold tracking-tight text-xl sm:text-2xl ${s.valueTone ?? ''}`}>
              {s.sign && s.sign !== '=' && <span className="mr-0.5 text-faint">{s.sign}</span>}
              {formatMoney(s.value, cur)}
            </div>
          </div>
        ))}
      </div>

      {(pendingForMe.length > 0 || notifications.items.length > 0) && (
        <div className="mt-4 flex flex-wrap items-start gap-2">
          <ApprovalsPill key={`a-${viewer.id}`} items={pendingForMe} currency={cur} />
          <NotificationsCard key={viewer.id} collectiveId={collective.id} items={notifications.items} headSeq={notifications.headSeq} />
        </div>
      )}

      {lock && (
        <div className={`mt-6 flex items-start gap-3 rounded-[14px] border px-4 py-3 text-sm ${collective.status === 'CLOSED' ? 'border-line bg-bg text-muted' : 'border-red/25 bg-red-soft text-red'}`}>
          <Archive size={18} className="mt-0.5 shrink-0" />
          <div>
            <div className="font-medium">
              {collective.status === 'CLOSED'
                ? `Closed${collective.closedAt ? ` on ${collective.closedAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}` : ''}`
                : collective.status === 'CLOSING'
                  ? 'Closing: paying out the final settlement'
                  : 'The group is voting on closing this treasury'}
            </div>
            <div className="opacity-80">{closeVote ? 'New contributions and requests are paused until the vote is decided. The proposal is in Needs attention below.' : lock}</div>
          </div>
        </div>
      )}
      {justJoined && (
        <div className="mt-6 flex items-start gap-3 rounded-[14px] border border-accent/25 bg-accent-soft px-4 py-3 text-sm text-accent">
          <PartyPopper size={18} className="mt-0.5 shrink-0" />
          <div>
            <div className="font-medium">Welcome to {collective.name}, {viewer.name.split(' ')[0]}.</div>
            <div className="text-accent/80">You can see every dollar in and out, add funds, and request payouts. Ask the AI Treasurer anything about the money.</div>
          </div>
        </div>
      )}
      {justCreated && (
        <div className="mt-6 flex items-start gap-3 rounded-[14px] border border-accent/25 bg-accent-soft px-4 py-3 text-sm text-accent">
          <PartyPopper size={18} className="mt-0.5 shrink-0" />
          <div>
            <div className="font-medium">Your treasury is open.</div>
            <div className="text-accent/80">
              Make the first contribution, ask the AI Treasurer what it can do, or switch members (top right) to see what each person sees.
            </div>
          </div>
        </div>
      )}


      {/* Keyed by viewer: each member's chat is private and starts fresh when you switch. */}
      <TreasurerPanel key={viewer.id} collectiveId={collective.id} kind={collective.kind} currency={cur} brief={brief} />

      <CollectiveTabs
        collectiveId={collective.id}
        collectiveName={collective.name}
        purpose={collective.purpose}
        approvalMode={collective.approvalMode}
        kind={collective.kind}
        viewerName={viewer.name}
        currency={cur}
        viewerId={viewer.id}
        viewerRole={viewer.role}
        exit={exit}
        exitPolicy={collective.exitPolicy}
        inviteCode={viewer.role === 'ADMIN' ? collective.inviteCode : null}
        members={collective.members.map((m) => ({ id: m.id, name: m.name, email: m.email, role: m.role }))}
        tiers={collective.tiers.map((t) => ({ minCents: t.minCents, maxCents: t.maxCents, requiredApprovals: t.requiredApprovals }))}
        entries={collective.entries.map((e) => {
          const goal = e.goalId ? collective.goals.find((g) => g.id === e.goalId) : null
          return {
            id: e.id,
            createdAt: e.createdAt.toISOString(),
            type: e.type,
            direction: e.direction,
            amountCents: e.amountCents,
            status: e.status,
            source: e.source,
            memo: goal ? `Paid for ${goal.title}` : e.memo,
            counterparty: e.counterparty ?? e.member?.name ?? null,
            paypalRef: e.paypalRef,
            requestedBy: e.proposal?.proposedBy?.name ?? null,
            approvedBy: e.proposal?.approvals.map((a) => a.member.name) ?? [],
          }
        })}
        goals={goalProgress(collective.goals, collective.members, collective.entries)}
        events={collective.events.map((e) => ({ id: e.id, seq: e.seq, actor: e.actor, action: e.action, summary: e.summary, createdAt: e.createdAt.toISOString(), hash: e.hash }))}
        proposals={collective.proposals.map((p) => ({
          id: p.id,
          kind: p.kind,
          flags: p.flags ? (JSON.parse(p.flags) as { code: string; message: string; extraApproval: boolean }[]) : [],
          title: p.title,
          description: p.description,
          amountCents: p.amountCents,
          requiredApprovals: p.requiredApprovals,
          status: p.status,
          wontPass: !!p.wontPassAt,
          createdAt: p.createdAt.toISOString(),
          proposedBy: p.proposedBy?.name ?? null,
          proposedById: p.proposedById,
          // While a hidden panel is still voting, nobody sees who is on it or who voted.
          approvals: p.approvals.map((a) =>
            p.panelSeed && p.status === 'PENDING_APPROVAL'
              ? { memberId: a.memberId === viewer.id ? a.memberId : `hidden-${a.id}`, memberName: 'Panel reviewer', decision: a.decision }
              : { memberId: a.memberId, memberName: a.member.name, decision: a.decision },
          ),
          recipients: p.recipients.map((r) => ({ id: r.id, name: r.name, receiver: r.receiver, amountCents: r.amountCents, status: r.status, paypalItemId: r.paypalItemId })),
          paypalBatchId: p.paypalBatchId,
          failureReason: p.failureReason,
          panel: p.panelSeed ? { size: p.reviewers.filter((r) => r.status !== 'REPLACED').length, iAmReviewer: mySeat(p), canVote: canVote(p) } : null,
        }))}
      />
    </>
  )
}
