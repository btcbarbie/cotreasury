import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCaptureDetail, getPayoutItem, PayPalError } from '@/lib/paypal'

export type Receipt = {
  kind: 'CAPTURE' | 'PAYOUT_ITEM'
  transactionId: string
  status: string
  amount: string
  fee: string | null
  net: string | null
  counterparty: string | null
  createdAt: string | null
  updatedAt: string | null
  related: { label: string; value: string }[]
}

const money = (m?: { value: string; currency_code?: string; currency?: string }) => (m ? `${m.value} ${m.currency_code ?? m.currency ?? ''}`.trim() : null)

// A ledger row's receipt is PayPal's own record of the transaction, fetched
// live from PayPal's API, not anything CoTreasury stored itself.
export async function GET(_req: Request, ctx: RouteContext<'/api/ledger/[entryId]/receipt'>) {
  const { entryId } = await ctx.params
  const entry = await prisma.ledgerEntry.findUnique({ where: { id: entryId }, include: { collective: { select: { paypalAccount: true } } } })
  if (!entry) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!entry.paypalRef || entry.source === 'IMPORTED') {
    return NextResponse.json({ error: 'This entry was imported from earlier records, so PayPal has no receipt for it.' }, { status: 404 })
  }
  try {
    if (entry.type === 'CONTRIBUTION') {
      const c = await getCaptureDetail(entry.paypalRef, entry.collective.paypalAccount)
      const r: Receipt = {
        kind: 'CAPTURE',
        transactionId: c.id,
        status: c.status,
        amount: money(c.amount)!,
        fee: money(c.seller_receivable_breakdown?.paypal_fee),
        net: money(c.seller_receivable_breakdown?.net_amount),
        counterparty: entry.counterparty,
        createdAt: c.create_time ?? null,
        updatedAt: c.update_time ?? null,
        related: [
          ...(c.supplementary_data?.related_ids?.order_id ? [{ label: 'PayPal order', value: c.supplementary_data.related_ids.order_id }] : []),
          ...(c.custom_id ? [{ label: 'Reference', value: 'CoTreasury contribution' }] : []),
        ],
      }
      return NextResponse.json(r)
    }
    if (entry.type === 'PAYOUT') {
      const i = await getPayoutItem(entry.paypalRef, entry.collective.paypalAccount)
      const r: Receipt = {
        kind: 'PAYOUT_ITEM',
        transactionId: i.transaction_id ?? i.payout_item_id,
        status: i.transaction_status,
        amount: money(i.payout_item?.amount)!,
        fee: money(i.payout_item_fee),
        net: null,
        counterparty: i.payout_item?.receiver ?? entry.counterparty,
        createdAt: i.time_processed ?? null,
        updatedAt: null,
        related: [
          { label: 'Payout batch', value: i.payout_batch_id },
          { label: 'Payout item', value: i.payout_item_id },
        ],
      }
      return NextResponse.json(r)
    }
    return NextResponse.json({ error: 'No PayPal receipt for this kind of entry.' }, { status: 404 })
  } catch (e) {
    const status = e instanceof PayPalError ? e.status : 502
    return NextResponse.json({ error: 'PayPal did not return this transaction.', debugId: e instanceof PayPalError ? e.debugId : undefined }, { status: status === 404 ? 404 : 502 })
  }
}
