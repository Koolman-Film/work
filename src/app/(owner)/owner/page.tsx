/**
 * Superadmin read-only dashboard.
 *
 * Phase-1 scope per build-plan §W5: "read-only counts + recent activity
 * feed (full owner pages are Phase 3)."
 *
 * Design principle — information-oriented, NOT actionable. The owner reads
 * the room ("how many pending requests, who's on leave today, what's been
 * happening this week"); they don't act on it. So:
 *   - KPI cards are static — no <Link> wrappers, no "ดูทั้งหมด →" CTAs
 *   - No approve/reject UI
 *   - The recent-activity feed surfaces audit events for transparency, not
 *     for navigation
 */

import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { Pill } from '@/components/ui/pill';
import { StatCard } from '@/components/ui/stat-card';
import { prisma } from '@/lib/db/prisma';

function bangkokDateUtcMidnight(d: Date): Date {
  const ymd = d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' });
  return new Date(`${ymd}T00:00:00.000Z`);
}

function bangkokMonthStartUtc(d: Date): Date {
  const ymd = d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' });
  const [y, m] = ymd.split('-');
  return new Date(`${y}-${m}-01T00:00:00.000Z`);
}

function formatRangeShort(start: Date, end: Date): string {
  const opts: Intl.DateTimeFormatOptions = {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'short',
  };
  const sameDay =
    start.getUTCFullYear() === end.getUTCFullYear() &&
    start.getUTCMonth() === end.getUTCMonth() &&
    start.getUTCDate() === end.getUTCDate();
  if (sameDay) return start.toLocaleDateString('th-TH', opts);
  return `${start.toLocaleDateString('th-TH', opts)}–${end.toLocaleDateString('th-TH', opts)}`;
}

function formatMoney(v: unknown): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('th-TH', {
    style: 'currency',
    currency: 'THB',
    maximumFractionDigits: 0,
  }).format(n);
}

