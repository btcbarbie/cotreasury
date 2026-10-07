import { prisma } from '../src/lib/prisma'
import { createDemoCollectives } from '../src/lib/demoData'

// Runs on every start: seeds the demo collectives only when the database is empty.
async function main() {
  if ((await prisma.collective.count()) > 0) return
  const { scholarship, booster } = await createDemoCollectives(prisma)
  console.log('Seeded demo collectives:', scholarship.name, '|', booster.name)
}

main().finally(() => prisma.$disconnect())
