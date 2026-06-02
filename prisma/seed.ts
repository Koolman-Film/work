/**
 * Seed script — bootstraps Koolman Work's initial reference data.
 *
 * Run: `pnpm db:seed`
 * Idempotent: safe to re-run; uses upserts keyed on natural unique fields.
 *
 * What it creates (W1c scope):
 *   - 1 Owner (Supabase auth.users + our User row)
 *   - 1 Admin (Supabase auth.users + our User row)
 *   - 2 Branches (HQ + 1 satellite)
 *   - 3 Departments
 *   - 2 AccountingGroups (per requirement.docx)
 *   - 3 LeaveTypes (ลาป่วย/ลากิจ/ลาพักร้อน)
 *   - 1 WorkSchedule (Tue–Sun 09:00–18:00)
 *   - Thai 2026 public holidays
 */

// biome-ignore-all lint/suspicious/noConsole: seed scripts are CLI tools — console is the output channel

import { PrismaClient } from '@prisma/client';
import { createClient } from '@supabase/supabase-js';

const prisma = new PrismaClient();

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

// ─── 🧠 USER CONTRIBUTION REQUESTED 🧠 ──────────────────────────────────────
//
// Fill these in with the real values for Koolman. These end up as:
//   - The login credentials for the first Owner + Admin (you'll log in with these
//     at /login after seeding)
//   - The branch names that show up in the admin UI
//
// The two AccountingGroup names come from requirement.docx and are pre-filled.
// The other fixed lists (LeaveTypes, Departments, WorkSchedule) are populated
// from the constants below — adjust if you know the customer prefers different
// names.
//
// Passwords are temporary — first thing the user should do after logging in
// is hit /reset-password (or change via Supabase dashboard).
// ────────────────────────────────────────────────────────────────────────────

const SEED = {
  owner: {
    email: 'owner@koolman.local', // TODO: replace with customer's owner email
    password: 'Owner_KMHR_temp_2026!', // TODO: rotate after first login
    displayName: 'Owner',
  },
  admin: {
    email: 'admin@koolman.local', // TODO: replace with HR admin email
    password: 'Admin_KMHR_temp_2026!',
    displayName: 'Admin',
  },
  branches: [
    { name: 'สำนักงานใหญ่', address: null }, // TODO: real address + lat/lng later
    { name: 'สาขา 2', address: null }, // TODO: replace with the real second branch name
  ],
  departments: [
    { name: 'ติดฟิล์ม', description: 'Installer team' },
    { name: 'บัญชี', description: 'Accounting' },
    { name: 'บริหาร', description: 'Management' },
  ],
  accountingGroups: [
    {
      name: 'ค่าใช้จ่ายบริษัท',
      peakCode: null,
      description: 'Company expense — direct salary cost',
    },
    {
      name: 'จ่ายแทน-รับคืน',
      peakCode: null,
      description: 'Paid on behalf — reimbursable, not a direct expense',
    },
  ],
  leaveTypes: [
    { name: 'ลาป่วย', isPaid: true, annualQuota: 30 }, // 30 days/year per Thai labor law
    { name: 'ลากิจ', isPaid: true, annualQuota: 3 },
    { name: 'ลาพักร้อน', isPaid: true, annualQuota: 6 }, // minimum per Thai labor law
  ],
  // Default schedule: Mon–Sat 09:00–18:00 with Sunday closed.
  // Per-day rows now live in WorkScheduleDay — `days` below is the
  // creation seed for those.
  workSchedule: {
    name: 'Mon–Sat 09:00–18:00',
    lateToleranceMin: 15,
    days: [
      { dayOfWeek: 1, startTime: '09:00', endTime: '18:00' }, // Mon
      { dayOfWeek: 2, startTime: '09:00', endTime: '18:00' }, // Tue
      { dayOfWeek: 3, startTime: '09:00', endTime: '18:00' }, // Wed
      { dayOfWeek: 4, startTime: '09:00', endTime: '18:00' }, // Thu
      { dayOfWeek: 5, startTime: '09:00', endTime: '18:00' }, // Fri
      { dayOfWeek: 6, startTime: '09:00', endTime: '18:00' }, // Sat
      // Sun (0) intentionally omitted — closed by default.
    ],
  },
  // Phase 2 W6 — Thai-labor-law payroll defaults. Admin will edit via
  // /admin/settings/payroll-config (Phase 3).
  payrollConfig: {
    ssoRate: '0.05',
    ssoSalaryCap: '15000',
    ssoAmountCap: '750',
    otMultiplier: '1.5',
    cutoffDay: 25,
    absentDeductionPerDay: '500',
    lateDeduction: '100',
    earlyLeaveDeduction: '100',
  },
  // Thai public holidays 2026 — official from Cabinet announcement.
  // Adjust isSubstitute if a date is a substitute day from a Mon-closed shift.
  holidays2026: [
    { date: '2026-01-01', name: 'วันขึ้นปีใหม่' },
    { date: '2026-01-02', name: 'วันหยุดเพิ่มเติม' },
    { date: '2026-02-12', name: 'วันมาฆบูชา' }, // observed
    { date: '2026-04-06', name: 'วันจักรี' },
    { date: '2026-04-13', name: 'วันสงกรานต์' },
    { date: '2026-04-14', name: 'วันสงกรานต์' },
    { date: '2026-04-15', name: 'วันสงกรานต์' },
    { date: '2026-05-01', name: 'วันแรงงาน' },
    { date: '2026-05-04', name: 'วันฉัตรมงคล' },
    { date: '2026-05-11', name: 'วันพืชมงคล' }, // observed
    { date: '2026-06-01', name: 'วันวิสาขบูชา' }, // observed
    { date: '2026-06-03', name: 'วันเฉลิมพระชนมพรรษาพระราชินี' },
    { date: '2026-07-28', name: 'วันเฉลิมพระชนมพรรษา ร.10' },
    { date: '2026-07-29', name: 'วันอาสาฬหบูชา' },
    { date: '2026-07-30', name: 'วันเข้าพรรษา' },
    { date: '2026-08-12', name: 'วันแม่แห่งชาติ' },
    { date: '2026-10-13', name: 'วันคล้ายวันสวรรคต ร.9' },
    { date: '2026-10-23', name: 'วันปิยมหาราช' },
    { date: '2026-12-05', name: 'วันพ่อแห่งชาติ' },
    { date: '2026-12-10', name: 'วันรัฐธรรมนูญ' },
    { date: '2026-12-31', name: 'วันสิ้นปี' },
  ],
};

