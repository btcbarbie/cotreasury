import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getViewer } from '@/lib/collectives'
import { createOrder, PayPalError } from '@/lib/paypal'
import { contributionCustomId } from '@/lib/ledger'
import { treasuryLock } from '@/lib/exit'

const MIN_CENTS = 100
const MAX_CENTS = 1_000_000

export async function POST(req: Request, ctx: RouteContext<'/api/collectives/[id]/contribute/order'>) {
  const { id } = await ctx.params
  const { amountCents, goalId } = (await req.json()) as { amountCents: number; goalId?: string | null }
  if (!Number.isInteger(amountCents) || amountCents < MIN_CENTS || amountCents > MAX_CENTS) {
    return NextResponse.json({ error: 'Enter an amount between $1 and $10,000.' }, { status: 400 })
  }
  const collective = await prisma.collective.findUnique({ where: { id }, include: { goals: true } })
  const viewer = await getViewer(id)
  if (!collective || !viewer) return NextResponse.json({ error: 'Collective not found' }, { status: 404 })
  const locked = await treasuryLock(id)
  if (locked) return NextResponse.json({ error: locked }, { status: 409 })
  const goal = goalId ? collective.goals.find((g) => g.id === goalId) : null
  if (goalId && !goal) return NextResponse.json({ error: 'That goal does not exist.' }, { status: 400 })

  try {
    const order = await createOrder({
      amountCents,
      currency: collective.currency,
      customId: contributionCustomId(collective.id, viewer.id, goal?.id),
      description: goal ? `${goal.title}: ${collective.name}` : `Contribution to ${collective.name}`,
    })
    return NextResponse.json({ orderId: order.id })
  } catch (e) {
    const debugId = e instanceof PayPalError ? e.debugId : undefined
    return NextResponse.json({ error: 'PayPal could not create the order.', debugId }, { status: 502 })
  }
}
