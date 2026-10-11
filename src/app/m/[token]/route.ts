import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'
import { MY_TREASURIES_COOKIE, viewerCookieName, VIEWER_COOKIE_OPTIONS } from '@/lib/collectives'

// A member's personal link: signs this browser in as them and opens the treasury.
// Relative Location headers: behind Railway's proxy req.url is an internal address.
export async function GET(_req: Request, ctx: RouteContext<'/m/[token]'>) {
  const { token } = await ctx.params
  const member = token
    ? await prisma.member.findFirst({ where: { accessToken: token, role: { not: 'FORMER' }, collective: { isDemo: false } } })
    : null
  if (!member) return new NextResponse(null, { status: 307, headers: { Location: '/link-invalid' } })
  if (!member.accessClaimed) await prisma.member.update({ where: { id: member.id }, data: { accessClaimed: true } })

  const jar = await cookies()
  const mine = [...new Set([...(jar.get(MY_TREASURIES_COOKIE)?.value ?? '').split(',').filter(Boolean), member.collectiveId])].slice(-20)
  const res = new NextResponse(null, { status: 307, headers: { Location: `/c/${encodeURIComponent(member.collectiveId)}` } })
  res.cookies.set(MY_TREASURIES_COOKIE, mine.join(','), VIEWER_COOKIE_OPTIONS)
  res.cookies.set(viewerCookieName(member.collectiveId), token, VIEWER_COOKIE_OPTIONS)
  return res
}
