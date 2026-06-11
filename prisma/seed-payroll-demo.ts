/**
 * Demo data for manually testing the payroll feature set (LOCAL DEV ONLY):
 *   - hasSso mix: most employees enrolled, two left off
 *   - PayrollAdjustments covering all three frequencies + edge cases
 *   - RecurringDeductions (deductDebt + monthsRemaining decrement on publish)
 *   - Current-month Absent/Late/EarlyLeave attendance rows
 *   - Approved un-deducted cash advances (sweep demo)
 *   - One over-quota leave deduction if an approved leave exists
 *
 * Idempotent-ish: tagged rows (note/reason prefixed "DEMO") are deleted and
 * re-created on each run; attendance uses skipDuplicates against the partial
 * unique (employeeId, date).
 *
 * Run: pnpm exec dotenv -e .env.local -- tsx prisma/seed-payroll-demo.ts
 */

// biome-ignore-all lint/suspicious/noConsole: seed scripts are CLI tools — console is the output channel

import { Prisma, PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const TAG = 'DEMO';

function bkkMonth(offset = 0): string {
  const now = new Date();
  const ym = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    timeZone: 'Asia/Bangkok',
  }).format(now);
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y as number, (m as number) - 1 + offset, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

async function main() {
  const month = bkkMonth(0);
  const prevMonth = bkkMonth(-1);
  const nextMonth = bkkMonth(1);
  const day = (n: number) => new Date(`${month}-${String(n).padStart(2, '0')}T00:00:00.000Z`);

  const employees = await prisma.employee.findMany({
    where: { status: { not: 'Archived' }, salaryType: 'Monthly' },
    orderBy: { firstName: 'asc' },
    select: { id: true, firstName: true, lastName: true, baseSalary: true },
  });
  if (employees.length < 5)
    throw new Error('Need ≥5 Monthly employees — run db:seed:employees first');
  const [e1, e2, e3, e4, e5, ...rest] = employees as [
    (typeof employees)[number],
    (typeof employees)[number],
    (typeof employees)[number],
    (typeof employees)[number],
    (typeof employees)[number],
    ...typeof employees,
  ];

  // ── 1. SSO mix: everyone enrolled except e4 + e5 ─────────────────────────
  await prisma.employee.updateMany({
    where: { id: { in: [e1.id, e2.id, e3.id, ...rest.map((e) => e.id)] } },
    data: { hasSso: true },
  });
  await prisma.employee.updateMany({
    where: { id: { in: [e4.id, e5.id] } },
    data: { hasSso: false },
  });

  // ── 2. Adjustments — wipe old demo rows, recreate ────────────────────────
  await prisma.payrollAdjustment.deleteMany({ where: { note: TAG } });
  await prisma.payrollAdjustment.createMany({
    data: [
      // e1: one-time commission THIS month (income, รายครั้ง)
      {
        employeeId: e1.id,
        kind: 'Income',
        reason: 'ค่าคอมมิชชั่นงานติดตั้ง',
        amount: new Prisma.Decimal('2500.50'),
        startMonth: month,
        endMonth: month,
        note: TAG,
      },
      // e1: open-ended monthly travel allowance (income, รายเดือน)
      {
        employeeId: e1.id,
        kind: 'Income',
        reason: 'ค่าเดินทางประจำเดือน',
        amount: new Prisma.Decimal('1000'),
        startMonth: prevMonth,
        endMonth: null,
        note: TAG,
      },
      // e2: date-range uniform deduction spanning prev→next month (เงินลด, ช่วงเวลา)
      {
        employeeId: e2.id,
        kind: 'Deduction',
        reason: 'หักค่าชุดฟอร์ม (3 งวด)',
        amount: new Prisma.Decimal('300'),
        startMonth: prevMonth,
        endMonth: nextMonth,
        note: TAG,
      },
      // e2: one-time bonus THIS month
      {
        employeeId: e2.id,
        kind: 'Income',
        reason: 'โบนัสยอดขาย',
        amount: new Prisma.Decimal('5000'),
        startMonth: month,
        endMonth: month,
        note: TAG,
      },
      // e3: HUGE one-time deduction → negative net (⚠ ติดลบ warning demo)
      {
        employeeId: e3.id,
        kind: 'Deduction',
        reason: 'หักชดใช้ค่าเสียหาย (ทดสอบยอดติดลบ)',
        amount: new Prisma.Decimal(e3.baseSalary.plus(5000).toFixed(2)),
        startMonth: month,
        endMonth: month,
        note: TAG,
      },
      // e4: starts NEXT month — must NOT appear in this month's run
      {
        employeeId: e4.id,
        kind: 'Income',
        reason: 'ค่าตำแหน่ง (เริ่มเดือนหน้า)',
        amount: new Prisma.Decimal('1500'),
        startMonth: nextMonth,
        endMonth: null,
        note: TAG,
      },
      // e5: ended LAST month — must NOT appear in this month's run
      {
        employeeId: e5.id,
        kind: 'Income',
        reason: 'ค่ากะพิเศษ (จบเดือนก่อน)',
        amount: new Prisma.Decimal('800'),
        startMonth: prevMonth,
        endMonth: prevMonth,
        note: TAG,
      },
    ],
  });

  // ── 3. Recurring deductions (เงินกู้/ผ่อน) ───────────────────────────────
  await prisma.recurringDeduction.deleteMany({ where: { reason: { startsWith: TAG } } });
  await prisma.recurringDeduction.createMany({
    data: [
      {
        employeeId: e1.id,
        reason: `${TAG} เงินกู้บริษัท`,
        monthlyAmount: new Prisma.Decimal('1500'),
        monthsRemaining: 3,
      },
      {
        employeeId: e2.id,
        reason: `${TAG} ผ่อนเครื่องมือช่าง`,
        monthlyAmount: new Prisma.Decimal('800'),
        monthsRemaining: 1,
      }, // → endedAt after one publish
    ],
  });

  // ── 4. Attendance events this month (flat-rate deductions) ──────────────
  const anyUser = await prisma.user.findFirst({ select: { id: true } });
  if (!anyUser) throw new Error('No User rows — run db:seed first');
  const createdById = anyUser.id;
  await prisma.attendance.createMany({
    skipDuplicates: true, // partial unique (employeeId, date)
    data: [
      {
        employeeId: e1.id,
        date: day(2),
        type: 'Late',
        source: 'Manual',
        durationMinutes: 25,
        createdById,
      },
      { employeeId: e1.id, date: day(4), type: 'Absent', source: 'Manual', createdById },
      {
        employeeId: e2.id,
        date: day(3),
        type: 'EarlyLeave',
        source: 'Manual',
        durationMinutes: 45,
        createdById,
      },
      {
        employeeId: e2.id,
        date: day(8),
        type: 'Late',
        source: 'Manual',
        durationMinutes: 10,
        createdById,
      },
      { employeeId: e4.id, date: day(5), type: 'Absent', source: 'Manual', createdById },
      { employeeId: e4.id, date: day(9), type: 'Absent', source: 'Manual', createdById },
    ],
  });

  // ── 5. Approved, un-deducted cash advances (sweep demo) ──────────────────
  await prisma.cashAdvance.deleteMany({ where: { deleteReason: TAG, isDeducted: false } });
  await prisma.cashAdvance.createMany({
    data: [
      {
        employeeId: e1.id,
        amount: new Prisma.Decimal('3000'),
        status: 'Approved',
        approvedAt: new Date(),
        isDeducted: false,
      },
      {
        employeeId: e5.id,
        amount: new Prisma.Decimal('1200'),
        status: 'Approved',
        approvedAt: new Date(),
        isDeducted: false,
      },
    ],
  });

  // ── 6. Over-quota leave deduction on one approved leave, if any ──────────
  const approvedLeave = await prisma.leaveRequest.findFirst({
    where: { status: 'Approved', deductedInPayrollId: null, deletedAt: null, employeeId: e2.id },
  });
  const leaveTarget =
    approvedLeave ??
    (await prisma.leaveRequest.findFirst({
      where: { status: 'Approved', deductedInPayrollId: null, deletedAt: null },
    }));
  if (leaveTarget) {
    await prisma.leaveRequest.update({
      where: { id: leaveTarget.id },
      data: { deductAmount: new Prisma.Decimal('650') },
    });
  }

  console.log(`Seeded payroll demo for month ${month}:`);
  console.log(`  SSO ON : everyone except ${e4.firstName}, ${e5.firstName} (SSO OFF)`);
  console.log(
    `  e1=${e1.firstName}: commission 2,500.50 + monthly 1,000 + loan 1,500×3 + Late/Absent + advance 3,000`,
  );
  console.log(
    `  e2=${e2.firstName}: bonus 5,000 - uniform 300 (range) - installment 800 (last month) + EarlyLeave/Late${leaveTarget ? ' + leave deduct 650' : ''}`,
  );
  console.log(
    `  e3=${e3.firstName}: deduction ${e3.baseSalary.plus(5000).toFixed(2)} → NEGATIVE net`,
  );
  console.log(
    `  e4=${e4.firstName}: SSO off, 2×Absent, adjustment starts NEXT month (invisible now)`,
  );
  console.log(
    `  e5=${e5.firstName}: SSO off, advance 1,200, adjustment ended LAST month (invisible now)`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
