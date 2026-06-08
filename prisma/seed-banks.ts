// biome-ignore-all lint/suspicious/noConsole: seed scripts are CLI tools — console is the output channel
/**
 * Standalone bank seeder — `pnpm db:seed:banks`.
 *
 * Reference data; safe (idempotent) to run against any environment. The
 * same `seedBanks` is also called from prisma/seed.ts main(), so a full
 * `pnpm db:seed` covers banks too.
 */

import { PrismaClient } from '@prisma/client';
import { seedBanks } from './seed-banks-data';

const prisma = new PrismaClient();

async function main() {
  const n = await seedBanks(prisma);
  console.log(`✅ Seeded ${n} banks.`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error('❌ seed-banks failed:', e);
    await prisma.$disconnect();
    process.exit(1);
  });
