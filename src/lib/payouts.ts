import { prisma } from './prisma'
import { computeTreasury } from './treasury'
import { formatMoney } from './money'
import { createPayoutBatch, getPayoutBatch, PayPalError, type PayoutItem } from './paypal'

// Approved spending → PayPal Payouts. The only code path that moves money out.
// Recipient and ledger state change only from PayPal's own answers: the batch
// response, verified payout webhooks, or a server-side batch lookup.

type ItemOutcome = { recipient: 'SENT' | 'SUCCEEDED' | 'UNCLAIMED' | 'FAILED' | 'RETURNED'; ledger: 'PENDING' | 'CONFIRMED' | 'FAILED' }

// UNCLAIMED: PayPal has already debited the treasury and holds the money until
// the recipient claims it (or returns it after 30 days), so the ledger counts it as out.
const OUTCOME: Record<string, ItemOutcome> = {
  SUCCESS: { recipient: 'SUCCEEDED', ledger: 'CONFIRMED' },
  UNCLAIMED: { recipient: 'UNCLAIMED', ledger: 'CONFIRMED' },
  FAILED: { recipient: 'FAILED', ledger: 'FAILED' },
  DENIED: { recipient: 'FAILED', ledger: 'FAILED' },
  BLOCKED: { recipient: 'FAILED', ledger: 'FAILED' },
  REFUNDED: { recipient: 'RETURNED', ledger: 'FAILED' },
  REVERSED: { recipient: 'RETURNED', ledger: 'FAILED' },
  RETURNED: { recipient: 'RETURNED', ledger: 'FAILED' },
}

/**
 * Send an APPROVED spend request to PayPal. Safe to call more than once: the
 * APPROVED → EXECUTING transition is atomic, so only one caller ever sends.
 */
export async function executePayout(proposalId: string): Promise<{ ok: boolean; error?: string }> {
  const claimed = await prisma.proposal.updateMany({
    where: { id: proposalId, kind: 'SPEND', status: 'APPROVED' },
    data: { status: 'EXECUTING', executedAt: new Date(), failureReason: null, payoutAttempts: { increment: 1 } },
  })
  if (claimed.count === 0) return { ok: false, error: 'This request is not ready to pay out.' }

  const p = await prisma.proposal.findUniqueOrThrow({
    where: { id: proposalId },
    include: { recipients: true, collective: { include: { entries: true, proposals: true } } },
  })
  const c = p.collective

  // Final money check against the ledger. This request's own amount sits in
  // "committed" until a moment ago, so measure confirmed balance minus other outflows.
  const t = computeTreasury(c.entries, c.proposals.filter((x) => x.id !== p.id))
  if (p.amountCents > t.confirmedBalanceCents - t.pendingOutCents - t.committedCents) {
    await fail(p.id, `Not enough confirmed money: needs ${formatMoney(p.amountCents, c.currency)}.`)
    return { ok: false, error: 'Not enough confirmed money in the treasury.' }
  }

  // One pending ledger row per recipient, visible before PayPal answers.
  for (const r of p.recipients) {
    await prisma.payoutRecipient.update({ where: { id: r.id }, data: { status: 'SENT' } })
    await prisma.ledgerEntry.create({
      data: {
        collectiveId: c.id,
        type: 'PAYOUT',
        direction: 'OUT',
        amountCents: r.amountCents,
        status: 'PENDING',
        source: 'PAYPAL_API',
        memo: p.title,
        counterparty: `${r.name} · ${r.receiver}`,
        proposalId: p.id,
        payoutRecipientId: r.id,
      },
    })
  }

  try {
    const batch = await createPayoutBatch({
      senderBatchId: `${p.id}-${p.payoutAttempts}`,
      subject: `${c.name}: ${p.title}`,
      message: `Approved by the ${c.name} collective via CoTreasury.`,
      currency: c.currency,
      items: p.recipients.map((r) => ({
        senderItemId: r.id,
        receiver: r.receiver,
        recipientType: r.receiverType,
        amountCents: r.amountCents,
        note: `${p.title} (${c.name})`,
      })),
    })
    await prisma.proposal.update({ where: { id: p.id }, data: { paypalBatchId: batch.batch_header.payout_batch_id } })
    return { ok: true }
  } catch (e) {
    const reason =
      e instanceof PayPalError
        ? (() => {
            try {
              const b = JSON.parse(e.body)
              return b.name === 'INSUFFICIENT_FUNDS' ? 'The PayPal account does not have enough funds.' : b.message || b.name
            } catch {
              return e.message
            }
          })()
        : (e as Error).message
    await fail(p.id, `PayPal rejected the payout: ${reason}`)
    return { ok: false, error: `PayPal rejected the payout: ${reason}` }
  }
}