// ─── Auth user helpers ─────────────────────────────────────────────────────

async function upsertAuthUser(email: string, password: string) {
  // Idempotent: if user exists with this email, return; else create.
  // Supabase admin API doesn't expose findByEmail directly — we use listUsers
  // and filter (works for our seed scale of ~5 users; would page for larger).
  const { data: list, error: listErr } = await supabaseAdmin.auth.admin.listUsers({
    page: 1,
    perPage: 200,
  });
  if (listErr) throw listErr;
  const existing = list.users.find((u) => u.email === email);
  if (existing) {
    console.log(`  auth.users: already exists  ${email} → ${existing.id}`);
    return existing.id;
  }
  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw error;
  console.log(`  auth.users: created          ${email} → ${data.user.id}`);
  return data.user.id;
}

/**
 * Idempotently assign a global (branchId = null) role to a user.
 *
 * Can't `upsert` on the compound unique `userId_roleId_branchId` for a global
 * assignment: Prisma rejects a null part of a compound-unique `where`, and in
 * Postgres NULLs are distinct so the unique wouldn't dedupe anyway. So we guard
 * with findFirst + create — safe to run on every seed.
 */
async function ensureGlobalRole(userId: string, roleId: string) {
  const existing = await prisma.userRoleAssignment.findFirst({
    where: { userId, roleId, branchId: null },
  });
  if (!existing) {
    await prisma.userRoleAssignment.create({ data: { userId, roleId, branchId: null } });
  }
}

// ─── Seed runner ───────────────────────────────────────────────────────────

