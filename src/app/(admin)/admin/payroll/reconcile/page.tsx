import Link from 'next/link';
import { PageHeader } from '@/components/ui/page-header';
import { type Column, ResponsiveTable } from '@/components/ui/responsive-table';
import { StatCard } from '@/components/ui/stat-card';
import { StatusBadge, type StatusKey } from '@/components/ui/status-badge';
import { getPermittedBranches } from '@/lib/auth/branch-scope';
import { requireGlobalPermission } from '@/lib/auth/require-global-permission';
import { prisma } from '@/lib/db/prisma';
import { formatTHB2, monthLabelTh } from '@/lib/format';
import { EMPTY_SETTLEMENT, type PenaltyKindKey } from '@/lib/payroll/penalty-settlement';
import { loadSettlementsForMonth } from '@/lib/payroll/penalty-settlement-load';
import type { DeductionComponent, ReconcileFlag } from '@/lib/payroll/reconcile';
import { sortFlaggedRows } from '@/lib/payroll/reconcile';
import {
  loadReconciliation,
  type ReconciliationView,
  type ReconRow,
} from '@/lib/payroll/reconcile-data';
import {
  actualDaysFromAttendance,
  kindsToShow,
  type PenaltyRowInfo,
} from '@/lib/payroll/reconcile-settlement';
import { previewPayrollDrafts } from '@/lib/payroll/run';
import { ReconcileRows } from './reconcile-rows';

/**
 * /admin/payroll/reconcile — pre-publish reconciliation review.
 *
 * Read-only: surfaces the anomaly flags computed by loadReconciliation
 * (lib/payroll/reconcile-data.ts + reconcile.ts) so an admin can scan for
 * data problems (dropped employees, net swings, deduction jumps, ...) before
 * pressing เผยแพร่ on /admin/payroll. See
 * docs/superpowers/specs/2026-07-11-payroll-reconciliation-design.md.
 */

type SearchParams = Promise<{ m?: string }>;

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Current YYYY-MM in Bangkok — same one-liner as /admin/payroll (page.tsx);
 *  not exported there, so replicated here rather than reaching across pages. */
function currentMonth(): string {
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    timeZone: 'Asia/Bangkok',
  }).format(new Date());
}

const STATUS_INFO: Record<ReconciliationView['status'], { key: StatusKey; label: string }> = {
  Draft: { key: 'draft', label: 'ฉบับร่าง' },
  Published: { key: 'published', label: 'เผยแพร่แล้ว' },
  Locked: { key: 'locked', label: 'ล็อกแล้ว' },
  None: { key: 'neutral', label: 'ยังไม่ได้คำนวณ' },
};

const COMPONENT_LABELS: Record<DeductionComponent, string> = {
  deductSso: 'ประกันสังคม',
  deductAdvance: 'หักเบิกล่วงหน้า',
  deductAttendance: 'หักขาด/สาย',
  deductLeave: 'หักลา',
  deductDebt: 'หักหนี้',
  deductOther: 'หักอื่นๆ',
};

function flagLabel(flag: ReconcileFlag): string {
  switch (flag.kind) {
    case 'net-nonpositive':
      return 'สุทธิ ≤ 0';
    case 'missing-from-run':
      return 'หายจากรอบนี้';
    case 'low-net':
      return 'สุทธิต่ำผิดปกติ';
    case 'net-swing': {
      const pct = Math.round(flag.deltaPct * 100);
      return `สุทธิ ${pct > 0 ? '+' : ''}${pct}% เทียบ ${monthLabelTh(flag.baselineMonth)}`;
    }
    case 'new-this-month':
      return 'พนักงานใหม่';
    case 'deduction-jump':
      return `${COMPONENT_LABELS[flag.component]} ${formatTHB2(flag.to)} (เดิม ${formatTHB2(flag.from)})`;
    default:
      return flag satisfies never;
  }
}

/** Flag key for React lists — flags have no id, but kind (+component, for the
 *  one kind that can repeat per row) is stable within a render. */
function flagKey(flag: ReconcileFlag): string {
  return flag.kind === 'deduction-jump' ? `${flag.kind}-${flag.component}` : flag.kind;
}

/**
 * Per-employee data for the penalty-settlement section (Task 9): live actual
 * penalty days (a fresh, unpersisted recompute — the same engine calcPayroll
 * uses), what's currently settled with leave, and whether that employee's
 * row is still Draft (money can only move on a Draft row; see
 * penalty-settlement-admin.ts's isPeriodClosed). Only employees with
 * something to show (an actual penalty or a lingering settlement) get an
 * entry — everyone else is the ordinary, unaffected case.
 *
 * `freshDrafts` is null when the live recompute itself failed (e.g. no
 * PayrollConfig row) — defensively skipped rather than risking a wrong
 * "over-settled" flag built from a fabricated zero.
 */
