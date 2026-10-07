import { prisma } from '../src/lib/prisma'
import { createDemoCollectives } from '../src/lib/demoData'

async function main() {
  await prisma.collective.deleteMany()
  const { scholarship, booster } = await createDemoCollectives(prisma)
  console.log('Seeded:', scholarship.name, scholarship.id, '|', booster.name, booster.id)
}

main().finally(() => prisma.$disconnect())
