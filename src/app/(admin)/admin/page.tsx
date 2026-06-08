/**
 * Admin dashboard — pending-work snapshot.
 *
 * Per docs/v1/screens/admin.md (S-A1 spec): four KPI cards at the top
 * surfacing today's action items, plus two side-by-side panels showing
 * (a) the top pending requests for inbox triage and (b) who's on leave
 * today for branch-coverage planning.
 *
 * All KPIs are computed via one Promise.all so the dashboard renders in
 * a single DB round-trip's wall-time. Each card links to its drill-in
 * inbox; admins should be able to land here, scan, and click straight
 * into the action they need to take.
 */

import Link from 'next/link';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { KpiHero } from '@/components/ui/kpi-hero';
import { PageHeader } from '@/components/ui/page-header';
import { Pill } from '@/components/ui/pill';
import { StatCard } from '@/components/ui/stat-card';
import { bangkokDateUtcMidnight, isClosedDay } from '@/lib/attendance/date';
import { canDo, requirePermission } from '@/lib/auth/check-permission';
import { prisma } from '@/lib/db/prisma';
import { getOrgCalendarData } from '@/lib/leave/team-calendar';
import { currentMonthYM, parseMonth } from '@/lib/leave/team-calendar-shape';
import { DashboardCalendarSummary } from './_calendar/dashboard-calendar-summary';

/**
 * Re-render the dashboard at most every 30 seconds.
 *
 * The KPIs (pending counts, on-leave-today, recent activity) are SHARED
 * across all admins — there's no per-user personalization on this page.
 * So a fresh /admin hit from Admin A returns the same HTML to Admin B
 * if it's been less than 30s since the last server render.
 *
 * Cost: counts can be up to 30s stale. Acceptable trade-off — admins
 * scanning the dashboard don't notice a 30s lag on "3 pending → 4 pending",
 * but DO notice a 1.5s page load every time they navigate here.
 *
 * Real-time-ness for urgent events still works: the bell + live board
 * use Supabase Realtime push, not page polling. The dashboard cards
 * are decoration — admins click through to the inbox for the real view.
 */
export const revalidate = 30;

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

