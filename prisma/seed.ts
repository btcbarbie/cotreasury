import { prisma } from '../src/lib/prisma'
import { createDemoCollectives } from '../src/lib/demoData'

async function main() {
  await prisma.collective.deleteMany()
  const { scholarship, trip } = await createDemoCollectives(prisma)
  console.log('Seeded:', scholarship.name, scholarship.id, '|', trip.name, trip.id)
}

main().finally(() => prisma.$disconnect())
