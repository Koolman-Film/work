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
import { requirePermission } from '@/lib/auth/check-permission';
import { prisma } from '@/lib/db/prisma';
import { AttendanceTabs } from '../attendance-tabs';
import { ManualAttendanceForm } from './manual-form';

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

  const [employees, payrollCfg, holidays] = await Promise.all([
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
  ]);

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
            />
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
