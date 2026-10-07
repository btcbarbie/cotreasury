import { Suspense } from 'react'
import { notFound } from 'next/navigation'
import { connection } from 'next/server'
import Link from 'next/link'
import { ArrowDownLeft, ArrowUpRight, BellRing, ChevronLeft, PartyPopper, Clock, Landmark } from 'lucide-react'
import { getCollectiveView } from '@/lib/collectives'
import { formatMoney } from '@/lib/money'
import { ViewerSwitcher } from '@/components/ViewerSwitcher'
import { CollectiveTabs } from '@/components/CollectiveTabs'
import { ContributeButton } from '@/components/ContributeDialog'
import { TreasurerPanel } from '@/components/TreasurerPanel'
import { canApprove } from '@/lib/treasury'
import { goalProgress } from '@/lib/goals'

export default function CollectivePage({ params, searchParams }: PageProps<'/c/[id]'>) {
  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6 py-8">
      <Link href="/" className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
        <ChevronLeft size={15} /> All treasuries
      </Link>
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
  const justCreated = (await searchParams).created === '1'
  const view = await getCollectiveView(id)
  if (!view) notFound()
  const { collective, viewer, treasury } = view
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
  const needsMe = canApprove(viewer.role)
    ? collective.proposals.filter(
        (p) => p.status === 'PENDING_APPROVAL' && p.proposedById !== viewer.id && !p.approvals.some((a) => a.memberId === viewer.id),
      ).length
    : 0

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
      <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">{collective.name}</h1>
          <p className="mt-1.5 max-w-2xl text-muted">{collective.purpose}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
            <span className="pill pill-green">
              <span className="h-1.5 w-1.5 rounded-full bg-accent" /> PayPal connected
            </span>
            <span className="text-muted truncate">{collective.paypalEmail}</span>
          </div>
        </div>
        <div className="flex flex-col gap-3 sm:items-end">
          <ViewerSwitcher
            collectiveId={collective.id}
            viewerId={viewer.id}
            members={collective.members.map((m) => ({ id: m.id, name: m.name, role: m.role }))}
          />
          <ContributeButton
            collectiveId={collective.id}
            collectiveName={collective.name}
            currency={cur}
            clientId={process.env.PAYPAL_CLIENT_ID ?? ''}
            viewerName={viewer.name}
            goals={collective.goals.map((g) => ({ id: g.id, title: g.title }))}
          />
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
            <div className={`tabular mt-2 font-semibold tracking-tight ${s.primary ? 'text-2xl sm:text-3xl' : 'text-xl sm:text-2xl'} ${s.valueTone ?? ''}`}>
              {s.sign && s.sign !== '=' && <span className="mr-0.5 text-faint">{s.sign}</span>}
              {formatMoney(s.value, cur)}
            </div>
          </div>
        ))}
      </div>

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

      {needsMe > 0 && (
        <a
          href="#requests"
          className="mt-6 flex items-center justify-between gap-3 rounded-[14px] border border-amber/25 bg-amber-soft px-4 py-3 text-sm text-amber transition hover:border-amber/50"
        >
          <span className="flex items-center gap-2 font-medium">
            <BellRing size={16} /> {needsMe} request{needsMe === 1 ? ' needs' : 's need'} your sign-off
          </span>
          <span className="text-xs">Review →</span>
        </a>
      )}

      <TreasurerPanel collectiveId={collective.id} kind={collective.kind} currency={cur} brief={brief} />

      <CollectiveTabs
        collectiveId={collective.id}
        currency={cur}
        viewerId={viewer.id}
        viewerRole={viewer.role}
        members={collective.members.map((m) => ({ id: m.id, name: m.name, email: m.email, role: m.role }))}
        tiers={collective.tiers.map((t) => ({ minCents: t.minCents, maxCents: t.maxCents, requiredApprovals: t.requiredApprovals }))}
        entries={collective.entries.map((e) => ({
          id: e.id,
          createdAt: e.createdAt.toISOString(),
          type: e.type,
          direction: e.direction,
          amountCents: e.amountCents,
          status: e.status,
          source: e.source,
          memo: e.memo,
          counterparty: e.counterparty ?? e.member?.name ?? null,
          paypalRef: e.paypalRef,
        }))}
        newPayeeRule={collective.newPayeeRule}
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
          createdAt: p.createdAt.toISOString(),
          proposedBy: p.proposedBy?.name ?? null,
          proposedById: p.proposedById,
          approvals: p.approvals.map((a) => ({ memberId: a.memberId, memberName: a.member.name, decision: a.decision })),
          recipients: p.recipients.map((r) => ({ id: r.id, name: r.name, receiver: r.receiver, amountCents: r.amountCents, status: r.status, paypalItemId: r.paypalItemId })),
          paypalBatchId: p.paypalBatchId,
          failureReason: p.failureReason,
        }))}
      />
    </>
  )
}
