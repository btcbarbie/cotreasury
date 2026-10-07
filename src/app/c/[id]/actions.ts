'use server'

import { cookies } from 'next/headers'
import { refresh } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { viewerCookieName } from '@/lib/collectives'

// Demo-mode identity switch: lets a judge act as different members (e.g. three
// approvers) without separate logins. Not an authentication mechanism.
export async function switchViewer(collectiveId: string, memberId: string) {
  const member = await prisma.member.findFirst({ where: { id: memberId, collectiveId } })
  if (!member) throw new Error('Member not found')
  const jar = await cookies()
  jar.set(viewerCookieName(collectiveId), member.id, { path: '/', sameSite: 'lax', httpOnly: true })
}

/** Re-render the current collective page with fresh ledger data. */
export async function refreshCollective() {
  refresh()
}
