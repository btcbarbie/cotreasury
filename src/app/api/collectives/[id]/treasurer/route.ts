import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { askTreasurer } from '@/lib/treasurer'
import { randomBytes } from 'crypto'
import { cookies } from 'next/headers'
import { canAccess, getViewer, VISITOR_COOKIE } from '@/lib/collectives'
import { take } from '@/lib/rateLimit'

const AI_PER_HOUR = 20
const HOUR = 60 * 60 * 1000

export const maxDuration = 60

export async function POST(req: Request, ctx: RouteContext<'/api/collectives/[id]/treasurer'>) {
  const { id } = await ctx.params
  // Private treasuries answer only their own members (checked before spending any AI allowance).
  if (!(await canAccess(id))) return NextResponse.json({ error: 'Collective not found' }, { status: 404 })

  // 20 questions an hour per visitor (cookie), with a looser backstop per network
  // address so clearing cookies doesn't remove the limit.
  const jar = await cookies()
  let visitor = jar.get(VISITOR_COOKIE)?.value
  const newVisitor = !visitor
  visitor ??= randomBytes(16).toString('hex')
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local'
  const byVisitor = take(`ai:v:${visitor}`, AI_PER_HOUR, HOUR)
  const byIp = byVisitor.ok ? take(`ai:ip:${ip}`, AI_PER_HOUR * 3, HOUR) : byVisitor
  if (!byVisitor.ok || !byIp.ok) {
    const retryAt = !byVisitor.ok ? byVisitor.retryAt : (byIp as { retryAt: number }).retryAt
    const minutes = Math.max(1, Math.ceil((retryAt - Date.now()) / 60_000))
    return NextResponse.json(
      { error: `You’ve asked ${AI_PER_HOUR} questions this hour. You can ask again in ${minutes} minute${minutes === 1 ? '' : 's'}.`, code: 'rate_limited' },
      { status: 429 },
    )
  }
  const withVisitor = (res: NextResponse) => {
    if (newVisitor) res.cookies.set(VISITOR_COOKIE, visitor, { path: '/', sameSite: 'lax', httpOnly: true, maxAge: 60 * 60 * 24 * 30 })
    return res
  }

  const { history } = (await req.json()) as { history: { role: 'user' | 'assistant'; content: string }[] }
  if (!Array.isArray(history) || history.length === 0 || history.at(-1)?.role !== 'user') {
    return NextResponse.json({ error: 'Ask a question.' }, { status: 400 })
  }
  if (!(await prisma.collective.findUnique({ where: { id }, select: { id: true } }))) {
    return NextResponse.json({ error: 'Collective not found' }, { status: 404 })
  }
  // Keep the conversation short and text-only; tool calls are re-run fresh each turn.
  const trimmed = history.slice(-8).map((m) => ({ role: m.role, content: String(m.content).slice(0, 2000) }))
  try {
    const viewer = await getViewer(id)
    return withVisitor(NextResponse.json(await askTreasurer(id, trimmed, viewer ? { id: viewer.id, name: viewer.name, role: viewer.role } : null)))
  } catch (e) {
    console.error('Treasurer error', e)
    // Say what kind of failure it was (never any credentials), so it can be diagnosed from the outside.
    const err = e as { status?: number; error?: { error?: { type?: string } }; name?: string }
    const code = err.status ? `anthropic_${err.status}${err.error?.error?.type ? `_${err.error.error.type}` : ''}` : (err.name ?? 'error')
    return NextResponse.json({ error: 'The Treasurer is unavailable right now.', code }, { status: 502 })
  }
}