function formatDateTimeShort(d: Date): string {
  return d.toLocaleString('th-TH', {
    timeZone: 'Asia/Bangkok',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default async function AdminHomePage() {
  const { user } = await requirePermission('dashboard.read');
  const canViewLiveBoard = await canDo(user, 'attendance.live-board');

  const today = bangkokDateUtcMidnight(new Date());
  const todayYmd = today.toISOString().slice(0, 10);

  // Current Bangkok month for the compact calendar summary.
  const initialYm = currentMonthYM();
  const calMonth = parseMonth(initialYm);
  if (!calMonth) throw new Error('Could not parse current month — date system broken?');

  // Single round-trip via Promise.all. Each query is small (~tens of rows
  // max at Phase-1 scale); the parallelism is mainly latency, not load.
  const [
    pendingLeaveCount,
    pendingAdvanceCount,
    checkedInTodayCount,
    activeEmployeeCount,
    onLeaveTodayCount,
    todayHoliday,
    pendingLeaveRecent,
    pendingAdvanceRecent,
    onLeaveToday,
    initialCalendar,
  ] = await Promise.all([
    prisma.leaveRequest.count({ where: { status: 'Pending' } }),
    prisma.cashAdvance.count({ where: { status: 'Pending' } }),
    prisma.attendance.count({ where: { type: 'CheckIn', date: today } }),
    prisma.employee.count({
      where: { archivedAt: null, status: { not: 'Archived' }, canCheckIn: true },
    }),
    // Distinct by employee: a date can hold two OnLeave rows (two halves), so
    // count people on leave, not rows.
    prisma.attendance
      .findMany({
        where: { type: 'OnLeave', date: today },
        distinct: ['employeeId'],
        select: { employeeId: true },
      })
      .then((rows) => rows.length),
    prisma.holiday.findFirst({
      where: { date: today, archivedAt: null },
      select: { name: true },
    }),
    prisma.leaveRequest.findMany({
      where: { status: 'Pending' },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: {
        id: true,
        createdAt: true,
        startDate: true,
        endDate: true,
        leaveType: { select: { name: true } },
        employee: { select: { firstName: true, lastName: true, nickname: true } },
      },
    }),
    prisma.cashAdvance.findMany({
      where: { status: 'Pending' },
      orderBy: { requestedAt: 'desc' },
      take: 5,
      select: {
        id: true,
        amount: true,
        requestedAt: true,
        employee: { select: { firstName: true, lastName: true, nickname: true } },
      },
    }),
    prisma.attendance.findMany({
      where: { type: 'OnLeave', date: today },
      distinct: ['employeeId'],
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
    getOrgCalendarData({ monthStart: calMonth.start, monthEnd: calMonth.end }),
  ]);

  // "ยังไม่เช็คอินวันนี้" = active employees minus those who've checked in
  // minus those on approved leave today. On Sundays + Holidays this is
  // structurally zero (nobody is expected to work).
  const closedToday = isClosedDay(today, todayHoliday !== null);
  const notCheckedInCount = closedToday
    ? 0
    : Math.max(0, activeEmployeeCount - checkedInTodayCount - onLeaveTodayCount);

  // Merge leave + advance pending into a unified chronological list (top 5).
  type PendingRow =
    | {
        kind: 'leave';
        id: string;
        createdAt: Date;
        title: string;
        subtitle: string;
        href: string;
      }
    | {
        kind: 'advance';
        id: string;
        createdAt: Date;
        title: string;
        subtitle: string;
        href: string;
      };

  const pendingRows: PendingRow[] = [
    ...pendingLeaveRecent.map<PendingRow>((r) => ({
      kind: 'leave',
      id: r.id,
      createdAt: r.createdAt,
      title: `${r.employee.firstName} ${r.employee.lastName}${
        r.employee.nickname ? ` (${r.employee.nickname})` : ''
      }`,
      subtitle: `${r.leaveType.name} • ${formatRangeShort(r.startDate, r.endDate)}`,
      href: '/admin/leave',
    })),
    ...pendingAdvanceRecent.map<PendingRow>((r) => ({
      kind: 'advance',
      id: r.id,
      createdAt: r.requestedAt,
      title: `${r.employee.firstName} ${r.employee.lastName}${
        r.employee.nickname ? ` (${r.employee.nickname})` : ''
      }`,
      subtitle: `เบิก ${formatMoney(r.amount)}`,
      href: '/admin/advance',
    })),
  ]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, 3);

  const todayLabel = new Date().toLocaleDateString('th-TH', {
    timeZone: 'Asia/Bangkok',
    weekday: 'long',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader
        breadcrumb="ภาพรวม"
        title="ภาพรวม"
        subtitle={`${todayLabel} · ภาพรวมทุกสาขา`}
        actions={
          closedToday ? (
            <Pill variant="neutral">
              {todayHoliday ? `วันหยุด: ${todayHoliday.name}` : 'วันอาทิตย์'}
            </Pill>
          ) : (
            <Pill variant="approved">● ระบบปกติ</Pill>
          )
        }
      />

      {/* Attendance hero + pending-count stats */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <KpiHero
            checkedIn={checkedInTodayCount}
            notCheckedIn={notCheckedInCount}
            total={activeEmployeeCount}
            leave={onLeaveTodayCount}
            checkedInHref={canViewLiveBoard ? '/admin/attendance/live?filter=checkedin' : undefined}
            notCheckedInHref={
              canViewLiveBoard ? '/admin/attendance/live?filter=notcheckedin' : undefined
            }
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
          <Link
            href="/admin/leave"
            className="block rounded-xl transition hover:-translate-y-0.5 hover:shadow-cta"
          >
            <StatCard
              label="คำขอลา รออนุมัติ"
              value={pendingLeaveCount}
              hint={<span className="font-medium text-primary-700">ไปจัดการ →</span>}
            />
          </Link>
          <Link
            href="/admin/advance"
            className="block rounded-xl transition hover:-translate-y-0.5 hover:shadow-cta"
          >
            <StatCard
              label="คำขอเบิก รออนุมัติ"
              value={pendingAdvanceCount}
              hint={<span className="font-medium text-primary-700">ไปจัดการ →</span>}
            />
          </Link>
        </div>
      </div>

      {/* Two-column action panels */}
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex items-center justify-between">
            <CardTitle>คำขอที่รอดำเนินการ</CardTitle>
            {pendingLeaveCount + pendingAdvanceCount > pendingRows.length && (
              <Link
                href="/admin/leave"
                className="text-xs font-medium text-primary-700 hover:text-primary-800"
              >
                ดูทั้งหมด →
              </Link>
            )}
          </CardHeader>
          <CardBody className="!p-0">
            {pendingRows.length === 0 ? (
              <EmptyState title="ไม่มีคำขอที่รอดำเนินการ ✨" hint="ทุกคำขอได้รับการตัดสินใจแล้ว" />
            ) : (
              <ul className="divide-y divide-gray-100">
                {pendingRows.map((r) => (
                  <li key={`${r.kind}:${r.id}`}>
                    <Link
                      href={r.href}
                      className="flex items-start justify-between gap-3 px-5 py-3 transition hover:bg-gray-50"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <Pill variant={r.kind === 'leave' ? 'leave' : 'pending'}>
                            {r.kind === 'leave' ? 'ลา' : 'เบิก'}
                          </Pill>
                          <p className="truncate text-sm font-medium text-ink-1">{r.title}</p>
                        </div>
                        <p className="mt-0.5 text-xs text-ink-3">{r.subtitle}</p>
                      </div>
                      <p className="shrink-0 text-[10px] text-ink-4">
                        {formatDateTimeShort(r.createdAt)}
                      </p>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>
              ลาวันนี้ <span className="tabular text-ink-3">({onLeaveToday.length})</span>
            </CardTitle>
          </CardHeader>
          <CardBody className="!p-0">
            {onLeaveToday.length === 0 ? (
              <p className="px-5 py-6 text-sm text-ink-3">
                ไม่มีพนักงานลาวันนี้
                {closedToday ? (todayHoliday ? ` — ${todayHoliday.name}` : ' — วันอาทิตย์') : ''}
              </p>
            ) : (
              <ul className="divide-y divide-gray-100">
                {onLeaveToday.map((a) => (
                  <li key={a.id} className="flex items-start justify-between gap-3 px-5 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-ink-1">
                        {a.employee.firstName} {a.employee.lastName}
                        {a.employee.nickname && (
                          <span className="text-ink-3"> ({a.employee.nickname})</span>
                        )}
                      </p>
                      <p className="mt-0.5 text-xs text-ink-3">
                        {a.leaveRequest?.leaveType.name ?? 'ลา'}
                        {a.leaveRequest && (
                          <>
                            {' '}
                            • {formatRangeShort(a.leaveRequest.startDate, a.leaveRequest.endDate)}
                          </>
                        )}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>

      {/* Compact upcoming-leave/holiday agenda — full grid lives at /admin/calendar */}
      <div className="mt-4">
        <DashboardCalendarSummary data={initialCalendar} todayYmd={todayYmd} />
      </div>
    </div>
  );
}
