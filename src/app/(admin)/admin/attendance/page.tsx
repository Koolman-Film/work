/**
 * /admin/attendance — historical records browser (S-N9).
 *
 * Per-day rows for whichever month + filters the admin selects. Used to
 * look up "did this employee actually check in on day X?" or "show me
 * all Late entries this month".
 *
 * Replaced the earlier redirect-to-/live placeholder. The "ลงเวลา"
 * sidebar link now lands on records (the historical view); admin jumps
 * to /live or /disputed via the top-right buttons.
 *
 * Clicking a row opens a detail modal (selfie + geofence map + every
 * recorded fact, same design as the /disputed pane); the row's void or
 * restore action lives in that modal's footer. The page stays a Server
 * Component — it builds serializable VMs (attendance-row-vm.ts) and the
 * AttendanceRecordsTable client island owns the selection state.
 *
 * Deduction columns from the spec wireframe are deliberately omitted —
 * payroll math lands in Phase 2. The column slot is reserved (visually
 * by leaving table room) so Phase 2 can drop it in without re-layout.
 *
 * Filters are URL-based (?ym, ?employeeId, ?type). This gives us:
 *   - browser back/forward works
 *   - shareable links to "show me Sarah's lates last month"
 *   - no client-side state to keep in sync with the URL bar
 */

import type { AttType } from '@prisma/client';
import Link from 'next/link';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import {
  employeeBranchScope,
  getPermittedBranches,
  viaEmployeeBranchScope,
} from '@/lib/auth/branch-scope';
import { requirePermission } from '@/lib/auth/check-permission';
import { prisma, prismaRaw } from '@/lib/db/prisma';
import { signAttendancePhotoUrls } from '@/lib/storage/signed-urls';
import { buildAttendanceRowVM, RECORD_SELECT, TYPE_LABELS } from './attendance-row-vm';
import { AttendanceTabs } from './attendance-tabs';
import { AttendanceRecordsTable } from './records-table';

type SearchParams = Promise<{
  ym?: string; // YYYY-MM, default current month
  employeeId?: string; // 'all' or empty = no filter
  type?: string; // attendance type or 'all'
  trash?: string; // '1' = show recently-deleted (void) rows
}>;

function currentMonthYM(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' }).slice(0, 7);
}

/** Parse YYYY-MM → [start, end] UTC-midnight Date pair. */
function parseMonth(ym: string): { start: Date; end: Date } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(ym);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  if (mo < 1 || mo > 12) return null;
  const start = new Date(Date.UTC(y, mo - 1, 1));
  const end = new Date(Date.UTC(y, mo, 0)); // last day of month at UTC midnight
  return { start, end };
}

