import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyWebhookSignature, type PayPalCapture } from '@/lib/paypal'
import { applyCaptureStatus } from '@/lib/ledger'

const CAPTURE_EVENTS = new Set(['PAYMENT.CAPTURE.COMPLETED', 'PAYMENT.CAPTURE.PENDING', 'PAYMENT.CAPTURE.DENIED'])

export async function POST(req: Request) {
  const raw = await req.text()
  let event: { id: string; event_type: string; resource: unknown }
  try {
    event = JSON.parse(raw)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // PayPal retries deliveries; the event id makes processing idempotent.
  const seen = await prisma.webhookEvent.findUnique({ where: { id: event.id } })
  if (seen?.processedAt) return NextResponse.json({ ok: true, duplicate: true })

  const verified = await verifyWebhookSignature(req.headers, raw).catch((e) => {
    console.error('Webhook verification error', e)
    return false
  })
  await prisma.webhookEvent.upsert({
    where: { id: event.id },
    create: { id: event.id, eventType: event.event_type, verified, payload: raw },
    update: { verified },
  })
  // Unverified events are stored for audit but never touch the ledger.
  if (!verified) return NextResponse.json({ error: 'Signature verification failed' }, { status: 401 })

  if (CAPTURE_EVENTS.has(event.event_type)) {
    await applyCaptureStatus(event.resource as PayPalCapture, 'PAYPAL_WEBHOOK')
  }

  await prisma.webhookEvent.update({ where: { id: event.id }, data: { processedAt: new Date() } })
  return NextResponse.json({ ok: true })
}
