import { prisma } from '../src/lib/prisma'
import { backfillDemo, createDemoCollectives, RETIRED_DEMO_NAMES } from '../src/lib/demoData'

// Runs on every start. Replaces retired demo stories, seeds the showcase
// treasuries if none exist, and makes sure each has a sealed history.
// Treasuries people created themselves are never touched.
async function main() {
  const retired = await prisma.collective.deleteMany({ where: { isDemo: true, name: { in: RETIRED_DEMO_NAMES } } })
  if (retired.count > 0) console.log(`Removed ${retired.count} retired demo treasuries`)
  const demos = await prisma.collective.findMany({ where: { isDemo: true }, select: { id: true } })
  if (demos.length > 0) {
    for (const d of demos) await backfillDemo(prisma, d.id)
    return
  }
  const { scholarship, trip } = await createDemoCollectives(prisma)
  console.log('Seeded demo treasuries:', scholarship.name, '|', trip.name)
}

main().finally(() => prisma.$disconnect())
