import { prisma } from '../src/lib/prisma'
import { backfillDemo, createDemoCollectives } from '../src/lib/demoData'

const DEMO_NAMES = ['Whitmore Family Scholarship Fund', 'Westfield Eagles Booster Club']

// Runs on every start. Marks the seeded showcase treasuries as demos (for DBs
// created before the isDemo flag existed) and seeds them if none exist.
async function main() {
  await prisma.collective.updateMany({ where: { name: { in: DEMO_NAMES }, isDemo: false }, data: { isDemo: true } })
  const demos = await prisma.collective.findMany({ where: { isDemo: true }, select: { id: true } })
  if (demos.length > 0) {
    // Older databases: add goals and a sealed activity history if missing.
    for (const d of demos) await backfillDemo(prisma, d.id)
    return
  }
  const { scholarship, booster } = await createDemoCollectives(prisma)
  console.log('Seeded demo treasuries:', scholarship.name, '|', booster.name)
}

main().finally(() => prisma.$disconnect())
