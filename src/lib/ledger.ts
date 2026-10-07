import { prisma } from './prisma'
import type { PayPalCapture } from './paypal'
import { recordEvent } from './audit'
import { formatMoney } from './money'

// The only code paths allowed to change a contribution's status. A capture
// returned to the browser flow is recorded as PENDING; it becomes CONFIRMED
// only from a verified webhook or a server-side status check against PayPal.

// custom_id travels with the PayPal order and capture, so even a webhook-only
// contribution can be attributed: collective, member and (optional) goal.
export function contributionCustomId(collectiveId: string, memberId: string, goalId?: string | null) {
  return [collectiveId, memberId, goalId ?? ''].join(':')
}

function parseCustomId(customId: string | undefined) {
  const [collectiveId, memberId, goalId] = (customId ?? '').split(':')
  return collectiveId && memberId ? { collectiveId, memberId, goalId: goalId || null } : null
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
  if (!ids) throw new Error('Capture is missing CoTreasury custom_id')
  const existing = await prisma.ledgerEntry.findFirst({ where: { paypalRef: capture.id } })
  if (existing) return existing // webhook may have beaten us here

  const member = await prisma.member.findFirst({ where: { id: ids.memberId, collectiveId: ids.collectiveId } })
  const amountCents = Math.round(parseFloat(capture.amount.value) * 100)
  await recordEvent(ids.collectiveId, {
    actor: member?.name ?? 'A member',
    action: 'CONTRIBUTION_MADE',
    summary: `paid ${formatMoney(amountCents, capture.amount.currency_code, { cents: true })} via PayPal (waiting for PayPal to confirm)`,
    data: { captureId: capture.id, amountCents },
  })
  return prisma.ledgerEntry.create({
    data: {
      collectiveId: ids.collectiveId,
      memberId: member?.id,
      goalId: ids.goalId,
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
    await recordEvent(ids.collectiveId, {
      actor: 'PayPal',
      action: status === 'CONFIRMED' ? 'CONTRIBUTION_CONFIRMED' : 'CONTRIBUTION_PENDING',
      summary: `${status === 'CONFIRMED' ? 'confirmed' : 'received'} ${formatMoney(Math.round(parseFloat(capture.amount.value) * 100), capture.amount.currency_code, { cents: true })} from ${member.name}${source === 'PAYPAL_WEBHOOK' ? ' (verified webhook)' : ' (status check)'}`,
      data: { captureId: capture.id, source },
    })
    return prisma.ledgerEntry.create({
      data: {
        collectiveId: ids.collectiveId,
        memberId: member.id,
        goalId: ids.goalId,
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
  await recordEvent(existing.collectiveId, {
    actor: 'PayPal',
    action: status === 'CONFIRMED' ? 'CONTRIBUTION_CONFIRMED' : status === 'FAILED' ? 'CONTRIBUTION_DECLINED' : 'CONTRIBUTION_PENDING',
    summary: `${status === 'CONFIRMED' ? 'confirmed' : status === 'FAILED' ? 'declined' : 'is still processing'} ${formatMoney(existing.amountCents, 'USD', { cents: true })} from ${existing.counterparty ?? 'a member'}${source === 'PAYPAL_WEBHOOK' ? ' (verified webhook)' : ' (status check)'}`,
    data: { captureId: capture.id, entryId: existing.id, source },
  })
  return prisma.ledgerEntry.update({
    where: { id: existing.id },
    data: { status, source, confirmedAt: status === 'CONFIRMED' ? new Date() : null },
  })
}
