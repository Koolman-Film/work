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
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { requireRole } from '@/lib/auth/require-role';
import { prisma } from '@/lib/db/prisma';

type SearchParams = Promise<{
  ym?: string; // YYYY-MM, default current month
  employeeId?: string; // 'all' or empty = no filter
  type?: string; // attendance type or 'all'
}>;

const TYPE_LABELS: Record<string, { label: string; cls: string }> = {
  CheckIn: { label: 'เช็คอิน', cls: 'bg-green-100 text-green-800' },
  CheckOut: { label: 'เช็คเอาท์', cls: 'bg-blue-100 text-blue-800' },
  Late: { label: 'มาสาย', cls: 'bg-amber-100 text-amber-800' },
  EarlyLeave: { label: 'ออกก่อน', cls: 'bg-amber-100 text-amber-800' },
  Absent: { label: 'ขาดงาน', cls: 'bg-red-100 text-red-800' },
  OnLeave: { label: 'ลา', cls: 'bg-primary-100 text-primary-800' },
};

const SOURCE_LABELS: Record<string, string> = {
  Liff: 'LINE',
  Excel: 'Excel',
  Manual: 'คีย์มือ',
  Both: 'Liff+Excel',
};

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

function formatDate(d: Date): string {
  return d.toLocaleDateString('th-TH', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'short',
  });
}

