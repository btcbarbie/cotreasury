import { createHash } from 'crypto'
import type { Prisma, PrismaClient } from '@prisma/client'
import { prisma } from './prisma'

// Tamper-evident activity log. Each event is "sealed": its hash covers its own
// content plus the previous event's hash. Changing, inserting or deleting any
// past event changes every hash after it, so verifyChain() catches it.

const GENESIS = '0'.repeat(64)

type Db = PrismaClient | Prisma.TransactionClient

export type AuditInput = {
  actor: string
  action: string
  summary: string
  data?: Record<string, unknown>
  at?: Date // only for importing historical (seed) events
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as object)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`)
      .join(',')}}`
  }
  return JSON.stringify(value ?? null)
}

function seal(e: { prevHash: string; seq: number; createdAt: Date; actor: string; action: string; summary: string; data: string }) {
  return createHash('sha256')
    .update([e.prevHash, e.seq, e.createdAt.toISOString(), e.actor, e.action, e.summary, e.data].join('\n'))
    .digest('hex')
}

async function append(db: Db, collectiveId: string, input: AuditInput) {
  const last = await db.auditEvent.findFirst({ where: { collectiveId }, orderBy: { seq: 'desc' } })
  const e = {
    collectiveId,
    seq: (last?.seq ?? 0) + 1,
    actor: input.actor,
    action: input.action,
    summary: input.summary,
    data: canonical(input.data ?? {}),
    createdAt: input.at ?? new Date(),
    prevHash: last?.hash ?? GENESIS,
  }
  return db.auditEvent.create({ data: { ...e, hash: seal(e) } })
}

/**
 * Append an event. Pass `tx` to seal it inside the same transaction as the
 * change it describes; otherwise it runs in its own transaction so concurrent
 * writers can't both claim the same sequence number.
 */
export async function recordEvent(collectiveId: string, input: AuditInput, tx?: Prisma.TransactionClient) {
  if (tx) return append(tx, collectiveId, input)
  return prisma.$transaction((t) => append(t, collectiveId, input))
}

export type ChainCheck = { ok: true; count: number; head: string | null } | { ok: false; count: number; brokenAt: number; reason: string }

export async function verifyChain(collectiveId: string): Promise<ChainCheck> {
  const events = await prisma.auditEvent.findMany({ where: { collectiveId }, orderBy: { seq: 'asc' } })
  let prev = GENESIS
  for (let i = 0; i < events.length; i++) {
    const e = events[i]
    if (e.seq !== i + 1) return { ok: false, count: events.length, brokenAt: i + 1, reason: `Event #${i + 1} is missing.` }
    if (e.prevHash !== prev) return { ok: false, count: events.length, brokenAt: e.seq, reason: `Event #${e.seq} does not link to the one before it.` }
    if (seal(e) !== e.hash) return { ok: false, count: events.length, brokenAt: e.seq, reason: `Event #${e.seq} was changed after it was sealed.` }
    prev = e.hash
  }
  return { ok: true, count: events.length, head: events.at(-1)?.hash ?? null }
}
