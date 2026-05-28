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

import { Calendar, CheckCircle2, Coins, UserX } from 'lucide-react';
import Link from 'next/link';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { requirePermission } from '@/lib/auth/check-permission';
import { prisma } from '@/lib/db/prisma';

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

/**
 * Today as UTC midnight matching @db.Date semantics — same helper as
 * check-in.ts / live.ts. Inlined here to keep the dashboard import graph
 * tiny.
 */
function bangkokDateUtcMidnight(d: Date): Date {
  const ymd = d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' });
  return new Date(`${ymd}T00:00:00.000Z`);
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
  await requirePermission('dashboard.read');

  const today = bangkokDateUtcMidnight(new Date());
  const todayIsSunday = today.getUTCDay() === 0;

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
  ] = await Promise.all([
    prisma.leaveRequest.count({ where: { status: 'Pending' } }),
    prisma.cashAdvance.count({ where: { status: 'Pending' } }),
    prisma.attendance.count({ where: { type: 'CheckIn', date: today } }),
    prisma.employee.count({
      where: { archivedAt: null, status: { not: 'Archived' }, canCheckIn: true },
    }),
    prisma.attendance.count({ where: { type: 'OnLeave', date: today } }),
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
  ]);

  // "ยังไม่เช็คอินวันนี้" = active employees minus those who've checked in
  // minus those on approved leave today. On Sundays + Holidays this is
  // structurally zero (nobody is expected to work).
  const isClosedDay = todayIsSunday || todayHoliday !== null;
  const notCheckedInCount = isClosedDay
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
      subtitle: `ลา${r.leaveType.name} • ${formatRangeShort(r.startDate, r.endDate)}`,
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
    .slice(0, 5);

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">ภาพรวม</h1>
        <p className="mt-1 text-sm text-gray-500">คำขอ การลงเวลา และเงินเดือน — ดูทั้งหมดในที่เดียว</p>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <KpiCard
          label="คำขอลา รออนุมัติ"
          value={pendingLeaveCount}
          Icon={Calendar}
          href="/admin/leave"
          accent="amber"
        />
        <KpiCard
          label="คำขอเบิก รออนุมัติ"
          value={pendingAdvanceCount}
          Icon={Coins}
          href="/admin/advance"
          accent="amber"
        />
        <KpiCard
          label="เช็คอินวันนี้"
          value={checkedInTodayCount}
          Icon={CheckCircle2}
          href="/admin/attendance/live"
          accent="green"
          hint={
            todayHoliday ? `วันหยุด: ${todayHoliday.name}` : todayIsSunday ? 'วันอาทิตย์' : undefined
          }
        />
        <KpiCard
          label="ยังไม่เช็คอินวันนี้"
          value={notCheckedInCount}
          Icon={UserX}
          href="/admin/attendance/live"
          accent={notCheckedInCount > 0 ? 'red' : 'gray'}
          hint={isClosedDay ? 'วันหยุดประจำสัปดาห์' : undefined}
        />
      </div>

      {/* Two-column action panels */}
      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex items-center justify-between">
            <CardTitle>คำขอที่รอดำเนินการ</CardTitle>
            {pendingLeaveCount + pendingAdvanceCount > pendingRows.length && (
              <Link
                href="/admin/leave"
                className="text-xs font-medium text-primary-600 hover:text-primary-700"
              >
                ดูทั้งหมด →
              </Link>
            )}
          </CardHeader>
          <CardBody className="!p-0">
            {pendingRows.length === 0 ? (
              <EmptyState text="ไม่มีคำขอที่รอดำเนินการ ✨" hint="ทุกคำขอได้รับการตัดสินใจแล้ว" />
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
                          <KindBadge kind={r.kind} />
                          <p className="truncate text-sm font-medium text-gray-900">{r.title}</p>
                        </div>
                        <p className="mt-0.5 text-xs text-gray-500">{r.subtitle}</p>
                      </div>
                      <p className="shrink-0 text-[10px] text-gray-400">
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
                  <li key={a.id} className="flex items-start justify-between gap-3 px-5 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-gray-900">
                        {a.employee.firstName} {a.employee.lastName}
                        {a.employee.nickname && (
                          <span className="text-gray-500"> ({a.employee.nickname})</span>
                        )}
                      </p>
                      <p className="mt-0.5 text-xs text-gray-500">
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
    </div>
  );
}

// ─── KPI card ──────────────────────────────────────────────────────────────

type KpiCardProps = {
  label: string;
  value: number | string;
  Icon: React.ComponentType<{ size?: number; className?: string }>;
  href: string;
  /** Subtle accent applied to the value when it's actionable (e.g. red
   *  for "missing employees", amber for pending work). */
  accent?: 'amber' | 'red' | 'green' | 'gray';
  hint?: string;
};

const ACCENT_CLASSES: Record<NonNullable<KpiCardProps['accent']>, string> = {
  amber: 'text-amber-700',
  red: 'text-red-700',
  green: 'text-green-700',
  gray: 'text-gray-900',
};

function KpiCard({ label, value, Icon, href, accent = 'gray', hint }: KpiCardProps) {
  const valueColor =
    typeof value === 'number' && value === 0 ? 'text-gray-300' : ACCENT_CLASSES[accent];

  return (
    <Link
      href={href}
      className="block rounded-lg border border-gray-200 bg-white p-4 shadow-sm transition hover:border-primary-300 hover:shadow-brand"
    >
      <div className="flex items-start justify-between">
        <Icon size={20} className="text-primary-500" />
        {hint && (
          <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-500">
            {hint}
          </span>
        )}
      </div>
      <p className="mt-3 text-xs font-medium uppercase tracking-wider text-gray-500">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${valueColor}`}>{value}</p>
    </Link>
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

// ─── Kind badge ────────────────────────────────────────────────────────────

function KindBadge({ kind }: { kind: 'leave' | 'advance' }) {
  return kind === 'leave' ? (
    <span className="shrink-0 rounded-full bg-primary-100 px-2 py-0.5 text-[10px] font-medium text-primary-800">
      ลา
    </span>
  ) : (
    <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800">
      เบิก
    </span>
  );
}
