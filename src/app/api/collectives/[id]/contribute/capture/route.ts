import { NextResponse } from 'next/server'
import { getViewer } from '@/lib/collectives'
import { captureOrder, PayPalError } from '@/lib/paypal'
import { contributionCustomId, recordCaptureAttempt } from '@/lib/ledger'

export async function POST(req: Request, ctx: RouteContext<'/api/collectives/[id]/contribute/capture'>) {
  const { id } = await ctx.params
  const { orderId } = (await req.json()) as { orderId: string }
  const viewer = await getViewer(id)
  if (!viewer || typeof orderId !== 'string') return NextResponse.json({ error: 'Bad request' }, { status: 400 })

  try {
    const order = await captureOrder(orderId)
    const unit = order.purchase_units[0]
    const capture = unit?.payments?.captures?.[0]
    if (!capture) return NextResponse.json({ error: 'PayPal returned no capture.' }, { status: 502 })
    // Only accept orders TrustPool created for this collective.
    const customId = capture.custom_id ?? unit.custom_id ?? ''
    if (!customId.startsWith(`${id}:`)) return NextResponse.json({ error: 'Order does not belong to this collective.' }, { status: 400 })

    const entry = await recordCaptureAttempt({ ...capture, custom_id: customId }, contributionCustomId(id, viewer.id))
    return NextResponse.json({ entryId: entry.id, status: entry.status, captureStatus: capture.status })
  } catch (e) {
    if (e instanceof PayPalError && e.body.includes('INSTRUMENT_DECLINED')) {
      return NextResponse.json({ error: 'Payment method was declined. Try another one.', retry: true }, { status: 422 })
    }
    const debugId = e instanceof PayPalError ? e.debugId : undefined
    return NextResponse.json({ error: 'PayPal could not complete the payment.', debugId }, { status: 502 })
  }
}
