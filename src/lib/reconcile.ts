import { prisma } from './prisma'
import { recordEvent } from './audit'
import { formatMoney } from './money'
import { searchTransactions, type AccountTransaction } from './paypal'

// The outside-activity check. CoTreasury only moves money through its own
// governed flows, but whoever owns the PayPal login could also act directly in
// PayPal. So we read the account's full history from PayPal (Transaction Search)
// and compare it with the ledger: anything PayPal shows that CoTreasury didn't
// do becomes a red "unapproved movement" row, and every member is notified.

const MIN_INTERVAL_MS = 2 * 60 * 1000
const WINDOW_MS = 31 * 24 * 60 * 60 * 1000 // PayPal's maximum search range
const DAY = 24 * 60 * 60 * 1000
const NEW_TREASURY_MS = 3 * DAY

/**
 * PayPal event codes that move money: T00xx payments sent or received, T03xx
 * bank deposits into PayPal, T04xx withdrawals to a bank. Holds, releases,
 * fees and adjustments are PayPal bookkeeping, not money changing hands.
 */
function movesMoney(code: string) {
  return /^T0[034]/.test(code)
}

function describe(t: AccountTransaction['transaction_info'], incoming: boolean) {
  if (t.transaction_event_code.startsWith('T04')) return 'Withdrawal to a bank account'
  if (t.transaction_event_code.startsWith('T03')) return 'Deposit from a bank account'
  return incoming ? 'Payment received in PayPal' : 'Payment sent from PayPal'
}

export type ReconcileResult = { checked: boolean; flagged: number; reason?: string }

