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
  workSchedule: {
    name: 'Tue–Sun 09:00–18:00',
    startTime: '09:00',
    endTime: '18:00',
    workDays: [2, 3, 4, 5, 6, 0], // Tue,Wed,Thu,Fri,Sat,Sun (Mon=1 closed)
    lateToleranceMin: 15,
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

  // 5. WorkSchedule — no natural unique key; check by name
  console.log('\nWorkSchedule:');
  const existingSchedule = await prisma.workSchedule.findFirst({
    where: { name: SEED.workSchedule.name },
  });
  const schedule = existingSchedule
    ? existingSchedule
    : await prisma.workSchedule.create({ data: SEED.workSchedule });
  console.log(
    `  ✓ ${schedule.name}  (${schedule.startTime}–${schedule.endTime}, days=${schedule.workDays.join(',')})`,
  );

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

  // 7. Owner + Admin
  // Supabase auth.users first, then our User row.
  console.log('\nUsers:');
  const ownerAuthId = await upsertAuthUser(SEED.owner.email, SEED.owner.password);
  const ownerUser = await prisma.user.upsert({
    where: { email: SEED.owner.email },
    create: {
      email: SEED.owner.email,
      authUserId: ownerAuthId,
      role: 'Owner',
    },
    update: { authUserId: ownerAuthId, role: 'Owner' },
  });
  console.log(`  ✓ Owner User → ${ownerUser.id}  (email ${ownerUser.email})`);

  const adminAuthId = await upsertAuthUser(SEED.admin.email, SEED.admin.password);
  const adminUser = await prisma.user.upsert({
    where: { email: SEED.admin.email },
    create: {
      email: SEED.admin.email,
      authUserId: adminAuthId,
      role: 'Admin',
    },
    update: { authUserId: adminAuthId, role: 'Admin' },
  });
  console.log(`  ✓ Admin User → ${adminUser.id}  (email ${adminUser.email})`);

  console.log('\n✅ Seed complete.\n');
  console.log('🔐 Login credentials (CHANGE AFTER FIRST LOGIN):');
  console.log(`   Owner: ${SEED.owner.email}  /  ${SEED.owner.password}`);
  console.log(`   Admin: ${SEED.admin.email}  /  ${SEED.admin.password}`);
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