function formatDateTime(d: Date): string {
  return d.toLocaleString('th-TH', {
    timeZone: 'Asia/Bangkok',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Translate an audit action key to a human-readable Thai phrase.
 * Defaults to the raw key — owner sees the underlying machine label rather
 * than an obscured "—" if a new action type ships before we add a label.
 */
function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action;
}

const ACTION_LABELS: Record<string, string> = {
  'employee.create': 'เพิ่มพนักงาน',
  'employee.update': 'แก้ไขพนักงาน',
  'employee.archive': 'พ้นสภาพพนักงาน',
  'employee.line-link': 'เชื่อม LINE',
  'employee.line-unlink': 'ยกเลิกการเชื่อม LINE',
  'branch.create': 'เพิ่มสาขา',
  'branch.update': 'แก้ไขสาขา',
  'branch.archive': 'ลบถาวรสาขา',
  'department.create': 'เพิ่มแผนก',
  'department.update': 'แก้ไขแผนก',
  'department.archive': 'ลบถาวรแผนก',
  'leaveType.create': 'เพิ่มประเภทการลา',
  'leaveType.update': 'แก้ไขประเภทการลา',
  'leaveType.archive': 'ลบถาวรประเภทการลา',
  'holiday.create': 'เพิ่มวันหยุด',
  'holiday.update': 'แก้ไขวันหยุด',
  'holiday.archive': 'ลบถาวรวันหยุด',
  'leave.submit': 'ส่งคำขอลา',
  'leave.approve': 'อนุมัติคำขอลา',
  'leave.reject': 'ปฏิเสธคำขอลา',
  'leave.cancel': 'ยกเลิกคำขอลา',
  'advance.submit': 'ส่งคำขอเบิก',
  'advance.approve': 'อนุมัติคำขอเบิก',
  'advance.reject': 'ปฏิเสธคำขอเบิก',
  'advance.cancel': 'ยกเลิกคำขอเบิก',
  'attendance.checkin': 'เช็คอิน',
  'attendance.checkout': 'เช็คเอาท์',
  'attendance.dispute-approve': 'อนุมัติเช็คอินที่ตรวจสอบ',
  'attendance.dispute-reject': 'ปฏิเสธเช็คอินที่ตรวจสอบ',
};

export default async function SuperadminHomePage() {
  // Role gate runs in the parent layout; no double-check needed here.

  const today = bangkokDateUtcMidnight(new Date());
  const monthStart = bangkokMonthStartUtc(new Date());

  const [
    activeEmployeeCount,
    checkedInTodayCount,
    todayHoliday,
    leaveRequestsThisMonth,
    approvedAdvancesThisMonth,
    onLeaveToday,
    recentAudit,
  ] = await Promise.all([
    prisma.employee.count({
      where: { archivedAt: null, status: { not: 'Archived' } },
    }),
    prisma.attendance.count({ where: { type: 'CheckIn', date: today } }),
    prisma.holiday.findFirst({
      where: { date: today, archivedAt: null },
      select: { name: true },
    }),
    prisma.leaveRequest.count({
      where: { createdAt: { gte: monthStart } },
    }),
    prisma.cashAdvance.findMany({
      where: { status: 'Approved', approvedAt: { gte: monthStart } },
      select: { amount: true },
    }),
    prisma.attendance.findMany({
      where: { type: 'OnLeave', date: today },
      orderBy: { employee: { firstName: 'asc' } },
      select: {
        id: true,
        employee: { select: { firstName: true, lastName: true, nickname: true } },
        leaveRequest: {
          select: {
            startDate: true,
            endDate: true,
            leaveType: { select: { name: true } },
          },
        },
      },
    }),
    prisma.auditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 15,
      select: {
        id: true,
        actorId: true,
        action: true,
        entityType: true,
        createdAt: true,
      },
    }),
  ]);

  // Sum advance amounts. Prisma returns Decimal; Number coercion is OK
  // for display rendering (we already use it across the app's formatters).
  const totalAdvanceThisMonth = approvedAdvancesThisMonth.reduce(
    (sum, a) => sum + Number(a.amount),
    0,
  );

  // Resolve actor labels in one bulk query. We use the audit row's actorId
  // (nullable + non-FK per schema comment) so a deleted user simply shows
  // as their UUID prefix rather than blowing up the page.
  const distinctActorIds = Array.from(
    new Set(recentAudit.map((a) => a.actorId).filter((v): v is string => v !== null)),
  );
  const actors =
    distinctActorIds.length > 0
      ? await prisma.user.findMany({
          where: { id: { in: distinctActorIds } },
          select: {
            id: true,
            email: true,
            employee: { select: { firstName: true, lastName: true } },
          },
        })
      : [];
  const actorById = new Map(
    actors.map((u) => [
      u.id,
      u.employee ? `${u.employee.firstName} ${u.employee.lastName}` : (u.email ?? u.id.slice(0, 8)),
    ]),
  );

  const todayIsSunday = today.getUTCDay() === 0;
  const isClosedDay = todayIsSunday || todayHoliday !== null;

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader
        breadcrumb="เจ้าของ"
        title="แดชบอร์ดเจ้าของ"
        subtitle="ภาพรวมการดำเนินงาน — ดูได้อย่างเดียว"
        actions={<Pill variant="neutral">อ่านอย่างเดียว</Pill>}
      />

      {/* KPI strip — static, no links (read-only by design) */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="พนักงานทั้งหมด" value={activeEmployeeCount} />
        <StatCard
          label="เช็คอินวันนี้"
          value={checkedInTodayCount}
          hint={
            todayHoliday ? `วันหยุด: ${todayHoliday.name}` : todayIsSunday ? 'วันอาทิตย์' : undefined
          }
        />
        <StatCard label="คำขอลาเดือนนี้" value={leaveRequestsThisMonth} />
        <StatCard label="ยอดเบิกเดือนนี้" value={formatMoney(totalAdvanceThisMonth)} />
      </div>

      {/* Two-column panels */}
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>
              ลาวันนี้ <span className="tabular text-ink-3">({onLeaveToday.length})</span>
            </CardTitle>
          </CardHeader>
          <CardBody className="!p-0">
            {onLeaveToday.length === 0 ? (
              <EmptyState
                title="ไม่มีพนักงานลาวันนี้"
                hint={
                  isClosedDay
                    ? todayHoliday
                      ? `${todayHoliday.name} — วันหยุดทุกคน`
                      : 'วันอาทิตย์ — วันหยุดประจำสัปดาห์'
                    : 'พนักงานทุกคนพร้อมทำงาน'
                }
              />
            ) : (
              <ul className="divide-y divide-gray-100">
                {onLeaveToday.map((a) => (
                  <li key={a.id} className="px-5 py-3">
                    <p className="truncate text-sm font-medium text-ink-1">
                      {a.employee.firstName} {a.employee.lastName}
                      {a.employee.nickname && (
                        <span className="text-ink-3"> ({a.employee.nickname})</span>
                      )}
                    </p>
                    <p className="mt-0.5 text-xs text-ink-3">
                      {a.leaveRequest?.leaveType.name ?? 'ลา'}
                      {a.leaveRequest && (
                        <> • {formatRangeShort(a.leaveRequest.startDate, a.leaveRequest.endDate)}</>
                      )}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>กิจกรรมล่าสุด</CardTitle>
          </CardHeader>
          <CardBody className="!p-0">
            {recentAudit.length === 0 ? (
              <EmptyState title="ยังไม่มีกิจกรรม" hint="กิจกรรมจะปรากฏที่นี่เมื่อมีการเปลี่ยนแปลง" />
            ) : (
              <ul className="divide-y divide-gray-100">
                {recentAudit.map((a) => (
                  <li key={a.id} className="px-5 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-ink-1">
                          {actionLabel(a.action)}
                        </p>
                        <p className="mt-0.5 text-xs text-ink-3">
                          โดย{' '}
                          {a.actorId ? (actorById.get(a.actorId) ?? a.actorId.slice(0, 8)) : 'ระบบ'}
                        </p>
                      </div>
                      <p className="shrink-0 text-[10px] text-ink-4">
                        {formatDateTime(a.createdAt)}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