function formatTime(d: Date | null): string {
  if (!d) return '—';
  return d.toLocaleTimeString('th-TH', {
    timeZone: 'Asia/Bangkok',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDuration(min: number | null): string {
  if (min == null) return '—';
  if (min < 60) return `${min} นาที`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h} ชม.` : `${h} ชม. ${m} นาที`;
}

export default async function AttendanceRecordsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  await requireRole(['Admin']);

  const sp = await searchParams;
  const ym = sp.ym && /^\d{4}-\d{2}$/.test(sp.ym) ? sp.ym : currentMonthYM();
  // parseMonth always succeeds for currentMonthYM's output (the validated
  // YYYY-MM format), so the fallback is just to make TS narrow correctly.
  const month = parseMonth(ym) ?? parseMonth(currentMonthYM());
  if (!month) throw new Error('parseMonth failed for both URL ym and currentMonthYM');
  const employeeFilter = sp.employeeId && sp.employeeId !== 'all' ? sp.employeeId : null;
  const typeFilter: AttType | null =
    sp.type && sp.type !== 'all' && sp.type in TYPE_LABELS ? (sp.type as AttType) : null;

  // Pull rows + employee list for filter dropdown in parallel.
  const [rows, employees] = await Promise.all([
    prisma.attendance.findMany({
      where: {
        date: { gte: month.start, lte: month.end },
        ...(employeeFilter ? { employeeId: employeeFilter } : {}),
        ...(typeFilter ? { type: typeFilter } : {}),
      },
      orderBy: [{ date: 'desc' }, { clockInAt: 'desc' }],
      take: 200,
      select: {
        id: true,
        date: true,
        type: true,
        source: true,
        durationMinutes: true,
        clockInAt: true,
        clockOutAt: true,
        checkInStatus: true,
        disputeReason: true,
        employee: {
          select: {
            firstName: true,
            lastName: true,
            nickname: true,
          },
        },
        checkInBranch: { select: { name: true } },
      },
    }),
    prisma.employee.findMany({
      where: { archivedAt: null },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
      select: {
        id: true,
        firstName: true,
        lastName: true,
        nickname: true,
      },
    }),
  ]);

  // Build URL helpers preserving other filters when changing one.
  function urlWith(updates: Record<string, string | null>) {
    const params = new URLSearchParams();
    const merged = {
      ym,
      employeeId: employeeFilter ?? 'all',
      type: typeFilter ?? 'all',
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
    <div className="mx-auto max-w-6xl px-6 py-8">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">ประวัติการลงเวลา</h1>
          <p className="mt-1 text-sm text-gray-500">ดูข้อมูลการเช็คอิน/ลา/ขาด/สาย ของพนักงาน</p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/admin/attendance/manual"
            className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
          >
            + คีย์มือ
          </Link>
          <Link
            href="/admin/attendance/live"
            className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
          >
            🔴 วันนี้ (live)
          </Link>
          <Link
            href="/admin/attendance/disputed"
            className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
          >
            ⚠️ ต้องตรวจสอบ
          </Link>
        </div>
      </div>

      {/* Filters row */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        {/* Month nav */}
        <div className="inline-flex items-center rounded-md border border-gray-200 bg-white">
          <Link
            href={urlWith({ ym: shiftMonth(ym, -1) })}
            className="px-2 py-1.5 text-sm text-gray-500 hover:bg-gray-50 hover:text-gray-900"
            aria-label="เดือนก่อน"
          >
            ‹
          </Link>
          <span className="border-x border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-900">
            {monthLabel}
          </span>
          <Link
            href={urlWith({ ym: shiftMonth(ym, 1) })}
            className="px-2 py-1.5 text-sm text-gray-500 hover:bg-gray-50 hover:text-gray-900"
            aria-label="เดือนถัดไป"
          >
            ›
          </Link>
        </div>

        {/* Employee filter */}
        <EmployeeSelect
          employees={employees}
          selectedId={employeeFilter}
          urlFor={(id) => urlWith({ employeeId: id })}
        />

        {/* Type filter */}
        <TypeSelect selectedType={typeFilter} urlFor={(t) => urlWith({ type: t })} />

        {(employeeFilter || typeFilter) && (
          <Link
            href={urlWith({ employeeId: 'all', type: 'all' })}
            className="text-xs text-gray-500 underline hover:text-gray-700"
          >
            ล้างตัวกรอง
          </Link>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            ผลลัพธ์ <span className="tabular-nums text-gray-500">({rows.length})</span>
            {rows.length === 200 && (
              <span className="ml-2 text-xs font-normal text-gray-400">
                (แสดง 200 รายการแรก — ใช้ตัวกรองเพื่อแคบลง)
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardBody className="!p-0">
          {rows.length === 0 ? (
            <div className="px-6 py-12 text-center">
              <p className="text-sm text-gray-500">ไม่พบรายการในเดือน + ตัวกรองนี้</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium">วันที่</th>
                    <th className="px-4 py-3 text-left font-medium">พนักงาน</th>
                    <th className="px-4 py-3 text-left font-medium">ประเภท</th>
                    <th className="px-4 py-3 text-left font-medium">เวลา</th>
                    <th className="px-4 py-3 text-left font-medium">Duration</th>
                    <th className="px-4 py-3 text-left font-medium">ที่มา</th>
                    <th className="px-4 py-3 text-left font-medium">หมายเหตุ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {rows.map((r) => {
                    const typeMeta = TYPE_LABELS[r.type] ?? {
                      label: r.type,
                      cls: 'bg-gray-100 text-gray-700',
                    };
                    return (
                      <tr key={r.id} className="hover:bg-gray-50">
                        <td className="whitespace-nowrap px-4 py-3 text-gray-900">
                          {formatDate(r.date)}
                        </td>
                        <td className="px-4 py-3 text-gray-900">
                          {r.employee.firstName} {r.employee.lastName}
                          {r.employee.nickname && (
                            <span className="text-gray-500"> ({r.employee.nickname})</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${typeMeta.cls}`}
                          >
                            {typeMeta.label}
                          </span>
                          {r.checkInStatus === 'Disputed' && (
                            <span className="ml-1 rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-medium text-orange-800">
                              ⚠️ ตรวจสอบ
                            </span>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-gray-700">
                          {r.type === 'CheckIn' || r.type === 'CheckOut' ? (
                            <>
                              {formatTime(r.clockInAt)}
                              {r.clockOutAt && ` – ${formatTime(r.clockOutAt)}`}
                            </>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="px-4 py-3 text-gray-700">
                          {formatDuration(r.durationMinutes)}
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-500">
                          {SOURCE_LABELS[r.source] ?? r.source}
                          {r.checkInBranch && (
                            <span className="ml-1 text-gray-400">• {r.checkInBranch.name}</span>
                          )}
                        </td>
                        <td className="max-w-xs truncate px-4 py-3 text-xs text-gray-500">
                          {r.disputeReason ?? '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>
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
      <summary className="flex cursor-pointer items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 [&::-webkit-details-marker]:hidden">
        พนักงาน:
        <span className="font-medium text-gray-900">{label}</span>
        <span className="text-gray-400">▾</span>
      </summary>
      <div className="absolute left-0 z-20 mt-1 max-h-[60vh] w-64 overflow-y-auto rounded-md border border-gray-200 bg-white py-1 shadow-lg">
        <Link
          href={urlFor('all')}
          className="block px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100"
        >
          ทั้งหมด
        </Link>
        {employees.map((e) => (
          <Link
            key={e.id}
            href={urlFor(e.id)}
            className="block px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100"
          >
            {e.firstName} {e.lastName}
            {e.nickname && <span className="text-gray-500"> ({e.nickname})</span>}
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
      <summary className="flex cursor-pointer items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 [&::-webkit-details-marker]:hidden">
        ประเภท:
        <span className="font-medium text-gray-900">
          {selectedType ? TYPE_LABELS[selectedType]?.label : 'ทั้งหมด'}
        </span>
        <span className="text-gray-400">▾</span>
      </summary>
      <div className="absolute left-0 z-20 mt-1 w-44 rounded-md border border-gray-200 bg-white py-1 shadow-lg">
        <Link
          href={urlFor('all')}
          className="block px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100"
        >
          ทั้งหมด
        </Link>
        {Object.entries(TYPE_LABELS).map(([k, v]) => (
          <Link
            key={k}
            href={urlFor(k)}
            className="block px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100"
          >
            {v.label}
          </Link>
        ))}
      </div>
    </details>
  );
}
