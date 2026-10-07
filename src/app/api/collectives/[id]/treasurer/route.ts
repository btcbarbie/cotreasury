import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { askTreasurer } from '@/lib/treasurer'
import { getViewer } from '@/lib/collectives'

export const maxDuration = 60

export async function POST(req: Request, ctx: RouteContext<'/api/collectives/[id]/treasurer'>) {
  const { id } = await ctx.params
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
    return NextResponse.json(await askTreasurer(id, trimmed, viewer ? { id: viewer.id, name: viewer.name, role: viewer.role } : null))
  } catch (e) {
    console.error('Treasurer error', e)
    // Say what kind of failure it was (never any credentials), so it can be diagnosed from the outside.
    const err = e as { status?: number; error?: { error?: { type?: string } }; name?: string }
    const code = err.status ? `anthropic_${err.status}${err.error?.error?.type ? `_${err.error.error.type}` : ''}` : (err.name ?? 'error')
    return NextResponse.json({ error: 'The Treasurer is unavailable right now.', code }, { status: 502 })
  }
}