/** Step a YYYY-MM by ±1 month. */
function shiftMonth(ym: string, delta: 1 | -1): string {
  const p = parseMonth(ym);
  if (!p) return ym;
  const y = p.start.getUTCFullYear();
  const mo = p.start.getUTCMonth();
  const next = new Date(Date.UTC(y, mo + delta, 1));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}`;
}

export default async function AttendanceRecordsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { user } = await requirePermission('attendance.read');

  const sp = await searchParams;
  const ym = sp.ym && /^\d{4}-\d{2}$/.test(sp.ym) ? sp.ym : currentMonthYM();
  // parseMonth always succeeds for currentMonthYM's output (the validated
  // YYYY-MM format), so the fallback is just to make TS narrow correctly.
  const month = parseMonth(ym) ?? parseMonth(currentMonthYM());
  if (!month) throw new Error('parseMonth failed for both URL ym and currentMonthYM');
  const employeeFilter = sp.employeeId && sp.employeeId !== 'all' ? sp.employeeId : null;
  const typeFilter: AttType | null =
    sp.type && sp.type !== 'all' && sp.type in TYPE_LABELS ? (sp.type as AttType) : null;
  const isTrash = sp.trash === '1';
  const permitted = await getPermittedBranches(user, 'attendance.read');
  const branchScope = viaEmployeeBranchScope(permitted);

  // Shared where: same month + filters for both live and trash views. The
  // trash view adds `deletedAt: { not: null }` and reads via prismaRaw (which
  // sees voided rows); the live view uses `prisma` (voided rows hidden).
  const baseWhere = {
    date: { gte: month.start, lte: month.end },
    ...(employeeFilter ? { employeeId: employeeFilter } : {}),
    ...(typeFilter ? { type: typeFilter } : {}),
    ...branchScope,
  };

  // Pull rows + employee list + disputed count in parallel.
  const [records, employees, disputedCount] = await Promise.all([
    isTrash
      ? prismaRaw.attendance.findMany({
          where: { ...baseWhere, deletedAt: { not: null } },
          orderBy: { deletedAt: 'desc' },
          take: 200,
          select: RECORD_SELECT,
        })
      : prisma.attendance.findMany({
          where: baseWhere,
          orderBy: [{ date: 'desc' }, { clockInAt: 'desc' }],
          take: 200,
          select: RECORD_SELECT,
        }),
    prisma.employee.findMany({
      where: { archivedAt: null, ...employeeBranchScope(permitted) },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
      select: {
        id: true,
        firstName: true,
        lastName: true,
        nickname: true,
      },
    }),
    prisma.attendance.count({
      where: { type: 'CheckIn', checkInStatus: 'Disputed', deletedAt: null, ...branchScope },
    }),
  ]);

  // Batch-sign all selfie keys in one Storage call, then build the VMs the
  // client table + detail modal consume.
  const selfieKeys = records
    .map((r) => r.checkInSelfieUrl)
    .filter((k): k is string => !!k && k.length > 0);
  const signedSelfieUrls = await signAttendancePhotoUrls(selfieKeys);
  const rows = records.map((r) =>
    buildAttendanceRowVM(r, {
      selfieUrl: r.checkInSelfieUrl ? (signedSelfieUrls.get(r.checkInSelfieUrl) ?? null) : null,
    }),
  );

  // Build URL helpers preserving other filters when changing one.
  function urlWith(updates: Record<string, string | null>) {
    const params = new URLSearchParams();
    const merged: Record<string, string | null> = {
      ym,
      employeeId: employeeFilter ?? 'all',
      type: typeFilter ?? 'all',
      trash: isTrash ? '1' : null,
      ...updates,
    };
    for (const [k, v] of Object.entries(merged)) {
      if (v && v !== 'all') params.set(k, v);
    }
    const q = params.toString();
    return q ? `/admin/attendance?${q}` : '/admin/attendance';
  }

  const monthLabel = month.start.toLocaleDateString('th-TH', {
    timeZone: 'UTC',
    month: 'long',
    year: 'numeric',
  });

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader
        breadcrumb="ลงเวลา"
        title="ประวัติการลงเวลา"
        subtitle="ดูข้อมูลการเช็คอิน/ลา/ขาด/สาย ของพนักงาน — คลิกแถวเพื่อดูรายละเอียด"
      />
      <AttendanceTabs current="records" disputedCount={disputedCount} />

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {/* Month nav */}
        <div className="inline-flex items-center rounded-lg border border-gray-200 bg-white">
          <Link
            href={urlWith({ ym: shiftMonth(ym, -1) })}
            className="px-2 py-1.5 text-sm text-ink-3 transition hover:bg-gray-50 hover:text-ink-1"
            aria-label="เดือนก่อน"
          >
            ‹
          </Link>
          <span className="border-x border-gray-200 px-3 py-1.5 text-xs font-semibold text-ink-1">
            {monthLabel}
          </span>
          <Link
            href={urlWith({ ym: shiftMonth(ym, 1) })}
            className="px-2 py-1.5 text-sm text-ink-3 transition hover:bg-gray-50 hover:text-ink-1"
            aria-label="เดือนถัดไป"
          >
            ›
          </Link>
        </div>

        <EmployeeSelect
          employees={employees}
          selectedId={employeeFilter}
          urlFor={(id) => urlWith({ employeeId: id })}
        />
        <TypeSelect selectedType={typeFilter} urlFor={(t) => urlWith({ type: t })} />

        {(employeeFilter || typeFilter) && (
          <Link
            href={urlWith({ employeeId: 'all', type: 'all' })}
            className="text-xs text-ink-4 underline hover:text-ink-2"
          >
            ล้างตัวกรอง
          </Link>
        )}

        <span className="mx-1 h-4 w-px bg-gray-200" aria-hidden="true" />
        <Link
          href={urlWith({ trash: null })}
          className={
            !isTrash
              ? 'rounded-lg bg-primary-50 px-3 py-1.5 text-xs font-semibold text-primary-700 ring-1 ring-primary-200'
              : 'rounded-lg px-3 py-1.5 text-xs font-semibold text-ink-4 hover:bg-gray-50 hover:text-ink-2'
          }
        >
          รายการปัจจุบัน
        </Link>
        <Link
          href={urlWith({ trash: '1' })}
          className={
            isTrash
              ? 'rounded-lg bg-primary-50 px-3 py-1.5 text-xs font-semibold text-primary-700 ring-1 ring-primary-200'
              : 'rounded-lg px-3 py-1.5 text-xs font-semibold text-ink-4 hover:bg-gray-50 hover:text-ink-2'
          }
        >
          🗑️ ถังขยะ
        </Link>
      </div>

      <div className="mb-2 text-xs text-ink-3">
        ผลลัพธ์ <span className="tabular-nums">({rows.length})</span>
        {rows.length === 200 && (
          <span className="ml-2 text-ink-4">(แสดง 200 รายการแรก — ใช้ตัวกรองเพื่อแคบลง)</span>
        )}
      </div>

      <AttendanceRecordsTable
        rows={rows}
        isTrash={isTrash}
        empty={
          <div className="surface">
            <EmptyState
              title={isTrash ? 'ถังขยะว่าง' : 'ไม่พบรายการในเดือน + ตัวกรองนี้'}
              hint={isTrash ? 'ไม่มีรายการที่ถูกลบในเดือนนี้' : undefined}
            />
          </div>
        }
      />
    </div>
  );
}

// ─── Filter widgets ──────────────────────────────────────────────────────

function EmployeeSelect({
  employees,
  selectedId,
  urlFor,
}: {
  employees: { id: string; firstName: string; lastName: string; nickname: string | null }[];
  selectedId: string | null;
  urlFor: (id: string) => string;
}) {
  const selected = selectedId ? employees.find((x) => x.id === selectedId) : null;
  const label = selected ? `${selected.firstName} ${selected.lastName}` : 'ทั้งหมด';
  return (
    <details className="relative inline-block">
      <summary className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-ink-2 hover:bg-gray-50 [&::-webkit-details-marker]:hidden">
        พนักงาน:
        <span className="font-medium text-ink-1">{label}</span>
        <span className="text-ink-4">▾</span>
      </summary>
      <div className="absolute left-0 z-20 mt-1 max-h-[60vh] w-64 overflow-y-auto rounded-lg border border-gray-200 bg-white py-1 shadow-card">
        <Link
          href={urlFor('all')}
          className="block px-3 py-1.5 text-sm text-ink-2 hover:bg-gray-50"
        >
          ทั้งหมด
        </Link>
        {employees.map((e) => (
          <Link
            key={e.id}
            href={urlFor(e.id)}
            className="block px-3 py-1.5 text-sm text-ink-2 hover:bg-gray-50"
          >
            {e.firstName} {e.lastName}
            {e.nickname && <span className="text-ink-3"> ({e.nickname})</span>}
          </Link>
        ))}
      </div>
    </details>
  );
}

function TypeSelect({
  selectedType,
  urlFor,
}: {
  selectedType: string | null;
  urlFor: (t: string) => string;
}) {
  return (
    <details className="relative inline-block">
      <summary className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-ink-2 hover:bg-gray-50 [&::-webkit-details-marker]:hidden">
        ประเภท:
        <span className="font-medium text-ink-1">
          {selectedType ? TYPE_LABELS[selectedType]?.label : 'ทั้งหมด'}
        </span>
        <span className="text-ink-4">▾</span>
      </summary>
      <div className="absolute left-0 z-20 mt-1 w-44 rounded-lg border border-gray-200 bg-white py-1 shadow-card">
        <Link
          href={urlFor('all')}
          className="block px-3 py-1.5 text-sm text-ink-2 hover:bg-gray-50"
        >
          ทั้งหมด
        </Link>
        {Object.entries(TYPE_LABELS).map(([k, v]) => (
          <Link
            key={k}
            href={urlFor(k)}
            className="block px-3 py-1.5 text-sm text-ink-2 hover:bg-gray-50"
          >
            {v.label}
          </Link>
        ))}
      </div>
    </details>
  );
}
