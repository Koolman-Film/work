/**
 * Dev-only sample leave requests + cash advances for local testing.
 *
 * Spreads realistic records across the 10 sample employees with VARIED
 * detail and status (Pending / Approved / Rejected / Cancelled), multiple
 * leave types, single- and multi-day ranges, and past + future dates — so
 * the redesigned /admin/leave and /admin/advance inboxes (and their status
 * filters) have something to show.
 *
 * Reviewed records carry a reviewer (admin@koolman.local), a decision time,
 * and a note, mirroring what the approve/reject actions write. Approved
 * advances get approvedAt/approvedById but stay isDeducted=false (payroll
 * publish hasn't run). No attachment/receipt URLs are seeded — the local
 * stack has no Storage bucket, so a key would render as a broken link.
 *
 * Idempotent: each record is keyed by (employee + date [+ amount/type]); a
 * re-run skips anything that already exists. Safe to run repeatedly.
 *
 * Run:  npm run db:seed:leave-advance   (uses .env.local — LOCAL dev only!)
 */

// biome-ignore-all lint/suspicious/noConsole: seed scripts are CLI tools — console is the output channel

import { Prisma, PrismaClient } from '@prisma/client';
import { segmentFor } from '../src/lib/leave/units';
import { expandHolidaysWithSubstitutes, workingDaysIn } from '../src/lib/leave/working-days';

const prisma = new PrismaClient();

const CFG_FALLBACK = {
  morningStart: '09:00',
  morningEnd: '12:00',
  afternoonStart: '13:00',
  afternoonEnd: '17:00',
};

/** Refuse to run against anything that isn't the local dev database. */
function assertLocalDb() {
  const url = process.env.DATABASE_URL ?? '';
  const isLocal =
    /(127\.0\.0\.1|localhost|@127|:54422)/.test(url) &&
    !/supabase\.co|bltjmjfznbxkgrrdbzci/.test(url);
  if (!isLocal) {
    throw new Error(
      `Refusing to seed: DATABASE_URL does not look local (${url.replace(/:[^:@/]+@/, ':***@')})`,
    );
  }
}

/** A date-only value for @db.Date columns (midnight UTC). */
function d(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}
/** A timestamp for DateTime columns. */
function ts(iso: string): Date {
  return new Date(`${iso}+07:00`);
}

type LeaveSeed = {
  empIndex: number;
  typeIndex: number; // index into the leave-type list (cycled)
  start: string; // YYYY-MM-DD
  end: string;
  status: 'Pending' | 'Approved' | 'Rejected' | 'Cancelled';
  reason: string;
  submitted: string; // createdAt date
  reviewedOn?: string; // reviewedAt date (Approved/Rejected)
  reviewNote?: string;
};

