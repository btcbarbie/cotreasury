import { randomBytes } from 'crypto'
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'
import { createDemoCopy, DEMO_ORDER } from '@/lib/demoData'
import { viewerCookieName, VISITOR_COOKIE } from '@/lib/collectives'

// Every browser gets its own private copy of each demo, so one visitor's
// approvals, departures or closings never change what another visitor sees.
// /demo/LISBON opens this browser's copy (made on first visit); ?as=admin
// opens it as the admin.
export async function GET(req: Request, ctx: RouteContext<'/demo/[key]'>) {
  const { key } = await ctx.params
  const demoKey = key.toUpperCase()
  if (!DEMO_ORDER.includes(demoKey)) return new NextResponse('Unknown demo', { status: 404 })

  const jar = await cookies()
  let visitor = jar.get(VISITOR_COOKIE)?.value
  const fresh = !visitor
  visitor ??= randomBytes(16).toString('hex')

  let copy = fresh ? null : await prisma.collective.findFirst({ where: { isDemo: true, demoKey, demoOwner: visitor }, include: { members: true } })
  const created = !copy
  if (!copy) {
    const made = await createDemoCopy(prisma, demoKey, visitor)
    if (!made) return new NextResponse('Unknown demo', { status: 404 })
    copy = made
  }

  // Relative Location: behind Railway's proxy req.url points at localhost.
  const res = new NextResponse(null, { status: 307, headers: { Location: `/c/${encodeURIComponent(copy.id)}` } })
  if (fresh) res.cookies.set(VISITOR_COOKIE, visitor, { path: '/', sameSite: 'lax', httpOnly: true, maxAge: 60 * 60 * 24 * 30 })
  const admin = copy.members.find((m) => m.role === 'ADMIN')
  if (admin && (created || new URL(req.url, 'http://x').searchParams.get('as') === 'admin')) {
    res.cookies.set(viewerCookieName(copy.id), admin.id, { path: '/', sameSite: 'lax', httpOnly: true })
  }
  return res
}
