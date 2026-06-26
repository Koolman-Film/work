import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { type Column, ResponsiveTable } from '@/components/ui/responsive-table';
import { StatCard } from '@/components/ui/stat-card';
import { StatusBadge, type StatusKey } from '@/components/ui/status-badge';
import { canDo } from '@/lib/auth/check-permission';
import { requireRole } from '@/lib/auth/require-role';
import { prisma } from '@/lib/db/prisma';
import { formatTHB, formatTHB2, monthLabelTh } from '@/lib/format';
import { deductionBreakdown, deductionBreakdownLabel } from '@/lib/payroll/deduction-breakdown';
import { previewPayrollDrafts } from '@/lib/payroll/run';
import { asUuid, loadReportFilterOptions } from '../reports/_load-filter-options';
import { ReportFilters } from '../reports/report-filters';
import {
  calculatePayrollAction,
  createRowAdjustment,
  deleteRowAdjustment,
  lockPayrollAction,
  publishPayrollAction,
} from './actions';
import { RowAdjust, type RowAdjustment } from './row-adjust';
import { RunActionForm } from './run-action-form';

/**
 * /admin/payroll — monthly payroll run (รันเงินเดือนรายเดือน).
 *
 * Flow: เลือกเดือน → คำนวณ (Draft) → ตรวจตาราง → เผยแพร่ (Published, ส่ง LINE)
 * → ล็อก (Locked). The table lists every Payroll row of the month with its
 * income/deduction buckets and a company-total summary strip (requirement:
 * "ยอดสรุป เงินสุทธิทั้งหมดในแต่ละเดือน").
 *
 * Buttons render only when the current admin holds the matching permission
 * (payroll.run / payroll.publish) — the Server Actions re-enforce anyway.
 */

type SearchParams = Promise<{
  m?: string;
  msg?: string;
  branchId?: string;
  departmentId?: string;
}>;

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Current YYYY-MM in Bangkok. */
function currentMonth(): string {
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    timeZone: 'Asia/Bangkok',
  }).format(new Date());
}

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y as number, (m as number) - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

const STATUS_INFO: Record<string, { key: StatusKey; label: string }> = {
  Draft: { key: 'draft', label: 'ฉบับร่าง' },
  Published: { key: 'published', label: 'เผยแพร่แล้ว' },
  Locked: { key: 'locked', label: 'ล็อกแล้ว' },
};