const LEAVE_SEEDS: LeaveSeed[] = [
  {
    empIndex: 0,
    typeIndex: 0,
    start: '2026-05-12',
    end: '2026-05-12',
    status: 'Approved',
    reason: 'เป็นไข้หวัด มีใบรับรองแพทย์ ขอพัก 1 วัน',
    submitted: '2026-05-11',
    reviewedOn: '2026-05-11',
    reviewNote: 'อนุมัติตามใบรับรองแพทย์',
  },
  {
    empIndex: 1,
    typeIndex: 2,
    start: '2026-06-15',
    end: '2026-06-19',
    status: 'Pending',
    reason: 'พาครอบครัวไปเที่ยวต่างจังหวัดช่วงปิดเทอม',
    submitted: '2026-06-01',
  },
  {
    empIndex: 2,
    typeIndex: 1,
    start: '2026-06-09',
    end: '2026-06-10',
    status: 'Pending',
    reason: 'ติดต่อราชการ ทำเอกสารที่อำเภอ',
    submitted: '2026-06-02',
  },
  {
    empIndex: 3,
    typeIndex: 0,
    start: '2026-04-20',
    end: '2026-04-22',
    status: 'Approved',
    reason: 'ป่วยโรคกระเพาะอาหารอักเสบ พักรักษาตัว 3 วัน',
    submitted: '2026-04-19',
    reviewedOn: '2026-04-19',
    reviewNote: 'อนุมัติ ขอให้ดูแลสุขภาพ',
  },
  {
    empIndex: 4,
    typeIndex: 1,
    start: '2026-05-28',
    end: '2026-05-28',
    status: 'Rejected',
    reason: 'ลากิจกะทันหัน',
    submitted: '2026-05-27',
    reviewedOn: '2026-05-27',
    reviewNote: 'ไม่อนุมัติ — แจ้งล่วงหน้าน้อยเกินไป และช่วงนี้มีงานเร่ง',
  },
  {
    empIndex: 5,
    typeIndex: 2,
    start: '2026-07-01',
    end: '2026-07-05',
    status: 'Pending',
    reason: 'พักร้อนประจำปี ใช้สิทธิ์คงเหลือ',
    submitted: '2026-06-02',
  },
  {
    empIndex: 6,
    typeIndex: 0,
    start: '2026-03-16',
    end: '2026-03-17',
    status: 'Approved',
    reason: 'ปวดหลังรุนแรง ไปหาหมอและพักผ่อน',
    submitted: '2026-03-15',
    reviewedOn: '2026-03-15',
    reviewNote: 'อนุมัติ',
  },
  {
    empIndex: 7,
    typeIndex: 1,
    start: '2026-06-06',
    end: '2026-06-06',
    status: 'Approved',
    reason: 'ไปร่วมงานแต่งงานของญาติที่ต่างจังหวัด',
    submitted: '2026-05-30',
    reviewedOn: '2026-05-31',
    reviewNote: 'อนุมัติ',
  },
  {
    empIndex: 8,
    typeIndex: 2,
    start: '2026-05-04',
    end: '2026-05-05',
    status: 'Cancelled',
    reason: 'ขอยกเลิกคำขอ เปลี่ยนแผนการเดินทาง',
    submitted: '2026-04-25',
  },
  {
    empIndex: 9,
    typeIndex: 0,
    start: '2026-06-02',
    end: '2026-06-03',
    status: 'Pending',
    reason: 'เป็นไข้ตัวร้อน ขอลาพักรักษาตัว',
    submitted: '2026-06-02',
  },
  {
    empIndex: 0,
    typeIndex: 1,
    start: '2026-02-10',
    end: '2026-02-11',
    status: 'Rejected',
    reason: 'ธุระส่วนตัวกับครอบครัว',
    submitted: '2026-02-08',
    reviewedOn: '2026-02-09',
    reviewNote: 'ไม่อนุมัติ — ติดประชุมสำคัญช่วงนั้น ขอเลื่อนวันลา',
  },
];

type AdvanceSeed = {
  empIndex: number;
  amount: number;
  requested: string; // YYYY-MM-DD
  status: 'Pending' | 'Approved' | 'Rejected' | 'Cancelled';
  approvedOn?: string; // approvedAt (Approved only)
};

const ADVANCE_SEEDS: AdvanceSeed[] = [
  {
    empIndex: 0,
    amount: 5000,
    requested: '2026-05-10',
    status: 'Approved',
    approvedOn: '2026-05-11',
  },
  { empIndex: 1, amount: 3000, requested: '2026-06-01', status: 'Pending' },
  { empIndex: 2, amount: 1500, requested: '2026-06-02', status: 'Pending' },
  {
    empIndex: 3,
    amount: 8000,
    requested: '2026-04-15',
    status: 'Approved',
    approvedOn: '2026-04-16',
  },
  { empIndex: 4, amount: 12000, requested: '2026-05-20', status: 'Rejected' },
  { empIndex: 5, amount: 2000, requested: '2026-06-03', status: 'Pending' },
  {
    empIndex: 6,
    amount: 6500,
    requested: '2026-03-25',
    status: 'Approved',
    approvedOn: '2026-03-26',
  },
  { empIndex: 7, amount: 4000, requested: '2026-05-05', status: 'Cancelled' },
  { empIndex: 8, amount: 10000, requested: '2026-05-18', status: 'Rejected' },
  {
    empIndex: 9,
    amount: 2500,
    requested: '2026-06-01',
    status: 'Approved',
    approvedOn: '2026-06-02',
  },
];

