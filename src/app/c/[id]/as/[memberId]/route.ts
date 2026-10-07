import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { viewerCookieName } from '@/lib/collectives'

// Demo entry point: "Open as Grace, admin". Sets the demo identity and lands on
// the treasury. Same cookie as the member switcher; not authentication.
export async function GET(req: Request, ctx: RouteContext<'/c/[id]/as/[memberId]'>) {
  const { id, memberId } = await ctx.params
  const member = await prisma.member.findFirst({ where: { id: memberId, collectiveId: id } })
  const res = NextResponse.redirect(new URL(`/c/${id}`, req.url))
  if (member) res.cookies.set(viewerCookieName(id), member.id, { path: '/', sameSite: 'lax', httpOnly: true })
  return res
}