export default async function PayrollRunPage({ searchParams }: { searchParams: SearchParams }) {
  const { m, msg, branchId: rawBranchId, departmentId: rawDepartmentId } = await searchParams;
  const month = m && MONTH_RE.test(m) ? m : currentMonth();
  const branchId = asUuid(rawBranchId);
  const departmentId = asUuid(rawDepartmentId);
  const hasFilter = Boolean(branchId || departmentId);
  // Suffix appended to the month-nav links so changing month keeps the active
  // branch/department filter (the ReportFilters side preserves `m` likewise).
  const filterQs =
    (branchId ? `&branchId=${branchId}` : '') +
    (departmentId ? `&departmentId=${departmentId}` : '');

  const { user } = await requireRole(['Admin', 'Superadmin']);
  const [mayRun, mayPublish] = await Promise.all([
    canDo(user, 'payroll.run'),
    canDo(user, 'payroll.publish'),
  ]);

  // Fetch the FULL month, unfiltered — the run actions (คำนวณ/เผยแพร่/ล็อก) are
  // month-wide, so their status counts and the "calculated N of M" note below
  // must reflect every row, not the filtered view (decision: branch/department
  // is a VIEW filter only). branchId/departmentId on the employee feed the
  // in-memory filter for the table + summary totals.
  const rows = await prisma.payroll.findMany({
    where: { month },
    orderBy: { employee: { firstName: 'asc' } },
    include: {
      employee: {
        select: {
          firstName: true,
          lastName: true,
          nickname: true,
          branchId: true,
          departmentId: true,
        },
      },
    },
  });

  // The filtered view that drives the table + the summary-strip totals.
  const visibleRows = hasFilter
    ? rows.filter(
        (r) =>
          (!branchId || r.employee.branchId === branchId) &&
          (!departmentId || r.employee.departmentId === departmentId),
      )
    : rows;

  const [activeEmployees, options] = await Promise.all([
    prisma.employee.count({ where: { status: { not: 'Archived' } } }),
    loadReportFilterOptions(),
  ]);

  // Stale-draft detection: a Draft row is "stale" when recomputing it now
  // (same engine คำนวณใหม่ uses) yields different numbers — i.e. its inputs
  // (ลงเวลา / ลา / เบิก / เงินเพิ่ม-ลด / ฐานเงินเดือน / ตั้งค่า) changed since the
  // last คำนวณ. Only Draft rows can drift; Published/Locked are frozen.
  // Wrapped defensively so a calc hiccup never blanks the whole page.
  const hasDraft = rows.some((r) => r.status === 'Draft');
  const fresh = hasDraft ? await previewPayrollDrafts(month).catch(() => null) : null;
  const staleIds = new Set(
    rows
      .filter((r) => {
        if (r.status !== 'Draft' || !fresh) return false;
        const f = fresh.get(r.employeeId);
        if (!f) return false;
        return (
          r.incomeBase.toFixed(2) !== f.incomeBase.toFixed(2) ||
          r.incomeOther.toFixed(2) !== f.incomeOther.toFixed(2) ||
          r.deductSso.toFixed(2) !== f.deductSso.toFixed(2) ||
          r.deductAdvance.toFixed(2) !== f.deductAdvance.toFixed(2) ||
          r.deductAttendance.toFixed(2) !== f.deductAttendance.toFixed(2) ||
          r.deductLeave.toFixed(2) !== f.deductLeave.toFixed(2) ||
          r.deductDebt.toFixed(2) !== f.deductDebt.toFixed(2) ||
          r.deductOther.toFixed(2) !== f.deductOther.toFixed(2)
        );
      })
      .map((r) => r.id),
  );
  // Count over the visible (filtered) view so the banner matches what's shown.
  const staleVisibleCount = visibleRows.filter((r) => staleIds.has(r.id)).length;

  // Adjustments applying to this month, grouped per employee — feeds the
  // per-row "เพิ่ม/ลด" modal so the admin sees + manages them in place.
  const monthAdjustments = await prisma.payrollAdjustment.findMany({
    where: {
      startMonth: { lte: month },
      OR: [{ endMonth: null }, { endMonth: { gte: month } }],
      deletedAt: null,
    },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      employeeId: true,
      kind: true,
      reason: true,
      amount: true,
      startMonth: true,
      endMonth: true,
    },
  });
  const adjByEmployee = new Map<string, RowAdjustment[]>();
  for (const a of monthAdjustments) {
    const label =
      a.endMonth === null
        ? `${monthLabelTh(a.startMonth)} เป็นต้นไป`
        : a.endMonth === a.startMonth
          ? monthLabelTh(a.startMonth)
          : `${monthLabelTh(a.startMonth)} – ${monthLabelTh(a.endMonth)}`;
    const list = adjByEmployee.get(a.employeeId) ?? [];
    list.push({
      id: a.id,
      kind: a.kind,
      reason: a.reason,
      amountLabel: formatTHB2(a.amount.toNumber()),
      windowLabel: label,
    });
    adjByEmployee.set(a.employeeId, list);
  }

  // Totals follow the filtered view (decision: view filter — see above).
  const sum = (pick: (r: (typeof rows)[number]) => number) =>
    visibleRows.reduce((acc, r) => acc + pick(r), 0);
  const totals = {
    incomeBase: sum((r) => r.incomeBase.toNumber()),
    incomeOther: sum((r) => r.incomeOther.toNumber()),
    deductSso: sum((r) => r.deductSso.toNumber()),
    deductions: sum(
      (r) =>
        r.deductAdvance.toNumber() +
        r.deductAttendance.toNumber() +
        r.deductLeave.toNumber() +
        r.deductDebt.toNumber() +
        r.deductOther.toNumber(),
    ),
    netPay: sum((r) => r.netPay.toNumber()),
  };

  const statusCounts = {
    Draft: rows.filter((r) => r.status === 'Draft').length,
    Published: rows.filter((r) => r.status === 'Published').length,
    Locked: rows.filter((r) => r.status === 'Locked').length,
  };

  const columns: Column<(typeof rows)[number]>[] = [
    {
      key: 'employee',
      header: 'พนักงาน',
      cell: (r) => (
        <span className="font-medium text-ink-1">
          {r.employee.firstName} {r.employee.lastName}
          {r.employee.nickname ? ` (${r.employee.nickname})` : ''}
        </span>
      ),
    },
    {
      key: 'base',
      header: 'ฐานเงินเดือน',
      cell: (r) => (
        <span className="font-mono text-ink-2">{formatTHB2(r.incomeBase.toNumber())}</span>
      ),
    },
    {
      key: 'incomeOther',
      header: 'เงินเพิ่ม',
      cell: (r) =>
        r.incomeOther.isZero() ? (
          <span className="text-xs text-ink-4">—</span>
        ) : (
          <span className="font-mono text-emerald-700">
            +{formatTHB2(r.incomeOther.toNumber())}
          </span>
        ),
    },
    {
      key: 'sso',
      header: 'ประกันสังคม',
      cell: (r) =>
        r.deductSso.isZero() ? (
          <span className="text-xs text-ink-4">—</span>
        ) : (
          <span className="font-mono text-ink-2">-{formatTHB2(r.deductSso.toNumber())}</span>
        ),
    },
    {
      key: 'otherDeducts',
      header: 'รายการหัก',
      cell: (r) => {
        const lines = deductionBreakdown({
          advance: r.deductAdvance.toNumber(),
          attendance: r.deductAttendance.toNumber(),
          leave: r.deductLeave.toNumber(),
          debt: r.deductDebt.toNumber(),
          other: r.deductOther.toNumber(),
        });
        if (lines.length === 0) return <span className="text-xs text-ink-4">—</span>;
        const v = lines.reduce((acc, l) => acc + l.amount, 0);
        return (
          <div>
            <span className="font-mono text-red-700">-{formatTHB2(v)}</span>
            {/* Inline breakdown so the total reconciles at a glance (e.g. why a
                ฿9,200 advance shows as ฿9,700 — a ฿500 absence). Single-bucket
                rows show just the label, since the amount equals the total. */}
            <span className="mt-0.5 block text-[10px] leading-tight text-ink-4">
              {lines.length === 1 ? lines[0]?.label : deductionBreakdownLabel(lines)}
            </span>
          </div>
        );
      },
    },
    {
      key: 'net',
      header: 'สุทธิ',
      // Negative net (deductions exceed pay) is legal in the calc but almost
      // always a data problem — paint it red so the admin catches it before
      // pressing เผยแพร่.
      cell: (r) => (
        <span
          className={`font-mono font-semibold ${r.netPay.isNegative() ? 'text-red-700' : 'text-ink-1'}`}
        >
          {formatTHB2(r.netPay.toNumber())}
          {r.netPay.isNegative() && (
            <span className="ml-1 align-middle text-[10px] font-bold text-red-700">⚠ ติดลบ</span>
          )}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'สถานะ',
      cell: (r) => {
        const info = STATUS_INFO[r.status];
        return (
          <span className="inline-flex flex-wrap items-center gap-1.5">
            {info ? <StatusBadge status={info.key}>{info.label}</StatusBadge> : null}
            {staleIds.has(r.id) && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800">
                ⚠ ต้องคำนวณใหม่
              </span>
            )}
          </span>
        );
      },
    },
  ];

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader
        breadcrumb="การเงิน"
        title="เงินเดือน"
        subtitle="คำนวณ ตรวจสอบ และเผยแพร่สลิปเงินเดือนรายเดือน"
        actions={
          <Link href="/admin/payroll/adjustments">
            <Button variant="secondary">เงินเพิ่ม / เงินลด</Button>
          </Link>
        }
      />

      {/* Month nav + branch/department filter. The month nav keeps its own
          href (the filter component preserves `m` on its side, so both stay
          in sync). */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        {/* Month nav — same compound control as /admin/attendance */}
        <div className="inline-flex items-center rounded-lg border border-gray-200 bg-white">
          <Link
            href={`/admin/payroll?m=${shiftMonth(month, -1)}${filterQs}`}
            className="px-2 py-1.5 text-sm text-ink-3 transition hover:bg-gray-50 hover:text-ink-1"
            aria-label="เดือนก่อน"
          >
            ‹
          </Link>
          <span className="border-x border-gray-200 px-3 py-1.5 text-xs font-semibold text-ink-1">
            {monthLabelTh(month)}
          </span>
          <Link
            href={`/admin/payroll?m=${shiftMonth(month, 1)}${filterQs}`}
            className="px-2 py-1.5 text-sm text-ink-3 transition hover:bg-gray-50 hover:text-ink-1"
            aria-label="เดือนถัดไป"
          >
            ›
          </Link>
        </div>
        <ReportFilters
          period={{ m: month }}
          branchId={branchId ?? ''}
          departmentId={departmentId ?? ''}
          q=""
          branches={options.branches}
          departments={options.departments}
          showSearch={false}
        />
      </div>

      {msg && (
        <div
          role="status"
          className="mb-4 rounded-lg bg-success-soft px-4 py-3 text-sm text-success-deep"
        >
          {decodeURIComponent(msg)}
        </div>
      )}

      {/* Stale-draft warning — data changed since the last คำนวณ, so the draft
          numbers are out of date until recalculated. Made deliberately loud. */}
      {staleVisibleCount > 0 && (
        <div
          role="alert"
          className="mb-4 flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3"
        >
          <span aria-hidden="true" className="text-lg leading-none">
            ⚠️
          </span>
          <div className="min-w-0 text-sm">
            <p className="font-semibold text-amber-900">
              ข้อมูลเปลี่ยนแปลงหลังคำนวณ — ตัวเลขฉบับร่างยังไม่อัปเดต ({staleVisibleCount} รายการ)
            </p>
            <p className="mt-0.5 text-amber-800">
              มีการแก้ไขข้อมูล (ลงเวลา / ลา / เบิก / เงินเพิ่ม-ลด) หลังจากกด “คำนวณ” ครั้งล่าสุด
              {mayRun ? ' — กรุณากด “คำนวณใหม่ (ฉบับร่าง)” ด้านล่างเพื่ออัปเดต' : ''}
            </p>
          </div>
        </div>
      )}

      {/* Summary strip — company totals for the month */}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard label="ฐานเงินเดือนรวม" value={formatTHB(totals.incomeBase)} />
        <StatCard
          label="เงินเพิ่มรวม"
          value={<span className="text-success-deep">{formatTHB(totals.incomeOther)}</span>}
        />
        <StatCard label="ประกันสังคมรวม" value={formatTHB(totals.deductSso)} />
        <StatCard
          label="รายการหักรวม"
          value={<span className="text-danger-deep">{formatTHB(totals.deductions)}</span>}
        />
        <StatCard
          label="เงินสุทธิรวม"
          value={<span className="text-primary-700">{formatTHB(totals.netPay)}</span>}
          hint={`พนักงาน ${visibleRows.length} คน${hasFilter ? ' (กรองแล้ว)' : ''}`}
        />
      </div>

      {/* Run actions */}
      <div className="mb-6 flex flex-wrap items-center gap-3">
        {mayRun && (
          <RunActionForm
            action={calculatePayrollAction}
            month={month}
            label={rows.length > 0 ? 'คำนวณใหม่ (ฉบับร่าง)' : 'คำนวณเงินเดือน'}
            pendingLabel="กำลังคำนวณเงินเดือน…"
            variant="secondary"
            attention={staleVisibleCount > 0}
          />
        )}
        {mayPublish && statusCounts.Draft > 0 && (
          <RunActionForm
            action={publishPayrollAction}
            month={month}
            label={`เผยแพร่สลิป + แจ้งเตือน LINE (${statusCounts.Draft} คน)`}
            pendingLabel="กำลังเผยแพร่สลิปและส่งแจ้งเตือน…"
            variant="primary"
          />
        )}
        {mayPublish && statusCounts.Published > 0 && (
          <RunActionForm
            action={lockPayrollAction}
            month={month}
            label={`ล็อกงวด (${statusCounts.Published} คน)`}
            pendingLabel="กำลังล็อกงวด…"
            variant="secondary"
          />
        )}
        <p className="text-xs text-ink-3">
          พนักงานทั้งหมด {activeEmployees} คน · คำนวณแล้ว {rows.length} คน
          {statusCounts.Published > 0 ? ` · เผยแพร่แล้ว ${statusCounts.Published}` : ''}
          {statusCounts.Locked > 0 ? ` · ล็อกแล้ว ${statusCounts.Locked}` : ''}
        </p>
      </div>

      <ResponsiveTable
        columns={columns}
        rows={visibleRows}
        rowKey={(r) => r.id}
        actions={(r) =>
          r.status === 'Draft' && mayRun ? (
            <RowAdjust
              employeeId={r.employeeId}
              employeeName={`${r.employee.firstName} ${r.employee.lastName}`}
              month={month}
              monthLabel={monthLabelTh(month)}
              adjustments={adjByEmployee.get(r.employeeId) ?? []}
              createAction={createRowAdjustment}
              deleteAction={deleteRowAdjustment}
            />
          ) : null
        }
        empty={
          // The month has rows but the filter excluded them all → tell the
          // admin it's the filter, not a missing payroll run (no calc button).
          hasFilter && rows.length > 0 ? (
            <div className="surface">
              <EmptyState title="ไม่มีพนักงานในสาขา/แผนกที่เลือก" />
            </div>
          ) : (
            <div className="surface">
              <EmptyState
                title={`ยังไม่ได้คำนวณเงินเดือนเดือน ${monthLabelTh(month)}`}
                action={
                  mayRun ? (
                    <RunActionForm
                      action={calculatePayrollAction}
                      month={month}
                      label="คำนวณเงินเดือน"
                      pendingLabel="กำลังคำนวณเงินเดือน…"
                      variant="secondary"
                    />
                  ) : undefined
                }
              />
            </div>
          )
        }
      />
    </div>
  );
}
