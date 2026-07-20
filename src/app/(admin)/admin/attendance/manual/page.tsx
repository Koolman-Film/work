/**
 * /admin/attendance/manual — admin creates Attendance rows directly
 * for cases where employees couldn't tap LIFF (broken phone, dead battery,
 * no signal) or genuinely didn't show up.
 *
 * Per docs/v1/screens/admin.md S-N10 + F-N5.
 *
 * The form is structured as "did they work?" (worked/absent) rather than a
 * flat list of anomaly types — CheckIn and Late are separate rows that
 * legitimately co-occur, and the admin should never be forced into ขาดงาน
 * just because the employee couldn't tap the phone. CheckOut is never
 * hand-entered as its own type (would bypass GPS verification); OnLeave is
 * auto-created by leave approval and shouldn't be hand-entered either.
 */

import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { bangkokDateUtcMidnight } from '@/lib/attendance/date';
import { employeeBranchScope, getPermittedBranches } from '@/lib/auth/branch-scope';
import { canDo, requirePermission } from '@/lib/auth/check-permission';
import { prisma } from '@/lib/db/prisma';
import { AttendanceTabs } from '../attendance-tabs';
import { ManualAttendanceForm } from './manual-form';

/** Matches `PayrollConfig.cutoffDay`'s schema default — same fallback the
 *  attendance settings page uses when the singleton config row is missing. */
const DEFAULT_CUTOFF_DAY = 25;

/** Today's Bangkok calendar date, at UTC midnight (matches @db.Date). */
function holidayWindowEnd(): Date {
  return bangkokDateUtcMidnight(new Date());
}

/**
 * ~13 months before today. This form only ever accepts today or an earlier
 * date (see the `future-date` check in `createManualAttendance`), so a
 * holiday further back than one payroll year plus a small buffer can never
 * be relevant to a submission — bounding the query here keeps the client
 * payload from growing without limit as holidays accumulate across years.
 */
function holidayWindowStart(): Date {
  const end = holidayWindowEnd();
  return new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 13, end.getUTCDate()));
}

export default async function ManualAttendancePage() {
  const { user } = await requirePermission('attendance.manual-create');
  const permitted = await getPermittedBranches(user, 'attendance.manual-create');

  const [employees, payrollCfg, holidays, canSettle] = await Promise.all([
    prisma.employee.findMany({
      where: {
        archivedAt: null,
        status: { not: 'Archived' },
        ...employeeBranchScope(permitted),
      },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
      select: {
        id: true,
        firstName: true,
        lastName: true,
        nickname: true,
        salaryType: true,
        baseSalary: true,
        branch: { select: { name: true } },
        workSchedule: {
          select: {
            lateToleranceMin: true,
            days: { select: { dayOfWeek: true, startTime: true, endTime: true } },
          },
        },
      },
    }),
    prisma.payrollConfig.findFirst({
      select: {
        workStartTime: true,
        lateGraceMinutes: true,
        absentDeductionPerDay: true,
        earlyLeaveDeduction: true,
        otThresholdMinutes: true,
        workingDaysPerMonth: true,
        cutoffDay: true,
      },
    }),
    // This form only ever accepts today or an earlier date, so a lookback
    // window covering the last ~13 months is all a submission could need —
    // bounding it keeps the client payload from growing without limit as
    // holidays accumulate across years.
    prisma.holiday.findMany({
      where: { archivedAt: null, date: { gte: holidayWindowStart(), lte: holidayWindowEnd() } },
      select: { date: true },
    }),
    // Settling a penalty with leave needs `payroll.run`, separate from the
    // `attendance.manual-create` permission that gates this whole page — an
    // admin may hold one and not the other. When they lack it, the choice
    // must not render at all (not a disabled control): they record the
    // absence and someone with payroll rights settles it later on the
    // reconcile page.
    canDo(user, 'payroll.run'),
  ]);

  // Eligible leave types. Skipped entirely when the admin can't settle — no
  // point loading data that never renders. Remaining balances are NOT
  // precomputed here: which leave YEAR a balance is checked against depends
  // on the entry's own (possibly backdated) date, not today's — so the form
  // fetches balances itself, per employee/date, via
  // `getPenaltyLeaveBalance` (penalty-settlement-admin.ts), the same
  // payroll-year math `setPenaltySettlement` enforces.
  let penaltyLeaveTypes: { id: string; name: string }[] = [];
  if (canSettle) {
    penaltyLeaveTypes = await prisma.leaveType.findMany({
      where: { archivedAt: null, penaltySettlementAllowed: true },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
  }

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader
        breadcrumb="ลงเวลา"
        title="คีย์มือ — บันทึกเวลาทำงาน"
        subtitle="ใช้เมื่อพนักงานเช็คอินด้วย LINE ไม่ได้ — เช่น โทรศัพท์พัง แบตหมด เน็ตล่ม หรือขาดงาน"
      />
      <AttendanceTabs current="manual" />

      <div>
        <Card>
          <CardHeader>
            <CardTitle>รายละเอียด</CardTitle>
          </CardHeader>
          <CardBody>
            <ManualAttendanceForm
              employees={employees.map((e) => ({
                id: e.id,
                label:
                  `${e.firstName} ${e.lastName}${e.nickname ? ` (${e.nickname})` : ''} — ${e.branch.name}`.trim(),
                salaryType: e.salaryType,
                baseSalary: e.baseSalary.toString(),
                lateToleranceMin: e.workSchedule?.lateToleranceMin ?? null,
                scheduleDays:
                  e.workSchedule?.days.map((d) => ({
                    dayOfWeek: d.dayOfWeek,
                    startTime: d.startTime,
                    endTime: d.endTime,
                  })) ?? null,
              }))}
              companyPolicy={{
                workStartTime: payrollCfg?.workStartTime ?? null,
                lateGraceMinutes: payrollCfg?.lateGraceMinutes ?? null,
              }}
              rates={{
                absentPerDay: payrollCfg?.absentDeductionPerDay?.toString() ?? '0',
                earlyLeave: payrollCfg?.earlyLeaveDeduction?.toString() ?? '0',
              }}
              holidayYmds={holidays.map((h) => h.date.toISOString().slice(0, 10))}
              // Same fallback as getOtCandidates (src/lib/overtime/candidates.ts)
              // when the PayrollConfig row is missing.
              otThresholdMinutes={payrollCfg?.otThresholdMinutes ?? 30}
              // Same fallback dailyRateFor uses when the divisor is missing/invalid.
              workingDaysPerMonth={payrollCfg?.workingDaysPerMonth ?? 30}
              // Same fallback the attendance settings page uses when the
              // PayrollConfig row is missing; needed client-side to resolve
              // which pay-period month a settlement's absence date belongs to.
              cutoffDay={payrollCfg?.cutoffDay ?? DEFAULT_CUTOFF_DAY}
              canSettle={canSettle}
              penaltyLeaveTypes={penaltyLeaveTypes}
            />
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
