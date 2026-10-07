import { prisma } from '../src/lib/prisma'
import { createDemoCollectives } from '../src/lib/demoData'

async function main() {
  await prisma.collective.deleteMany()
  const demos = await createDemoCollectives(prisma)
  console.log('Seeded:', demos.map((d) => `${d.name} ${d.id}`).join(' | '))
}

main().finally(() => prisma.$disconnect())
