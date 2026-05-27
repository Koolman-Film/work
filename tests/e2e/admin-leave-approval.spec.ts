import { expect, test } from '@playwright/test';
import { Prisma } from '@prisma/client';
import { loginAsAdmin } from './helpers/auth';
import { cleanupE2eRecords, e2eId, prisma } from './helpers/db';

/**
 * The high-value integration test of the W4 surface.
 *
 * Setup (via Prisma directly):
 *   1. Create an e2e Department + Branch + Employee + User row
 *   2. Create a Pending LeaveRequest spanning 5 calendar days
 *
 * Then drive the admin UI:
 *   3. Log in as admin → /admin/leave
 *   4. Find our pending request, expand the review panel
 *   5. Click "อนุมัติ" with a note
 *
 * Then assert via Prisma:
 *   6. LeaveRequest.status === 'Approved'
 *   7. LeaveRequest.reviewNote === the note we entered
 *   8. Attendance rows (type=OnLeave, leaveRequestId=ours) exist for
 *      every working day in the range (excluding Sundays + Holidays)
 *
 * This is the test that proves the $transaction in approveLeaveRequest
 * actually atomically expands the request → Attendance rows. A bug in
 * that transaction (committed status flip but failed Attendance insert)
 * would surface here and only here.
 */

test.describe('Admin leave approval → Attendance(OnLeave) expansion', () => {
  test.afterAll(async () => {
    await cleanupE2eRecords();
  });

  test('approve creates Attendance(OnLeave) rows for each working day', async ({ page }) => {
    const suffix = e2eId();

    // ── Pre-condition setup via Prisma ──────────────────────────────
    // Pick a leave type. We use the seeded "ลาพักร้อน" (annual leave) if
    // present; otherwise create our own.
    let leaveType = await prisma.leaveType.findFirst({
      where: { archivedAt: null },
      orderBy: { name: 'asc' },
    });
    if (!leaveType) {
      leaveType = await prisma.leaveType.create({
        data: { name: `e2e-LType-${suffix}`, isPaid: true, annualQuota: 30 },
      });
    }

    // Branch.
    const branch = await prisma.branch.create({
      data: { name: `e2e-Branch-${suffix}` },
    });

    // User + Employee — minimal viable Employee for the relation.
    // First create a User row (Employee.userId is required).
    const user = await prisma.user.create({
      data: {
        role: 'Employee',
        // authUserId stays null — no real Supabase auth user. Acceptable
        // since the admin approval flow only reads through the Employee
        // join, never authenticates as this user.
      },
    });
    const employee = await prisma.employee.create({
      data: {
        userId: user.id,
        firstName: `e2e-First-${suffix}`,
        lastName: `e2e-Last-${suffix}`,
        branchId: branch.id,
        assignedBranchIds: [branch.id],
        salaryType: 'Monthly',
        baseSalary: new Prisma.Decimal(20_000),
        status: 'Active',
        canCheckIn: true,
        hiredAt: new Date('2026-01-01'),
      },
    });

    // Pick a 5-day range that avoids Sundays for predictable arithmetic.
    // 2026-05-04 (Mon) through 2026-05-08 (Fri) — 5 working days, no
    // Sunday, no seeded Thai holiday. (We seed Holidays in the leave
    // working-days unit tests but the dev DB may or may not have them.)
    const startDate = new Date('2026-05-04T00:00:00.000Z');
    const endDate = new Date('2026-05-08T00:00:00.000Z');

    const leaveRequest = await prisma.leaveRequest.create({
      data: {
        employeeId: employee.id,
        leaveTypeId: leaveType.id,
        startDate,
        endDate,
        // Reason starts with "e2e-" so cleanup can find it.
        reason: `e2e-reason-${suffix} — Playwright integration test`,
        status: 'Pending',
      },
    });

    // Compute expected working days in this range, accounting for any
    // holidays the DB has configured. (The system uses the same Holiday
    // table; doing the same query here makes the assertion robust against
    // a customer adding holidays later.)
    const holidayRows = await prisma.holiday.findMany({
      where: { archivedAt: null, date: { gte: startDate, lte: endDate } },
      select: { date: true },
    });
    const holidayDates = new Set(holidayRows.map((h) => h.date.toISOString().slice(0, 10)));

    const expectedDates: string[] = [];
    for (let t = startDate.getTime(); t <= endDate.getTime(); t += 86_400_000) {
      const d = new Date(t);
      if (d.getUTCDay() === 0) continue; // Sunday
      const ymd = d.toISOString().slice(0, 10);
      if (holidayDates.has(ymd)) continue;
      expectedDates.push(ymd);
    }
    expect(expectedDates.length, 'pre-condition: chose a 5-Mon-Fri range').toBeGreaterThan(0);

    // ── Drive the UI ────────────────────────────────────────────────
    await loginAsAdmin(page);
    await page.goto('/admin/leave');
    await expect(page.getByRole('heading', { name: 'คำขอลา' })).toBeVisible();

    // Locate our pending request — the reason text we seeded with e2e-
    // suffix is unique enough to identify the row.
    const row = page
      .locator('li')
      .filter({ hasText: `e2e-reason-${suffix}` })
      .first();
    await expect(row).toBeVisible({ timeout: 5_000 });

    await row.getByRole('button', { name: /ตรวจสอบ/ }).click();
    // Wait for the review panel's textarea to appear.
    await row.getByRole('textbox').fill('e2e — approved by Playwright');
    await row.getByRole('button', { name: /^อนุมัติ/ }).click();

    // Wait for the "settled" state.
    await expect(row.getByText(/อนุมัติเรียบร้อย/)).toBeVisible({ timeout: 5_000 });

    // ── Assert DB state ─────────────────────────────────────────────
    const refreshed = await prisma.leaveRequest.findUnique({
      where: { id: leaveRequest.id },
      select: { status: true, reviewNote: true, reviewedAt: true },
    });
    expect(refreshed?.status).toBe('Approved');
    expect(refreshed?.reviewNote).toBe('e2e — approved by Playwright');
    expect(refreshed?.reviewedAt).not.toBeNull();

    // Attendance rows: one per working day in the range, type=OnLeave,
    // leaveRequestId = ours.
    const attendances = await prisma.attendance.findMany({
      where: { leaveRequestId: leaveRequest.id },
      select: { date: true, type: true, source: true },
      orderBy: { date: 'asc' },
    });
    expect(attendances).toHaveLength(expectedDates.length);
    for (const att of attendances) {
      expect(att.type).toBe('OnLeave');
      expect(att.source).toBe('Manual');
    }
    expect(attendances.map((a) => a.date.toISOString().slice(0, 10))).toEqual(expectedDates);
  });

  test('reject a Pending leave with note → status=Rejected, no Attendance rows', async ({
    page,
  }) => {
    const suffix = e2eId();

    const leaveType =
      (await prisma.leaveType.findFirst({ where: { archivedAt: null } })) ??
      (await prisma.leaveType.create({
        data: { name: `e2e-LType-fallback-${suffix}`, isPaid: true, annualQuota: 30 },
      }));

    const branch = await prisma.branch.create({ data: { name: `e2e-Branch-${suffix}` } });
    const user = await prisma.user.create({ data: { role: 'Employee' } });
    const employee = await prisma.employee.create({
      data: {
        userId: user.id,
        firstName: `e2e-First-${suffix}`,
        lastName: `e2e-Last-${suffix}`,
        branchId: branch.id,
        assignedBranchIds: [branch.id],
        salaryType: 'Monthly',
        baseSalary: new Prisma.Decimal(20_000),
        status: 'Active',
        canCheckIn: true,
        hiredAt: new Date('2026-01-01'),
      },
    });

    const leaveRequest = await prisma.leaveRequest.create({
      data: {
        employeeId: employee.id,
        leaveTypeId: leaveType.id,
        startDate: new Date('2026-06-01T00:00:00.000Z'),
        endDate: new Date('2026-06-03T00:00:00.000Z'),
        reason: `e2e-reason-${suffix}`,
        status: 'Pending',
      },
    });

    await loginAsAdmin(page);
    await page.goto('/admin/leave');

    const row = page
      .locator('li')
      .filter({ hasText: `e2e-reason-${suffix}` })
      .first();
    await row.getByRole('button', { name: /ตรวจสอบ/ }).click();
    await row.getByRole('textbox').fill('e2e — rejected');
    await row.getByRole('button', { name: /^ปฏิเสธ/ }).click();

    await expect(row.getByText(/ปฏิเสธเรียบร้อย/)).toBeVisible({ timeout: 5_000 });

    const refreshed = await prisma.leaveRequest.findUnique({
      where: { id: leaveRequest.id },
      select: { status: true, reviewNote: true },
    });
    expect(refreshed?.status).toBe('Rejected');
    expect(refreshed?.reviewNote).toBe('e2e — rejected');

    // No Attendance rows created.
    const attCount = await prisma.attendance.count({
      where: { leaveRequestId: leaveRequest.id },
    });
    expect(attCount).toBe(0);
  });
});
