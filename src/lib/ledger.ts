import { prisma } from './prisma'
import type { PayPalCapture } from './paypal'

// The only code paths allowed to change a contribution's status. A capture
// returned to the browser flow is recorded as PENDING; it becomes CONFIRMED
// only from a verified webhook or a server-side status check against PayPal.

export function contributionCustomId(collectiveId: string, memberId: string) {
  return `${collectiveId}:${memberId}`
}

function parseCustomId(customId: string | undefined) {
  const [collectiveId, memberId] = (customId ?? '').split(':')
  return collectiveId && memberId ? { collectiveId, memberId } : null
}

const STATUS_FROM_CAPTURE: Record<string, 'PENDING' | 'CONFIRMED' | 'FAILED'> = {
  COMPLETED: 'CONFIRMED',
  PENDING: 'PENDING',
  DECLINED: 'FAILED',
  FAILED: 'FAILED',
}

/** Record a capture the buyer just approved. Always PENDING until PayPal confirms. */
export async function recordCaptureAttempt(capture: PayPalCapture, fallbackCustomId: string) {
  const ids = parseCustomId(capture.custom_id ?? fallbackCustomId)
  if (!ids) throw new Error('Capture is missing TrustPool custom_id')
  const existing = await prisma.ledgerEntry.findFirst({ where: { paypalRef: capture.id } })
  if (existing) return existing // webhook may have beaten us here

  const member = await prisma.member.findFirst({ where: { id: ids.memberId, collectiveId: ids.collectiveId } })
  return prisma.ledgerEntry.create({
    data: {
      collectiveId: ids.collectiveId,
      memberId: member?.id,
      counterparty: member?.name,
      type: 'CONTRIBUTION',
      direction: 'IN',
      amountCents: Math.round(parseFloat(capture.amount.value) * 100),
      status: STATUS_FROM_CAPTURE[capture.status] === 'FAILED' ? 'FAILED' : 'PENDING',
      source: 'PAYPAL_API',
      memo: 'Contribution via PayPal',
      paypalRef: capture.id,
    },
  })
}

/** Apply PayPal's authoritative view of a capture (from a verified webhook or a direct status check). */
export async function applyCaptureStatus(capture: PayPalCapture, source: 'PAYPAL_WEBHOOK' | 'PAYPAL_API') {
  const status = STATUS_FROM_CAPTURE[capture.status]
  if (!status) return null
  const existing = await prisma.ledgerEntry.findFirst({ where: { paypalRef: capture.id } })

  if (!existing) {
    // Buyer closed the tab before our capture call returned: the webhook still lands the money.
    const ids = parseCustomId(capture.custom_id)
    if (!ids) return null
    const member = await prisma.member.findFirst({ where: { id: ids.memberId, collectiveId: ids.collectiveId } })
    if (!member) return null
    return prisma.ledgerEntry.create({
      data: {
        collectiveId: ids.collectiveId,
        memberId: member.id,
        counterparty: member.name,
        type: 'CONTRIBUTION',
        direction: 'IN',
        amountCents: Math.round(parseFloat(capture.amount.value) * 100),
        status,
        source,
        memo: 'Contribution via PayPal',
        paypalRef: capture.id,
        confirmedAt: status === 'CONFIRMED' ? new Date() : null,
      },
    })
  }

  if (existing.status === status) return existing
  if (existing.status === 'CONFIRMED') return existing // never downgrade a confirmed entry here
  return prisma.ledgerEntry.update({
    where: { id: existing.id },
    data: { status, source, confirmedAt: status === 'CONFIRMED' ? new Date() : null },
  })
}
