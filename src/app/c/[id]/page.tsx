import { Suspense } from 'react'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import { getCollectiveView } from '@/lib/collectives'
import { formatMoney } from '@/lib/money'
import { ViewerSwitcher } from '@/components/ViewerSwitcher'
import { CollectiveTabs } from '@/components/CollectiveTabs'
import { ContributeButton } from '@/components/ContributeDialog'

export default function CollectivePage({ params }: PageProps<'/c/[id]'>) {
  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6 py-8">
      <Link href="/" className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
        <ChevronLeft size={15} /> All collectives
      </Link>
      <Suspense fallback={<div className="mt-6 h-64 card animate-pulse" />}>
        <CollectiveContent params={params} />
      </Suspense>
    </div>
  )
}

async function CollectiveContent({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const view = await getCollectiveView(id)
  if (!view) notFound()
  const { collective, viewer, treasury } = view
  const cur = collective.currency

  const stats = [
    { label: 'Available to spend', value: treasury.availableCents, hint: 'Balance minus approved and in-flight spending', primary: true },
    { label: 'Balance', value: treasury.confirmedBalanceCents, hint: 'Confirmed money in the PayPal account' },
    { label: 'Committed', value: treasury.committedCents + treasury.pendingOutCents, hint: 'Approved, not yet settled' },
    { label: 'Awaiting approval', value: treasury.awaitingApprovalCents, hint: 'Requests still being voted on' },
  ]

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
          />
        </div>
      </div>

      <div className="mt-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className={`card p-4 sm:p-5 ${s.primary ? 'border-ink/15' : ''}`} title={s.hint}>
            <div className="text-xs sm:text-sm text-muted">{s.label}</div>
            <div className={`tabular mt-1 font-semibold tracking-tight ${s.primary ? 'text-2xl sm:text-3xl' : 'text-xl sm:text-2xl'}`}>
              {formatMoney(s.value, cur)}
            </div>
          </div>
        ))}
      </div>

      <CollectiveTabs
        currency={cur}
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
        proposals={collective.proposals.map((p) => ({
          id: p.id,
          title: p.title,
          description: p.description,
          amountCents: p.amountCents,
          requiredApprovals: p.requiredApprovals,
          status: p.status,
          createdAt: p.createdAt.toISOString(),
          proposedBy: p.proposedBy?.name ?? null,
          approvals: p.approvals.map((a) => ({ memberName: a.member.name, decision: a.decision })),
          recipientCount: p.recipients.length,
        }))}
      />
    </>
  )
}
