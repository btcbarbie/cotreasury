import { prisma } from '../src/lib/prisma'
import { createDemoCollectives } from '../src/lib/demoData'

const DEMO_NAMES = ['Whitmore Family Scholarship Fund', 'Westfield Eagles Booster Club']

// Runs on every start. Marks the seeded showcase treasuries as demos (for DBs
// created before the isDemo flag existed) and seeds them if none exist.
async function main() {
  await prisma.collective.updateMany({ where: { name: { in: DEMO_NAMES }, isDemo: false }, data: { isDemo: true } })
  if ((await prisma.collective.count({ where: { isDemo: true } })) > 0) return
  const { scholarship, booster } = await createDemoCollectives(prisma)
  console.log('Seeded demo treasuries:', scholarship.name, '|', booster.name)
}

main().finally(() => prisma.$disconnect())
