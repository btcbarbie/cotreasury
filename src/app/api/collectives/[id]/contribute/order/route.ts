import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getViewer } from '@/lib/collectives'
import { createOrder, PayPalError } from '@/lib/paypal'
import { contributionCustomId } from '@/lib/ledger'

const MIN_CENTS = 100
const MAX_CENTS = 1_000_000

export async function POST(req: Request, ctx: RouteContext<'/api/collectives/[id]/contribute/order'>) {
  const { id } = await ctx.params
  const { amountCents } = (await req.json()) as { amountCents: number }
  if (!Number.isInteger(amountCents) || amountCents < MIN_CENTS || amountCents > MAX_CENTS) {
    return NextResponse.json({ error: 'Enter an amount between $1 and $10,000.' }, { status: 400 })
  }
  const collective = await prisma.collective.findUnique({ where: { id } })
  const viewer = await getViewer(id)
  if (!collective || !viewer) return NextResponse.json({ error: 'Collective not found' }, { status: 404 })

  try {
    const order = await createOrder({
      amountCents,
      currency: collective.currency,
      customId: contributionCustomId(collective.id, viewer.id),
      description: `Contribution to ${collective.name}`,
    })
    return NextResponse.json({ orderId: order.id })
  } catch (e) {
    const debugId = e instanceof PayPalError ? e.debugId : undefined
    return NextResponse.json({ error: 'PayPal could not create the order.', debugId }, { status: 502 })
  }
}