function buildPenaltyByEmployee(
  rows: readonly ReconRow[],
  freshDrafts: Awaited<ReturnType<typeof previewPayrollDrafts>> | null,
  settlements: Awaited<ReturnType<typeof loadSettlementsForMonth>>,
  statusByEmployee: Map<string, string>,
): Record<string, PenaltyRowInfo> {
  if (!freshDrafts) return {};

  const out: Record<string, PenaltyRowInfo> = {};
  for (const row of rows) {
    if (row.current === null) continue;

    const draft = freshDrafts.get(row.employeeId);
    if (!draft) continue;
    const actualDays = actualDaysFromAttendance(draft.breakdown.attendance);

    const settlement = settlements.get(row.employeeId);
    const settledDays = settlement?.days ?? { ...EMPTY_SETTLEMENT };

    const kinds = kindsToShow(actualDays, settledDays);
    if (kinds.length === 0) continue;

    const leaveTypeNames: Partial<Record<PenaltyKindKey, string>> = {};
    for (const kind of kinds) {
      const name = settlement?.leaveTypeNames[kind]?.name;
      if (name) leaveTypeNames[kind] = name;
    }

    out[row.employeeId] = {
      actualDays,
      settledDays,
      leaveTypeNames,
      isDraft: statusByEmployee.get(row.employeeId) === 'Draft',
    };
  }
  return out;
}

function FlagChip({ flag }: { flag: ReconcileFlag }) {
  // net-nonpositive / missing-from-run are the "stop and look now" flags;
  // the rest are still worth a glance but less alarming — red vs amber.
  const severe = flag.kind === 'net-nonpositive' || flag.kind === 'missing-from-run';
  return (
    <span
      className={
        severe
          ? 'inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-medium text-red-800'
          : 'inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800'
      }
    >
      {flagLabel(flag)}
    </span>
  );
}

function NeedsReviewRow({ row }: { row: ReconRow }) {
  const fixHref = row.flags.some((f) => f.kind === 'deduction-jump')
    ? '/admin/payroll/adjustments'
    : `/admin/employees/${row.employeeId}/edit`;
  const current = row.current?.netPay ?? null;
  const baseline = row.baseline?.netPay ?? null;
  const swing = row.flags.find((f) => f.kind === 'net-swing');
  const deltaAbs = current !== null && baseline !== null ? Math.abs(current - baseline) : null;

  return (
    <li className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <p className="font-medium text-ink-1">
          {row.name} <span className="text-xs font-normal text-ink-4">· {row.branchName}</span>
        </p>
        <p className="mt-0.5 font-mono text-sm tabular-nums text-ink-2">
          {current !== null ? formatTHB2(current) : '—'}
          {baseline !== null && (
            <span className="ml-2 font-sans text-xs text-ink-4">
              เดิม {formatTHB2(baseline)}
              {deltaAbs !== null && ` · Δ ${formatTHB2(deltaAbs)}`}
              {swing && swing.kind === 'net-swing'
                ? ` (${Math.round(swing.deltaPct * 100) > 0 ? '+' : ''}${Math.round(swing.deltaPct * 100)}%)`
                : ''}
            </span>
          )}
        </p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {row.flags.map((flag) => (
            <FlagChip key={flagKey(flag)} flag={flag} />
          ))}
        </div>
      </div>
      <Link
        href={fixHref}
        className="shrink-0 whitespace-nowrap text-sm font-medium text-primary-700 hover:underline"
      >
        แก้ไข →
      </Link>
    </li>
  );
}