async function fail(proposalId: string, reason: string) {
  await prisma.$transaction([
    prisma.proposal.update({ where: { id: proposalId }, data: { status: 'FAILED', failureReason: reason } }),
    prisma.payoutRecipient.updateMany({ where: { proposalId, status: { in: ['PENDING', 'SENT'] } }, data: { status: 'FAILED' } }),
    prisma.ledgerEntry.updateMany({ where: { proposalId, type: 'PAYOUT', status: 'PENDING' }, data: { status: 'FAILED' } }),
  ])
}

/** Apply PayPal's status for one payout item (from a verified webhook or a batch lookup). */
export async function applyPayoutItem(item: PayoutItem, source: 'PAYPAL_WEBHOOK' | 'PAYPAL_API') {
  const recipientId = item.payout_item?.sender_item_id
  const outcome = OUTCOME[item.transaction_status]
  if (!recipientId || !outcome) return
  const r = await prisma.payoutRecipient.findUnique({ where: { id: recipientId } })
  if (!r || r.status === outcome.recipient) return
  if (['SUCCEEDED', 'FAILED', 'RETURNED'].includes(r.status) && outcome.recipient !== 'RETURNED') return // terminal

  await prisma.$transaction([
    prisma.payoutRecipient.update({ where: { id: r.id }, data: { status: outcome.recipient, paypalItemId: item.payout_item_id } }),
    prisma.ledgerEntry.updateMany({
      where: { payoutRecipientId: r.id, type: 'PAYOUT' },
      data: {
        status: outcome.ledger,
        source,
        paypalRef: item.payout_item_id,
        confirmedAt: outcome.ledger === 'CONFIRMED' ? new Date() : null,
      },
    }),
  ])
  await finalize(r.proposalId)
}

/** Whole batch denied by PayPal (e.g. insufficient funds after submission). */
export async function applyBatchDenied(batchId: string) {
  const p = await prisma.proposal.findFirst({ where: { paypalBatchId: batchId } })
  if (p && p.status === 'EXECUTING') await fail(p.id, 'PayPal denied the payout batch.')
}

/** Close the request once every recipient has a final answer. */
async function finalize(proposalId: string) {
  const p = await prisma.proposal.findUnique({ where: { id: proposalId }, include: { recipients: true } })
  if (!p || p.status !== 'EXECUTING') return
  if (p.recipients.some((r) => r.status === 'SENT' || r.status === 'PENDING')) return
  const failed = p.recipients.filter((r) => r.status === 'FAILED' || r.status === 'RETURNED')
  await prisma.proposal.update({
    where: { id: p.id },
    data:
      failed.length === 0
        ? { status: 'COMPLETED' }
        : { status: 'FAILED', failureReason: `${failed.length} of ${p.recipients.length} payment${p.recipients.length > 1 ? 's' : ''} failed: ${failed.map((r) => r.name).join(', ')}` },
  })
}

/** Backup path when a webhook is late: ask PayPal for the batch and apply every item. */
export async function refreshPayoutBatch(proposalId: string) {
  const p = await prisma.proposal.findUnique({ where: { id: proposalId } })
  if (!p?.paypalBatchId || p.status !== 'EXECUTING') return
  const batch = await getPayoutBatch(p.paypalBatchId)
  if (batch.batch_header.batch_status === 'DENIED') return applyBatchDenied(p.paypalBatchId)
  for (const item of batch.items ?? []) await applyPayoutItem(item, 'PAYPAL_API')
}

/** Approver-triggered retry after PayPal rejected the whole batch (nothing was paid). */
export async function retryPayout(proposalId: string) {
  const p = await prisma.proposal.findUnique({ where: { id: proposalId }, include: { recipients: true } })
  if (!p || p.status !== 'FAILED' || p.kind !== 'SPEND') return { ok: false, error: 'Nothing to retry.' }
  if (p.recipients.some((r) => r.status === 'SUCCEEDED' || r.status === 'UNCLAIMED')) {
    return { ok: false, error: 'Some recipients were already paid; create a new request for the rest.' }
  }
  await prisma.$transaction([
    prisma.payoutRecipient.updateMany({ where: { proposalId }, data: { status: 'PENDING', paypalItemId: null } }),
    prisma.proposal.update({ where: { id: proposalId }, data: { status: 'APPROVED', failureReason: null, paypalBatchId: null } }),
  ])
  return executePayout(proposalId)
}
