import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCapture } from '@/lib/paypal'
import { applyCaptureStatus } from '@/lib/ledger'

// The browser polls this while a contribution is pending. The webhook is the
// primary confirmation; if it hasn't arrived after a grace period we ask PayPal
// directly, so the ledger never depends on a single delivery path.
const WEBHOOK_GRACE_MS = 15_000

export async function GET(_req: Request, ctx: RouteContext<'/api/ledger/[entryId]'>) {
  const { entryId } = await ctx.params
  let entry = await prisma.ledgerEntry.findUnique({ where: { id: entryId } })
  if (!entry) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (
    entry.status === 'PENDING' &&
    entry.type === 'CONTRIBUTION' &&
    entry.paypalRef &&
    Date.now() - entry.createdAt.getTime() > WEBHOOK_GRACE_MS
  ) {
    const capture = await getCapture(entry.paypalRef)
    entry = (await applyCaptureStatus(capture, 'PAYPAL_API')) ?? entry
  }
  return NextResponse.json({ status: entry.status, source: entry.source })
}
