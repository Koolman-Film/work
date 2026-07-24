/**
 * Integration coverage for backfillLeaveLateRows (src/lib/attendance/
 * backfill-leave-late.ts — shared by the CLI script and the Superadmin admin
 * tool) against a REAL Postgres, proving the two things the operator actually
 * cares about:
 *
 *   1. It fixes exactly the rows the bug produced (bogus Late deleted, a
 *      genuinely-late-after-leave row lowered to the correct minutes) and
 *      NOTHING else — a Late row with no leave that day, an afternoon leave
 *      that doesn't cover the morning start, and a finalized payroll month are
 *      all left untouched.
 *   2. It does not corrupt data: the dry run mutates nothing at all, and after
 *      --apply every OnLeave / CheckIn row and every untouched Late row is
 *      byte-for-byte what it was before.
 */

import { Prisma } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { backfillLeaveLateRows } from '@/lib/attendance/backfill-leave-late';
import { prisma } from '@/lib/db/prisma';

const uid = () => crypto.randomUUID();
/** A Bangkok (UTC+7) instant for "YYYY-MM-DD HH:MM". */
const bkk = (ymd: string, hhmm: string) => new Date(`${ymd}T${hhmm}:00+07:00`);
const day = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);

async function reset() {
  await prisma.payroll.deleteMany({});
  await prisma.attendance.deleteMany({});
  await prisma.employee.deleteMany({});
  await prisma.user.deleteMany({});
  await prisma.branch.deleteMany({});
  await prisma.leaveConfig.deleteMany({});
  await prisma.payrollConfig.deleteMany({});
  // Company default lateness: 09:00 start, 15-min grace; standard lunch gap.
  await prisma.leaveConfig.create({ data: {} }); // 09:00/12:00/13:00/17:00
}

async function makeEmployee() {
  const user = await prisma.user.create({ data: {} });
  const branch = await prisma.branch.create({ data: { name: `B-${uid().slice(0, 8)}` } });
  return prisma.employee.create({
    data: {
      userId: user.id,
      firstName: 'Test',
      lastName: 'Worker',
      branchId: branch.id,
      salaryType: 'Monthly',
      baseSalary: new Prisma.Decimal(20_000),
      status: 'Active',
      hiredAt: day('2026-01-01'),
    },
  });
}

/** Create the trio for a day: an OnLeave window (null bounds = full day), the
 *  afternoon CheckIn, and the (possibly bogus) Late row the bug wrote. */
async function seedDay(opts: {
  employeeId: string;
  date: string;
  leave: { start: string; end: string } | 'fullday' | null;
  checkIn: string | null;
  lateMinutes: number;
}) {
  const d = day(opts.date);
  if (opts.leave) {
    await prisma.attendance.create({
      data: {
        employeeId: opts.employeeId,
        date: d,
        type: 'OnLeave',
        source: 'Manual',
        durationMinutes: 180,
        clockInAt: opts.leave === 'fullday' ? null : bkk(opts.date, opts.leave.start),
        clockOutAt: opts.leave === 'fullday' ? null : bkk(opts.date, opts.leave.end),
        createdById: uid(),
      },
    });
  }
  if (opts.checkIn) {
    await prisma.attendance.create({
      data: {
        employeeId: opts.employeeId,
        date: d,
        type: 'CheckIn',
        source: 'Liff',
        clockInAt: bkk(opts.date, opts.checkIn),
        createdById: uid(),
      },
    });
  }
  return prisma.attendance.create({
    data: {
      employeeId: opts.employeeId,
      date: d,
      type: 'Late',
      source: 'Liff',
      durationMinutes: opts.lateMinutes,
      createdById: uid(),
    },
  });
}

const WED = '2026-07-15';
const THU = '2026-07-16';

beforeEach(reset);
afterAll(async () => {
  await prisma.$disconnect();
});

