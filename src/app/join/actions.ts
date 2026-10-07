'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { admitMember } from '@/lib/members'
import { MY_TREASURIES_COOKIE, myTreasuryIds, viewerCookieName } from '@/lib/collectives'

/** Join a treasury through its invite link. Joiners are members; approving needs a governed rule change. */
export async function joinTreasury(code: string, input: { name: string; email: string }): Promise<{ ok: false; error: string }> {
  const collective = await prisma.collective.findFirst({ where: { inviteCode: code }, select: { id: true } })
  if (!collective) return { ok: false, error: 'This invite link has been reset or turned off. Ask the admin for a new one.' }
  const r = await admitMember(collective.id, input, { actor: input.name.trim(), action: 'MEMBER_JOINED', summary: () => 'joined the group through the invite link' })
  if (!r.ok) return r

  const jar = await cookies()
  const mine = [...new Set([...(await myTreasuryIds()), collective.id])].slice(-20)
  jar.set(MY_TREASURIES_COOKIE, mine.join(','), { path: '/', sameSite: 'lax', httpOnly: true, maxAge: 60 * 60 * 24 * 180 })
  jar.set(viewerCookieName(collective.id), r.memberId, { path: '/', sameSite: 'lax', httpOnly: true })
  redirect(`/c/${collective.id}?joined=1`)
}
