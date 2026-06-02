/**
 * Dev-only sample employees for local testing.
 *
 * Mirrors the createEmployee server action's write shape (User → Employee →
 * one staff UserRoleAssignment per branch), so the rows are indistinguishable
 * from UI-created ones. Idempotent: skips a sample if an employee with the same
 * first+last name already exists, so it's safe to re-run.
 *
 * Run:  npm run db:seed:employees   (uses .env.local — point it at LOCAL dev!)
 */

import { Prisma, PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

type Sample = {
  firstName: string;
  lastName: string;
  nickname?: string;
  salaryType: 'Monthly' | 'Daily' | 'Hourly';
  baseSalary: number;
  status: 'Probation' | 'Active' | 'Archived';
  hiredAt: string; // YYYY-MM-DD
};

const SAMPLES: Sample[] = [
  {
    firstName: 'สมชาย',
    lastName: 'ใจดี',
    nickname: 'ชาย',
    salaryType: 'Monthly',
    baseSalary: 25000,
    status: 'Active',
    hiredAt: '2024-03-01',
  },
  {
    firstName: 'สมหญิง',
    lastName: 'รักงาน',
    nickname: 'หญิง',
    salaryType: 'Monthly',
    baseSalary: 22000,
    status: 'Active',
    hiredAt: '2024-06-15',
  },
  {
    firstName: 'ปิติ',
    lastName: 'มั่นคง',
    nickname: 'ติ',
    salaryType: 'Daily',
    baseSalary: 500,
    status: 'Probation',
    hiredAt: '2026-05-01',
  },
  {
    firstName: 'มาลี',
    lastName: 'สวยงาม',
    nickname: 'ลี',
    salaryType: 'Monthly',
    baseSalary: 28000,
    status: 'Active',
    hiredAt: '2023-11-20',
  },
  {
    firstName: 'วีระ',
    lastName: 'กล้าหาญ',
    nickname: 'รา',
    salaryType: 'Hourly',
    baseSalary: 80,
    status: 'Active',
    hiredAt: '2025-01-10',
  },
  {
    firstName: 'นภา',
    lastName: 'ฟ้าใส',
    nickname: 'ปุย',
    salaryType: 'Monthly',
    baseSalary: 18000,
    status: 'Probation',
    hiredAt: '2026-04-15',
  },
  {
    firstName: 'ธนา',
    lastName: 'ทรัพย์ดี',
    nickname: 'โน้ต',
    salaryType: 'Monthly',
    baseSalary: 35000,
    status: 'Active',
    hiredAt: '2022-08-05',
  },
  {
    firstName: 'กานต์',
    lastName: 'ดีงาม',
    salaryType: 'Daily',
    baseSalary: 600,
    status: 'Active',
    hiredAt: '2024-09-30',
  },
  {
    firstName: 'ศิริพร',
    lastName: 'มงคล',
    nickname: 'ศิ',
    salaryType: 'Monthly',
    baseSalary: 20000,
    status: 'Active',
    hiredAt: '2025-02-18',
  },
  {
    firstName: 'อนงค์',
    lastName: 'พรหมมา',
    nickname: 'นงค์',
    salaryType: 'Monthly',
    baseSalary: 19000,
    status: 'Archived',
    hiredAt: '2021-07-01',
  },
];

async function main() {
  const [branches, departments, staffRole] = await Promise.all([
    prisma.branch.findMany({
      where: { archivedAt: null },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
    prisma.department.findMany({
      where: { archivedAt: null },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
    prisma.roleDefinition.findUnique({ where: { key: 'staff' }, select: { id: true } }),
  ]);

  if (branches.length === 0)
    throw new Error('No branches found — run the main seed (npm run db:seed) first.');
  if (!staffRole) throw new Error("System role 'staff' not found — DB seed corrupt?");

  console.log(`Seeding ${SAMPLES.length} sample employees across ${branches.length} branch(es)…\n`);
  let created = 0;
  let skipped = 0;

  for (const [i, s] of SAMPLES.entries()) {
    const existing = await prisma.employee.findFirst({
      where: { firstName: s.firstName, lastName: s.lastName },
      select: { id: true },
    });
    if (existing) {
      skipped++;
      console.log(`  skip (exists)  ${s.firstName} ${s.lastName}`);
      continue;
    }

    const branch = branches[i % branches.length];
    if (!branch) continue;
    const department =
      s.status === 'Archived' || departments.length === 0
        ? null
        : departments[i % departments.length];
    const archivedAt = s.status === 'Archived' ? new Date() : null;

    await prisma.$transaction(async (tx) => {
      const u = await tx.user.create({ data: {} });
      await tx.employee.create({
        data: {
          userId: u.id,
          firstName: s.firstName,
          lastName: s.lastName,
          nickname: s.nickname ?? null,
          branchId: branch.id,
          assignedBranchIds: [branch.id],
          departmentId: department?.id ?? null,
          salaryType: s.salaryType,
          baseSalary: new Prisma.Decimal(s.baseSalary),
          status: s.status,
          canCheckIn: s.status !== 'Archived',
          hiredAt: new Date(`${s.hiredAt}T00:00:00.000Z`),
          archivedAt,
        },
      });
      await tx.userRoleAssignment.create({
        data: { userId: u.id, roleId: staffRole.id, branchId: branch.id },
      });
    });

    created++;
    console.log(`  ✓ ${s.firstName} ${s.lastName}  → ${branch.name} · ${s.status}`);
  }

  console.log(`\n✅ Done. created=${created}, skipped=${skipped}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error('❌ seed-employees failed:', e);
    await prisma.$disconnect();
    process.exit(1);
  });