describe('backfillLeaveLateRows', () => {
  it('deletes bogus lateness, lowers genuine lateness, and leaves everything else alone', async () => {
    const [a, b, c, d, e, f] = await Promise.all([
      makeEmployee(),
      makeEmployee(),
      makeEmployee(),
      makeEmployee(),
      makeEmployee(),
      makeEmployee(),
    ]);

    // A — morning leave 09:00–12:00, checked in 12:16 → 196 min bogus → DELETE.
    const lateA = await seedDay({
      employeeId: a.id,
      date: WED,
      leave: { start: '09:00', end: '12:00' },
      checkIn: '12:16',
      lateMinutes: 196,
    });
    // B — same leave, but checked in 13:30 → genuinely 30 late from 13:00 → LOWER 270→30.
    const lateB = await seedDay({
      employeeId: b.id,
      date: WED,
      leave: { start: '09:00', end: '12:00' },
      checkIn: '13:30',
      lateMinutes: 270,
    });
    // C — NO leave that day, plainly 30 late → must be UNTOUCHED (never a candidate).
    const lateC = await seedDay({
      employeeId: c.id,
      date: WED,
      leave: null,
      checkIn: '09:45',
      lateMinutes: 30,
    });
    // D — AFTERNOON leave 13:00–17:00 doesn't cover the 09:00 start; 40 late in the
    //     morning is real → recomputed 40 == stored → UNCHANGED (untouched).
    const lateD = await seedDay({
      employeeId: d.id,
      date: WED,
      leave: { start: '13:00', end: '17:00' },
      checkIn: '09:40',
      lateMinutes: 40,
    });
    // E — morning leave + 12:16 (would delete) BUT payroll month finalized → SKIP.
    const lateE = await seedDay({
      employeeId: e.id,
      date: WED,
      leave: { start: '09:00', end: '12:00' },
      checkIn: '12:16',
      lateMinutes: 196,
    });
    await prisma.payroll.create({
      data: {
        employeeId: e.id,
        month: '2026-07',
        status: 'Published',
        publishedAt: new Date(),
        incomeBase: new Prisma.Decimal(20_000),
        netPay: new Prisma.Decimal(20_000),
      },
    });
    // F — FULL-DAY leave, checked in 09:50 → never late → DELETE.
    const lateF = await seedDay({
      employeeId: f.id,
      date: THU,
      leave: 'fullday',
      checkIn: '09:50',
      lateMinutes: 50,
    });

    // ── Snapshot every row so we can prove the dry run changes NOTHING ──
    const snapshot = async () =>
      prisma.attendance.findMany({
        orderBy: [{ employeeId: 'asc' }, { type: 'asc' }],
        select: { id: true, type: true, durationMinutes: true, deletedAt: true },
      });
    const before = await snapshot();

    // ── DRY RUN: correct plan, zero mutations ──
    const dry = await backfillLeaveLateRows({ apply: false });
    expect(dry.counts).toMatchObject({ delete: 2, lower: 1, skippedFinalized: 1, unchanged: 1 });
    expect(await snapshot()).toEqual(before); // nothing moved

    // ── APPLY ──
    const applied = await backfillLeaveLateRows({ apply: true });
    expect(applied.counts).toMatchObject({
      delete: 2,
      lower: 1,
      skippedFinalized: 1,
      unchanged: 1,
    });

    const row = async (id: string) => prisma.attendance.findUniqueOrThrow({ where: { id } });

    // A — soft-deleted (not hard-deleted: still there, deletedAt set + reason).
    const rowA = await row(lateA.id);
    expect(rowA.deletedAt).not.toBeNull();
    expect(rowA.deleteReason).toContain('leave-excused late backfill');
    // B — lowered to the correct 30, still live.
    const rowB = await row(lateB.id);
    expect(rowB.durationMinutes).toBe(30);
    expect(rowB.deletedAt).toBeNull();
    // C, D, E — untouched.
    expect(await row(lateC.id)).toMatchObject({ durationMinutes: 30, deletedAt: null });
    expect(await row(lateD.id)).toMatchObject({ durationMinutes: 40, deletedAt: null });
    expect(await row(lateE.id)).toMatchObject({ durationMinutes: 196, deletedAt: null });
    // F — full-day leave → deleted.
    expect((await row(lateF.id)).deletedAt).not.toBeNull();

    // ── No collateral damage: every OnLeave and CheckIn row is exactly as seeded ──
    const supporting = await prisma.attendance.findMany({
      where: { type: { in: ['OnLeave', 'CheckIn'] } },
      select: { deletedAt: true, durationMinutes: true, clockInAt: true },
    });
    expect(supporting.every((r) => r.deletedAt === null)).toBe(true);
    // Exactly the rows we seeded (5 OnLeave + 6 CheckIn), none added or removed.
    expect(supporting).toHaveLength(11);
  });

  it('uses the payroll CUTOFF period, not the calendar month, for the finalized guard', async () => {
    // Default PayrollConfig.cutoffDay is 25. A Late row dated 2026-07-28 (past
    // the cutoff) belongs to payroll period "2026-08" (26 Jul – 25 Aug), NOT
    // calendar month "2026-07" — see payrollPeriodFor (advance/period-earnings.ts)
    // and void.ts, which routes through it for exactly this reason. If the
    // guard used the naive calendar month it would look up "2026-07" (never
    // published) and wrongly modify a row that actually belongs to the
    // Published "2026-08" period.
    const emp = await makeEmployee();
    const lateRow = await seedDay({
      employeeId: emp.id,
      date: '2026-07-28',
      leave: { start: '09:00', end: '12:00' },
      checkIn: '12:16',
      lateMinutes: 196,
    });
    await prisma.payroll.create({
      data: {
        employeeId: emp.id,
        month: '2026-08', // the CORRECT cutoff-based period for 2026-07-28
        status: 'Published',
        publishedAt: new Date(),
        incomeBase: new Prisma.Decimal(20_000),
        netPay: new Prisma.Decimal(20_000),
      },
    });

    const report = await backfillLeaveLateRows({ apply: true });

    expect(report.counts.skippedFinalized).toBe(1);
    expect(report.counts.delete).toBe(0);
    const row = await prisma.attendance.findUniqueOrThrow({ where: { id: lateRow.id } });
    expect(row.deletedAt).toBeNull(); // must NOT have been touched
  });

  it('is idempotent — a second apply changes nothing further', async () => {
    const emp = await makeEmployee();
    await seedDay({
      employeeId: emp.id,
      date: WED,
      leave: { start: '09:00', end: '12:00' },
      checkIn: '13:30', // genuinely 30 late from 13:00 → LOWER 270→30
      lateMinutes: 270,
    });

    const first = await backfillLeaveLateRows({ apply: true });
    expect(first.counts).toMatchObject({ lower: 1, delete: 0 });

    const snapshot = await prisma.attendance.findMany({
      orderBy: [{ type: 'asc' }],
      select: { id: true, durationMinutes: true, deletedAt: true },
    });

    // Re-running must find nothing left to do and touch no row.
    const second = await backfillLeaveLateRows({ apply: true });
    expect(second.counts).toMatchObject({ delete: 0, lower: 0, unchanged: 1 });
    expect(
      await prisma.attendance.findMany({
        orderBy: [{ type: 'asc' }],
        select: { id: true, durationMinutes: true, deletedAt: true },
      }),
    ).toEqual(snapshot);
  });

  it('never clobbers a row an admin voided concurrently', async () => {
    const emp = await makeEmployee();
    const lateRow = await seedDay({
      employeeId: emp.id,
      date: WED,
      leave: { start: '09:00', end: '12:00' },
      checkIn: '12:16',
      lateMinutes: 196,
    });
    // Simulate the admin's void landing first, with THEIR reason.
    const adminVoidedAt = new Date('2026-07-20T03:00:00.000Z');
    await prisma.attendance.update({
      where: { id: lateRow.id },
      data: { deletedAt: adminVoidedAt, deleteReason: 'ADMIN REASON — do not overwrite' },
    });

    const report = await backfillLeaveLateRows({ apply: true });

    // The row is already soft-deleted, so it is no longer a candidate at all
    // (the Late lookup filters deletedAt: null) — nothing is rewritten.
    expect(report.counts.delete).toBe(0);
    const row = await prisma.attendance.findUniqueOrThrow({ where: { id: lateRow.id } });
    expect(row.deleteReason).toBe('ADMIN REASON — do not overwrite');
    expect(row.deletedAt).toEqual(adminVoidedAt);
  });

  it('--since excludes dates before the cutoff', async () => {
    const emp = await makeEmployee();
    // A bogus row in June — outside a July cutoff — must be ignored.
    const june = await seedDay({
      employeeId: emp.id,
      date: '2026-06-17',
      leave: { start: '09:00', end: '12:00' },
      checkIn: '12:16',
      lateMinutes: 196,
    });

    const report = await backfillLeaveLateRows({ apply: true, since: day('2026-07-01') });

    expect(report.counts.delete).toBe(0);
    expect(
      (await prisma.attendance.findUniqueOrThrow({ where: { id: june.id } })).deletedAt,
    ).toBeNull();
  });
});
