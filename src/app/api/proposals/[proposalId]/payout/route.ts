import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { refreshPayoutBatch } from '@/lib/payouts'
import { canAccess } from '@/lib/collectives'

// Polled by the request card while a payout is in flight. Webhooks are the
// primary signal; after a grace period we ask PayPal for the batch directly.
const WEBHOOK_GRACE_MS = 15_000

export async function GET(_req: Request, ctx: RouteContext<'/api/proposals/[proposalId]/payout'>) {
  const { proposalId } = await ctx.params
  let p = await prisma.proposal.findUnique({ where: { id: proposalId }, include: { recipients: true } })
  if (!p || !(await canAccess(p.collectiveId))) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (p.status === 'EXECUTING' && p.executedAt && Date.now() - p.executedAt.getTime() > WEBHOOK_GRACE_MS) {
    await refreshPayoutBatch(p.id).catch((e) => console.error('Payout refresh failed', e))
    p = (await prisma.proposal.findUnique({ where: { id: proposalId }, include: { recipients: true } }))!
  }
  return NextResponse.json({
    status: p.status,
    failureReason: p.failureReason,
    recipients: p.recipients.map((r) => ({ id: r.id, status: r.status })),
  })
}