/** Compare the group's PayPal history with its ledger. Throttled unless `force`. */
export async function reconcile(collectiveId: string, { force = false } = {}): Promise<ReconcileResult> {
  const c = await prisma.collective.findUnique({
    where: { id: collectiveId },
    select: { id: true, currency: true, paypalAccount: true, paypalMonitorSince: true, lastReconciledAt: true, createdAt: true },
  })
  if (!c) return { checked: false, flagged: 0, reason: 'not found' }
  // Groups without their own keys use the shared account; it's checked too, so
  // every treasury on it sees money moved there outside CoTreasury.
  const now = new Date()
  if (!force && c.lastReconciledAt && now.getTime() - c.lastReconciledAt.getTime() < MIN_INTERVAL_MS) {
    return { checked: false, flagged: 0, reason: 'checked recently' }
  }
  // First run: a new treasury is watched from the moment it was created; an
  // older one from now (what happened before is the account's past).
  if (!c.paypalMonitorSince) {
    const isNew = now.getTime() - c.createdAt.getTime() < NEW_TREASURY_MS
    c.paypalMonitorSince = isNew ? c.createdAt : now
    await prisma.collective.update({ where: { id: c.id }, data: { paypalMonitorSince: c.paypalMonitorSince, lastReconciledAt: now } })
    if (!isNew) return { checked: true, flagged: 0 }
    c.lastReconciledAt = now
  }
  // Claim this run so two page loads don't both check.
  const claimed = await prisma.collective.updateMany({
    where: { id: c.id, OR: [{ lastReconciledAt: null }, { lastReconciledAt: c.lastReconciledAt }] },
    data: { lastReconciledAt: now },
  })
  if (claimed.count === 0 && !force) return { checked: false, flagged: 0, reason: 'already running' }

  // PayPal's history runs behind real time and rejects a start date it hasn't
  // caught up to yet, so always ask for the full window and filter dates here.
  const since = c.paypalMonitorSince
  const history = await searchTransactions(new Date(now.getTime() - WINDOW_MS), now, c.paypalAccount)

  const entries = await prisma.ledgerEntry.findMany({
    where: { collectiveId: c.id },
    select: { id: true, type: true, amountCents: true, createdAt: true, paypalRef: true, paypalTxnId: true },
  })
  const known = new Set(entries.flatMap((e) => [e.paypalRef, e.paypalTxnId]).filter(Boolean) as string[])
  // Another treasury on the same PayPal account (e.g. one a visitor created on
  // the original account) moved this money through CoTreasury: not outside activity.
  const elsewhere = await prisma.ledgerEntry.findMany({
    where: { collectiveId: { not: c.id }, OR: [{ paypalRef: { not: null } }, { paypalTxnId: { not: null } }] },
    select: { paypalRef: true, paypalTxnId: true },
  })
  for (const e of elsewhere) for (const id of [e.paypalRef, e.paypalTxnId]) if (id) known.add(id)
  // Older payouts may not have PayPal's transaction id yet: match those by amount and date.
  const unlinkedPayouts = entries.filter((e) => e.type === 'PAYOUT' && !e.paypalTxnId)

  // When the account is short, PayPal tops it up from the linked bank (T03xx)
  // to fund a payment in the same moment. That top-up is part of the payment,
  // not a separate movement, so only the payment itself is shown.
  const cents = (t: AccountTransaction['transaction_info']) => Math.round(parseFloat(t.transaction_amount.value) * 100)
  const fundsAPayment = (t: AccountTransaction['transaction_info']) =>
    t.transaction_event_code.startsWith('T03') &&
    history.some(({ transaction_info: o }) =>
      o.transaction_event_code.startsWith('T00') &&
      cents(o) === -cents(t) &&
      Math.abs(new Date(o.transaction_initiation_date).getTime() - new Date(t.transaction_initiation_date).getTime()) < 5 * 60 * 1000,
    )

  let flagged = 0
  for (const { transaction_info: t, payer_info } of history) {
    if (!movesMoney(t.transaction_event_code) || !['S', 'P'].includes(t.transaction_status)) continue
    if (known.has(t.transaction_id) || fundsAPayment(t)) continue
    const value = parseFloat(t.transaction_amount.value)
    const cents = Math.round(Math.abs(value) * 100)
    const at = new Date(t.transaction_initiation_date)
    if (at < since) continue // before monitoring started: the account's past

    if (t.transaction_event_code === 'T0001') {
      const i = unlinkedPayouts.findIndex((e) => e.amountCents === cents && Math.abs(e.createdAt.getTime() - at.getTime()) < 3 * DAY)
      if (i >= 0) {
        await prisma.ledgerEntry.update({ where: { id: unlinkedPayouts[i].id }, data: { paypalTxnId: t.transaction_id } })
        unlinkedPayouts.splice(i, 1)
        continue
      }
    }

    const incoming = value > 0
    const label = describe(t, incoming)
    const who = payer_info?.payer_name?.alternate_full_name ?? payer_info?.email_address ?? t.transaction_subject ?? null
    const entry = await prisma.ledgerEntry.create({
      data: {
        collectiveId: c.id,
        type: 'UNAPPROVED_MOVEMENT',
        direction: incoming ? 'IN' : 'OUT',
        amountCents: cents,
        status: 'CONFIRMED', // it really happened: PayPal says so
        source: 'PAYPAL_API',
        memo: `${label}, outside CoTreasury`,
        counterparty: who,
        paypalRef: t.transaction_id,
        paypalTxnId: t.transaction_id,
        createdAt: at,
        confirmedAt: now,
      },
    })
    known.add(t.transaction_id)
    flagged++
    await recordEvent(c.id, {
      actor: 'CoTreasury',
      action: 'UNAPPROVED_MOVEMENT',
      summary: `found ${formatMoney(cents, c.currency, { cents: true })} ${incoming ? 'coming into' : 'leaving'} the group's PayPal account that wasn't made through CoTreasury (${label.charAt(0).toLowerCase() + label.slice(1)}${who ? `, ${who}` : ''}). Nobody approved it here`,
      data: { entryId: entry.id, transactionId: t.transaction_id, eventCode: t.transaction_event_code, amountCents: cents },
    })
  }
  return { checked: true, flagged }
}

/** Fire-and-forget check on page view: never slows the page or breaks it. */
export function reconcileInBackground(collectiveId: string) {
  reconcile(collectiveId).catch((e) => console.error('Reconcile failed', e instanceof Error ? e.message : e))
}
