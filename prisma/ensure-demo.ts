import { prisma } from '../src/lib/prisma'
import { backfillDemo, cleanUpDemoCopies, ensureDemoCollectives, RETIRED_DEMO_NAMES } from '../src/lib/demoData'

// Runs on every start. Replaces retired demo stories, seeds any showcase
// treasury that's missing, and makes sure each has a sealed history.
// Treasuries people created themselves are never touched.
async function main() {
  const retired = await prisma.collective.deleteMany({ where: { isDemo: true, name: { in: RETIRED_DEMO_NAMES } } })
  if (retired.count > 0) console.log(`Removed ${retired.count} retired demo treasuries`)
  const stale = await cleanUpDemoCopies(prisma)
  if (stale > 0) console.log(`Removed ${stale} private demo copies older than 30 days`)
  const created = await ensureDemoCollectives(prisma)
  if (created.length > 0) console.log('Seeded demo treasuries:', created.join(' | '))
  const demos = await prisma.collective.findMany({ where: { isDemo: true, demoOwner: null }, select: { id: true } })
  for (const d of demos) await backfillDemo(prisma, d.id)
}

main().finally(() => prisma.$disconnect())