export default async function PayrollReconcilePage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { m } = await searchParams;
  const month = m && MONTH_RE.test(m) ? m : currentMonth();

  const { user } = await requireGlobalPermission('payroll.read');
  const view = await loadReconciliation(month);

  // Settling a penalty (unlike merely viewing this page) needs payroll.run —
  // an admin may hold read-only reconciliation access without it. When they
  // lack it, the settlement controls must not render at all, same rule the
  // manual attendance form applies (see manual/page.tsx's canSettle). Checked
  // the same way the server action's `requireGlobalPermission('payroll.run')`
  // decides (GLOBAL only) — `canDo` alone would admit a branch-scoped grant
  // (e.g. the branch-scoped system Admin role) and render a control the
  // server then refuses with `notFound()`.
  const canSettle = (await getPermittedBranches(user, 'payroll.run')) === 'all';

  const [settlements, payrollStatuses, freshDrafts, penaltyLeaveTypes] = await Promise.all([
    // Reused rather than re-querying the same rows — see penalty-settlement-load.ts.
    loadSettlementsForMonth(month),
    // Per-employee Draft/Published/Locked — a month's rows can be published
    // one employee at a time (publishOnePayrollAction), so this can't be
    // read off the month-level `view.status` aggregate.
    prisma.payroll.findMany({ where: { month }, select: { employeeId: true, status: true } }),
    // Live, unpersisted recompute (same engine calcPayroll uses) so the
    // over-settlement flag compares against the CURRENT actual penalty, not
    // whatever was last saved. Defensively wrapped — a calc hiccup here must
    // not blank the rest of the reconciliation page (mirrors /admin/payroll's
    // own staleness check).
    previewPayrollDrafts(month).catch(() => null),
    // Eligible leave types — archived=null && penaltySettlementAllowed=true.
    // Skipped when the admin can't settle: no point loading data that never renders.
    canSettle
      ? prisma.leaveType.findMany({
          where: { archivedAt: null, penaltySettlementAllowed: true },
          select: { id: true, name: true },
          orderBy: { name: 'asc' },
        })
      : Promise.resolve([]),
  ]);

  const statusByEmployee = new Map<string, string>(
    payrollStatuses.map((p) => [p.employeeId, p.status]),
  );
  const penaltyByEmployee = buildPenaltyByEmployee(
    view.rows,
    freshDrafts,
    settlements,
    statusByEmployee,
  );

  const flaggedRows = sortFlaggedRows(view.rows.filter((r) => r.flags.length > 0));
  const statusInfo = STATUS_INFO[view.status];

  const branchColumns: Column<ReconciliationView['byBranch'][number]>[] = [
    {
      key: 'branch',
      header: 'สาขา',
      cell: (b) => <span className="font-medium text-ink-1">{b.branchName}</span>,
    },
    {
      key: 'headcount',
      header: 'จำนวนคน',
      cell: (b) => <span className="tabular-nums text-ink-2">{b.headcount}</span>,
    },
    {
      key: 'net',
      header: 'สุทธิ',
      cell: (b) => <span className="font-mono tabular-nums text-ink-1">{formatTHB2(b.net)}</span>,
    },
  ];

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader
        breadcrumb="การเงิน"
        title={
          <span className="inline-flex flex-wrap items-center gap-3">
            <span>ตรวจสอบก่อนเผยแพร่</span>
            <StatusBadge status={statusInfo.key}>{statusInfo.label}</StatusBadge>
          </span>
        }
        subtitle={`งวด ${monthLabelTh(month)} — ตรวจสอบความผิดปกติของยอดสุทธิก่อนกดเผยแพร่สลิป`}
        actions={
          <Link
            href={`/admin/payroll?m=${month}`}
            className="text-sm font-medium text-primary-700 hover:underline"
          >
            ← กลับไปหน้าเงินเดือน
          </Link>
        }
      />

      {/* Run summary */}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="พนักงานในรอบนี้" value={view.totals.headcount} />
        <StatCard label="รายได้รวม" value={formatTHB2(view.totals.gross)} />
        <StatCard label="รายการหักรวม" value={formatTHB2(view.totals.deductions)} />
        <StatCard label="เงินสุทธิรวม" value={formatTHB2(view.totals.net)} />
      </div>

      {view.byBranch.length > 0 && (
        <div className="surface mb-6 overflow-hidden">
          <h2 className="border-b border-gray-100 px-4 py-3 font-display text-sm font-semibold text-ink-1">
            สุทธิแยกตามสาขา
          </h2>
          <div className="p-4">
            <ResponsiveTable
              columns={branchColumns}
              rows={view.byBranch}
              rowKey={(b) => b.branchId}
            />
          </div>
        </div>
      )}

      {/* Needs review */}
      <div className="mb-6">
        <h2 className="mb-2 font-display text-sm font-semibold text-ink-1">
          ต้องตรวจสอบ <span className="tabular-nums">({flaggedRows.length})</span>
        </h2>
        {flaggedRows.length === 0 ? (
          <div className="surface flex items-center gap-2 bg-success-soft/40 px-4 py-4 text-sm text-success-deep">
            <span aria-hidden="true">✓</span>
            <span>ไม่พบความผิดปกติ — {view.totals.headcount} รายการอยู่ในเกณฑ์ปกติ</span>
          </div>
        ) : (
          <ul className="surface divide-y divide-gray-100">
            {flaggedRows.map((row) => (
              <NeedsReviewRow key={row.employeeId} row={row} />
            ))}
          </ul>
        )}
      </div>

      {/* All rows IN THIS RUN (collapsed) + per-row expandable derivation.
          Rows without a current payroll (roster members not in the run) are
          excluded — a genuinely missing one already surfaces in Needs review. */}
      <ReconcileRows
        rows={view.rows.filter((r) => r.current !== null)}
        month={month}
        canSettle={canSettle}
        leaveTypeOptions={penaltyLeaveTypes}
        penaltyByEmployee={penaltyByEmployee}
      />
    </div>
  );
}
