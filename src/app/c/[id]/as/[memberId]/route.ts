import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { viewerCookieName } from '@/lib/collectives'

// Demo entry point: "Open as Grace, admin". Sets the demo identity and lands on
// the treasury. Same cookie as the member switcher; not authentication.
export async function GET(_req: Request, ctx: RouteContext<'/c/[id]/as/[memberId]'>) {
  const { id, memberId } = await ctx.params
  const member = await prisma.member.findFirst({ where: { id: memberId, collectiveId: id } })
  // Relative Location: behind Railway's proxy req.url is the internal
  // http://localhost:8080 address, so an absolute redirect would leave the site.
  const res = new NextResponse(null, { status: 307, headers: { Location: `/c/${encodeURIComponent(id)}` } })
  if (member) res.cookies.set(viewerCookieName(id), member.id, { path: '/', sameSite: 'lax', httpOnly: true })
  return res
}
