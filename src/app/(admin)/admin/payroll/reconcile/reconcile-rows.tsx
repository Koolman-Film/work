'use client';

import { Fragment, useState } from 'react';
import { formatTHB2, monthLabelTh } from '@/lib/format';
import type { PayrollBreakdown } from '@/lib/payroll/reconcile';
import type { ReconRow } from '@/lib/payroll/reconcile-data';

/**
 * Client child of /admin/payroll/reconcile — owns the two pieces of the page
 * that need interactivity: the "all rows" section (collapsed by default) and,
 * inside it, the per-employee derivation (current vs baseline, changed lines
 * highlighted). Receives already-loaded plain data as props — no fetching.
 */

// The eight breakdown lines shown side-by-side with baseline (netPay is its
// own row below, since it's the bottom-line total rather than a component).
const BREAKDOWN_LINES: { key: keyof Omit<PayrollBreakdown, 'netPay'>; label: string }[] = [
  { key: 'incomeBase', label: 'ฐานเงินเดือน' },
  { key: 'incomeOther', label: 'เงินเพิ่ม' },
  { key: 'deductSso', label: 'ประกันสังคม' },
  { key: 'deductAttendance', label: 'หักขาด/สาย' },
  { key: 'deductLeave', label: 'หักลา' },
  { key: 'deductAdvance', label: 'หักเบิกล่วงหน้า' },
  { key: 'deductDebt', label: 'หักหนี้' },
  { key: 'deductOther', label: 'หักอื่นๆ' },
];

function RowDerivation({ row }: { row: ReconRow }) {
  const { current, baseline } = row;
  return (
    <div className="mt-3 border-t border-gray-100 pt-3">
      <div className="grid grid-cols-[1fr_auto_auto] items-baseline gap-x-4 gap-y-1">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-4">รายการ</span>
        <span className="text-right text-[11px] font-semibold uppercase tracking-wide text-ink-4">
          งวดนี้
        </span>
        <span className="text-right text-[11px] font-semibold uppercase tracking-wide text-ink-4">
          {baseline ? `งวดก่อน (${monthLabelTh(baseline.month)})` : 'งวดก่อน'}
        </span>

        {BREAKDOWN_LINES.map(({ key, label }) => {
          const curVal = current ? current[key] : null;
          const baseVal = baseline ? baseline[key] : null;
          const changed = curVal !== null && baseVal !== null && curVal !== baseVal;
          return (
            <Fragment key={key}>
              <span
                className={changed ? 'text-sm font-semibold text-amber-800' : 'text-sm text-ink-2'}
              >
                {label}
              </span>
              <span
                className={
                  changed
                    ? 'text-right font-mono text-sm font-semibold tabular-nums text-amber-800'
                    : 'text-right font-mono text-sm tabular-nums text-ink-2'
                }
              >
                {curVal !== null ? formatTHB2(curVal) : '—'}
              </span>
              <span className="text-right font-mono text-sm tabular-nums text-ink-4">
                {baseVal !== null ? formatTHB2(baseVal) : '—'}
              </span>
            </Fragment>
          );
        })}

        <span className="text-sm font-semibold text-ink-1">สุทธิ</span>
        <span className="text-right font-mono text-sm font-semibold tabular-nums text-primary-700">
          {current ? formatTHB2(current.netPay) : '—'}
        </span>
        <span className="text-right font-mono text-sm tabular-nums text-ink-4">
          {baseline ? formatTHB2(baseline.netPay) : '—'}
        </span>
      </div>

      {row.adjustments.length > 0 && (
        <div className="mt-3 border-t border-gray-100 pt-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-4">
            เงินเพิ่ม/เงินลด
          </p>
          <ul className="mt-1 space-y-0.5">
            {row.adjustments.map((a, idx) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: adjustments have no stable id; list is immutable within this render
              <li key={idx} className="flex items-center justify-between gap-3 text-xs">
                <span className="min-w-0 truncate text-ink-2">{a.reason}</span>
                <span
                  className={
                    a.kind === 'Income'
                      ? 'shrink-0 font-mono tabular-nums text-emerald-700'
                      : 'shrink-0 font-mono tabular-nums text-red-700'
                  }
                >
                  {a.kind === 'Income' ? '+' : '-'}
                  {formatTHB2(a.amount)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function ReconcileRows({ rows }: { rows: ReconRow[] }) {
  const [showAll, setShowAll] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <div className="surface">
      <button
        type="button"
        onClick={() => setShowAll((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
        aria-expanded={showAll}
      >
        <span className="font-display text-sm font-semibold text-ink-1">
          รายการทั้งหมด <span className="tabular-nums">({rows.length})</span>
        </span>
        <span className="text-xs font-medium text-ink-3">{showAll ? '▲ ซ่อน' : '▼ แสดง'}</span>
      </button>

      {showAll && (
        <ul className="divide-y divide-gray-100 border-t border-gray-100">
          {rows.map((row) => {
            const expanded = expandedId === row.employeeId;
            return (
              <li key={row.employeeId} className="px-4 py-3">
                <button
                  type="button"
                  onClick={() => setExpandedId(expanded ? null : row.employeeId)}
                  className="flex w-full items-center justify-between gap-3 text-left"
                  aria-expanded={expanded}
                >
                  <span className="min-w-0 truncate">
                    <span className="font-medium text-ink-1">{row.name}</span>
                    <span className="ml-2 text-xs text-ink-4">{row.branchName}</span>
                  </span>
                  <span className="shrink-0 font-mono text-sm tabular-nums text-ink-1">
                    {row.current ? formatTHB2(row.current.netPay) : '—'}
                  </span>
                </button>
                {expanded && <RowDerivation row={row} />}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