async function main() {
  assertLocalDb();

  // Reviewer (for Approved/Rejected decisions). The admin User row carries
  // the email; fall back to any user that holds a role assignment.
  const reviewer =
    (await prisma.user.findFirst({ where: { email: 'admin@koolman.local' } })) ??
    (await prisma.user.findFirst({ where: { roleAssignments: { some: {} } } }));
  if (!reviewer) {
    throw new Error('No admin user found — run `npm run db:seed` first.');
  }

  const employees = await prisma.employee.findMany({
    orderBy: { firstName: 'asc' },
    select: { id: true, firstName: true, lastName: true },
  });
  if (employees.length === 0) {
    throw new Error('No employees found — run `npm run db:seed:employees` first.');
  }

  const leaveTypes = await prisma.leaveType.findMany({
    where: { archivedAt: null },
    orderBy: { name: 'asc' },
    select: { id: true, name: true },
  });
  if (leaveTypes.length === 0) {
    throw new Error('No leave types found — run `npm run db:seed` first.');
  }

  console.log(
    `Seeding for ${employees.length} employees, ${leaveTypes.length} leave types, reviewer=${reviewer.email ?? reviewer.id}`,
  );

  // ── Leave requests ──────────────────────────────────────────────
  // For Approved seeds we freeze chargedMinutes the same way approval does, so
  // the leave report / balance count them (a null snapshot reads as 0 used).
  const cfg = (await prisma.leaveConfig.findFirst()) ?? CFG_FALLBACK;
  const allHolidays = (
    await prisma.holiday.findMany({ where: { archivedAt: null }, select: { date: true } })
  ).map((h) => h.date);

  let leaveCreated = 0;
  let leaveSkipped = 0;
  for (const s of LEAVE_SEEDS) {
    const emp = employees[s.empIndex % employees.length];
    const type = leaveTypes[s.typeIndex % leaveTypes.length];
    if (!emp || !type) continue; // unreachable (lengths checked above) — narrows for TS
    const startDate = d(s.start);
    const endDate = d(s.end);

    const existing = await prisma.leaveRequest.findFirst({
      where: { employeeId: emp.id, leaveTypeId: type.id, startDate },
      select: { id: true },
    });
    if (existing) {
      leaveSkipped++;
      continue;
    }

    const reviewed = s.status === 'Approved' || s.status === 'Rejected';

    // Freeze chargedMinutes for Approved leaves (all seeds are FullDay).
    let chargedMinutes: number | null = null;
    if (s.status === 'Approved') {
      const inWindow = allHolidays.filter(
        (h) => h.getTime() >= startDate.getTime() - 86_400_000 && h.getTime() <= endDate.getTime(),
      );
      const workingDays = workingDaysIn({
        startDate,
        endDate,
        holidays: expandHolidaysWithSubstitutes(inWindow),
      });
      const segment = segmentFor('FullDay', cfg);
      chargedMinutes = (segment?.minutes ?? 0) * workingDays.length;
    }

    await prisma.leaveRequest.create({
      data: {
        employeeId: emp.id,
        leaveTypeId: type.id,
        startDate,
        endDate,
        reason: s.reason,
        status: s.status,
        chargedMinutes,
        createdAt: ts(`${s.submitted}T09:30:00`),
        reviewedById: reviewed ? reviewer.id : null,
        reviewedAt: reviewed && s.reviewedOn ? ts(`${s.reviewedOn}T14:00:00`) : null,
        reviewNote: reviewed ? (s.reviewNote ?? null) : null,
      },
    });
    leaveCreated++;
  }

  // ── Cash advances ───────────────────────────────────────────────
  let advCreated = 0;
  let advSkipped = 0;
  for (const s of ADVANCE_SEEDS) {
    const emp = employees[s.empIndex % employees.length];
    if (!emp) continue; // unreachable (length checked above) — narrows for TS
    const amount = new Prisma.Decimal(s.amount);
    const requestedAt = ts(`${s.requested}T10:00:00`);

    const existing = await prisma.cashAdvance.findFirst({
      where: { employeeId: emp.id, amount, requestedAt },
      select: { id: true },
    });
    if (existing) {
      advSkipped++;
      continue;
    }

    const approved = s.status === 'Approved';
    await prisma.cashAdvance.create({
      data: {
        employeeId: emp.id,
        amount,
        status: s.status,
        requestedAt,
        createdAt: requestedAt,
        approvedById: approved ? reviewer.id : null,
        approvedAt: approved && s.approvedOn ? ts(`${s.approvedOn}T15:00:00`) : null,
        isDeducted: false,
      },
    });
    advCreated++;
  }

  // ── Summary ─────────────────────────────────────────────────────
  const leaveByStatus = await prisma.leaveRequest.groupBy({
    by: ['status'],
    _count: { _all: true },
  });
  const advByStatus = await prisma.cashAdvance.groupBy({
    by: ['status'],
    _count: { _all: true },
  });

  console.log(`\nLeave: created ${leaveCreated}, skipped ${leaveSkipped} (already present).`);
  console.log('  by status:', leaveByStatus.map((g) => `${g.status}=${g._count._all}`).join(', '));
  console.log(`Advance: created ${advCreated}, skipped ${advSkipped} (already present).`);
  console.log('  by status:', advByStatus.map((g) => `${g.status}=${g._count._all}`).join(', '));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