async function main() {
  console.log('\n🌱 Seeding Koolman Work...\n');

  // 1. Departments
  console.log('Departments:');
  for (const d of SEED.departments) {
    const row = await prisma.department.upsert({
      where: { name: d.name },
      create: d,
      update: { description: d.description },
    });
    console.log(`  ✓ ${row.name}`);
  }

  // 2. AccountingGroups
  console.log('\nAccountingGroups:');
  for (const g of SEED.accountingGroups) {
    const row = await prisma.accountingGroup.upsert({
      where: { name: g.name },
      create: g,
      update: { description: g.description },
    });
    console.log(`  ✓ ${row.name}`);
  }

  // 3. Branches
  console.log('\nBranches:');
  for (const b of SEED.branches) {
    const row = await prisma.branch.upsert({
      where: { name: b.name },
      create: b,
      update: { address: b.address },
    });
    console.log(`  ✓ ${row.name}`);
  }

  // 4. LeaveTypes
  console.log('\nLeaveTypes:');
  for (const lt of SEED.leaveTypes) {
    const row = await prisma.leaveType.upsert({
      where: { name: lt.name },
      create: lt,
      update: { isPaid: lt.isPaid, annualQuota: lt.annualQuota },
    });
    console.log(`  ✓ ${row.name}  (paid=${row.isPaid}, quota=${row.annualQuota ?? '∞'})`);
  }

  // 5. WorkSchedule — no natural unique key; check by name.
  //    Now creates per-day rows via the WorkScheduleDay relation.
  console.log('\nWorkSchedule:');
  const existingSchedule = await prisma.workSchedule.findFirst({
    where: { name: SEED.workSchedule.name },
    include: { days: true },
  });
  const schedule = existingSchedule
    ? existingSchedule
    : await prisma.workSchedule.create({
        data: {
          name: SEED.workSchedule.name,
          lateToleranceMin: SEED.workSchedule.lateToleranceMin,
          days: {
            create: SEED.workSchedule.days,
          },
        },
        include: { days: true },
      });
  const daysSummary = schedule.days
    .sort((a, b) => a.dayOfWeek - b.dayOfWeek)
    .map(
      (d) =>
        `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.dayOfWeek]} ${d.startTime}-${d.endTime}`,
    )
    .join(', ');
  console.log(`  ✓ ${schedule.name}  [${daysSummary}]`);

  // 6. Holidays
  console.log('\nHolidays 2026:');
  for (const h of SEED.holidays2026) {
    const row = await prisma.holiday.upsert({
      where: { date: new Date(h.date) },
      create: { date: new Date(h.date), name: h.name },
      update: { name: h.name },
    });
    console.log(`  ✓ ${row.date.toISOString().slice(0, 10)}  ${row.name}`);
  }

  // 6b. PayrollConfig (singleton — only one row is ever created or
  // updated). Phase 2 calc engine reads this row to determine SSO rate,
  // attendance deduction amounts, etc. App treats absence of row as
  // configuration error; we always seed one.
  console.log('\nPayrollConfig:');
  const existingConfig = await prisma.payrollConfig.findFirst();
  const payrollConfig = existingConfig
    ? await prisma.payrollConfig.update({
        where: { id: existingConfig.id },
        data: SEED.payrollConfig,
      })
    : await prisma.payrollConfig.create({ data: SEED.payrollConfig });
  console.log(
    `  ✓ SSO ${payrollConfig.ssoRate}×base (cap ${payrollConfig.ssoAmountCap}), absent ${payrollConfig.absentDeductionPerDay}/day, late ${payrollConfig.lateDeduction}/event`,
  );

  // 7. System role definitions — idempotent. Mirror the migration 0009 seed.
  //    Fresh-DB seeds via this script should leave the system in the same
  //    state as a prod DB that ran migrations.
  console.log('\nRoleDefinitions:');
  const { SYSTEM_ROLES } = await import('../src/lib/auth/roles');
  for (const def of Object.values(SYSTEM_ROLES)) {
    const row = await prisma.roleDefinition.upsert({
      where: { key: def.key },
      create: {
        key: def.key,
        name: def.name,
        description: def.description,
        permissions: [...def.permissions],
        isSuperadmin: def.isSuperadmin,
        isSystem: true,
      },
      update: {
        name: def.name,
        description: def.description,
        // Keep the array in sync with code on every seed run. Custom
        // (non-system) roles are never touched here — we only upsert by
        // the system keys above.
        permissions: [...def.permissions],
        isSuperadmin: def.isSuperadmin,
      },
    });
    console.log(
      `  ✓ ${row.key}  (${row.permissions.length} perms, superadmin=${row.isSuperadmin})`,
    );
  }

  // 8. Superadmin + Admin users
  console.log('\nUsers:');
  const ownerAuthId = await upsertAuthUser(SEED.owner.email, SEED.owner.password);
  // Phase 4.6: User row carries only identity. Tier comes from the
  // UserRoleAssignment rows seeded below.
  const ownerUser = await prisma.user.upsert({
    where: { email: SEED.owner.email },
    create: {
      email: SEED.owner.email,
      authUserId: ownerAuthId,
    },
    update: { authUserId: ownerAuthId },
  });
  console.log(`  ✓ Superadmin User → ${ownerUser.id}  (email ${ownerUser.email})`);

  const adminAuthId = await upsertAuthUser(SEED.admin.email, SEED.admin.password);
  const adminUser = await prisma.user.upsert({
    where: { email: SEED.admin.email },
    create: {
      email: SEED.admin.email,
      authUserId: adminAuthId,
    },
    update: { authUserId: adminAuthId },
  });
  console.log(`  ✓ Admin User → ${adminUser.id}  (email ${adminUser.email})`);

  // 9. Seed UserRoleAssignment for the two system users.
  //    Superadmin: branch=NULL (global). Admin: branch=NULL for now
  //    (Phase 1 keeps existing semantics — global admins; Phase 2 admin
  //    UI lets per-branch scoping be assigned).
  console.log('\nUserRoleAssignments:');
  const superadminRole = await prisma.roleDefinition.findUniqueOrThrow({
    where: { key: 'superadmin' },
  });
  const adminRole = await prisma.roleDefinition.findUniqueOrThrow({ where: { key: 'admin' } });
  // Idempotent global (branchId=null) assignment. We can't `upsert` on the
  // compound unique `userId_roleId_branchId` here: Prisma rejects a null part
  // of a compound-unique `where`. NULLs are also distinct in Postgres uniques,
  // so we guard with findFirst + create instead.
  await ensureGlobalRole(ownerUser.id, superadminRole.id);
  console.log(`  ✓ ${ownerUser.email} → superadmin (global)`);
  await ensureGlobalRole(adminUser.id, adminRole.id);
  console.log(`  ✓ ${adminUser.email} → admin (global)`);

  console.log('\n✅ Seed complete.\n');
  console.log('🔐 Login credentials (CHANGE AFTER FIRST LOGIN):');
  console.log(`   Superadmin: ${SEED.owner.email}  /  ${SEED.owner.password}`);
  console.log(`   Admin:      ${SEED.admin.email}  /  ${SEED.admin.password}`);
  console.log('');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
