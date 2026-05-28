/**
 * Owner read-only dashboard.
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

import { Calendar, CheckCircle2, Coins, Users } from 'lucide-react';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
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

export default async function OwnerHomePage() {
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
    <div className="mx-auto max-w-6xl px-6 py-8">
      <div className="mb-6 flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">แดชบอร์ดเจ้าของ</h1>
          <p className="mt-1 text-sm text-gray-500">ภาพรวมการดำเนินงาน — ดูได้อย่างเดียว</p>
        </div>
        <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-600">
          อ่านอย่างเดียว
        </span>
      </div>

      {/* KPI strip — static, no links (read-only by design) */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <KpiCard label="พนักงานทั้งหมด" value={activeEmployeeCount} Icon={Users} />
        <KpiCard
          label="เช็คอินวันนี้"
          value={checkedInTodayCount}
          Icon={CheckCircle2}
          hint={
            todayHoliday ? `วันหยุด: ${todayHoliday.name}` : todayIsSunday ? 'วันอาทิตย์' : undefined
          }
        />
        <KpiCard label="คำขอลาเดือนนี้" value={leaveRequestsThisMonth} Icon={Calendar} />
        <KpiCard label="ยอดเบิกเดือนนี้" value={formatMoney(totalAdvanceThisMonth)} Icon={Coins} />
      </div>

      {/* Two-column panels */}
      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>
              ลาวันนี้ <span className="tabular-nums text-gray-500">({onLeaveToday.length})</span>
            </CardTitle>
          </CardHeader>
          <CardBody className="!p-0">
            {onLeaveToday.length === 0 ? (
              <EmptyState
                text="ไม่มีพนักงานลาวันนี้"
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
                    <p className="truncate text-sm font-medium text-gray-900">
                      {a.employee.firstName} {a.employee.lastName}
                      {a.employee.nickname && (
                        <span className="text-gray-500"> ({a.employee.nickname})</span>
                      )}
                    </p>
                    <p className="mt-0.5 text-xs text-gray-500">
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
              <EmptyState text="ยังไม่มีกิจกรรม" hint="กิจกรรมจะปรากฏที่นี่เมื่อมีการเปลี่ยนแปลง" />
            ) : (
              <ul className="divide-y divide-gray-100">
                {recentAudit.map((a) => (
                  <li key={a.id} className="px-5 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-gray-900">
                          {actionLabel(a.action)}
                        </p>
                        <p className="mt-0.5 text-xs text-gray-500">
                          โดย{' '}
                          {a.actorId ? (actorById.get(a.actorId) ?? a.actorId.slice(0, 8)) : 'ระบบ'}
                        </p>
                      </div>
                      <p className="shrink-0 text-[10px] text-gray-400">
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

// ─── KPI card (static, no-link variant) ────────────────────────────────────

function KpiCard({
  label,
  value,
  Icon,
  hint,
}: {
  label: string;
  value: number | string;
  Icon: React.ComponentType<{ size?: number; className?: string }>;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between">
        <Icon size={20} className="text-primary-500" />
        {hint && (
          <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-500">
            {hint}
          </span>
        )}
      </div>
      <p className="mt-3 text-xs font-medium uppercase tracking-wider text-gray-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-gray-900">{value}</p>
    </div>
  );
}

// ─── Empty state ───────────────────────────────────────────────────────────

function EmptyState({ text, hint }: { text: string; hint: string }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-10 text-center">
      <p className="text-sm font-medium text-gray-600">{text}</p>
      <p className="mt-1 text-xs text-gray-400">{hint}</p>
    </div>
  );
}
