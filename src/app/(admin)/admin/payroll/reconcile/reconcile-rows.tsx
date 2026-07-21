'use client';

import { useRouter } from 'next/navigation';
import { Fragment, useEffect, useState, useTransition } from 'react';
import { isNotFoundError } from '@/lib/auth/is-not-found-error';
import { formatTHB2, monthLabelTh } from '@/lib/format';
import type { PenaltyKindKey } from '@/lib/payroll/penalty-settlement';
import { getPenaltyLeaveBalance } from '@/lib/payroll/penalty-settlement-admin';
import type { PayrollBreakdown } from '@/lib/payroll/reconcile';
import type { ReconRow } from '@/lib/payroll/reconcile-data';
import {
  hasAnyOverSettlement,
  isOverSettled,
  kindsToShow,
  type PenaltyRowInfo,
} from '@/lib/payroll/reconcile-settlement';
import { clearReconcileSettlement, setReconcileSettlement } from './actions';

/**
 * Client child of /admin/payroll/reconcile — owns the two pieces of the page
 * that need interactivity: the "all rows" section (collapsed by default) and,
 * inside it, the per-employee derivation (current vs baseline, changed lines
 * highlighted), which now also carries the penalty-settlement section (Task
 * 9) for employees whose row has an Absent / LateThreeStrike / SevereLate
 * penalty this month. Receives already-loaded plain data as props — the
 * settlement WRITE actions ('./actions') are the only thing this file calls
 * directly, mirroring how the manual attendance form calls
 * penalty-settlement-admin.ts's exports straight from the client.
 */

type LeaveTypeOption = { id: string; name: string };

const SETTLEMENT_ERROR_TH: Record<string, string> = {
  'invalid-days': 'จำนวนวันไม่ถูกต้อง',
  'invalid-month': 'เดือนที่ระบุไม่ถูกต้อง',
  'invalid-employee': 'รหัสพนักงานไม่ถูกต้อง',
  'period-closed': 'ปิดรอบเงินเดือนของเดือนนี้แล้ว',
  'leave-type-not-allowed': 'ประเภทวันลาที่เลือกไม่รองรับการหักค่าปรับนี้',
  'insufficient-balance': 'สิทธิวันลาคงเหลือไม่พอ',
  // Reachable here even though this page's own `freshDrafts` lookup already
  // skips employees payroll can't charge (page.tsx's `buildPenaltyByEmployee`
  // — no draft, no penalty section, no control to click) — kept as a label
  // for defense-in-depth against a stale/refused server round-trip, same as
  // the manual attendance form's identical map.
  'unsupported-salary-type': 'พนักงานประเภทเงินเดือนนี้ยังไม่รองรับการหักค่าปรับ จึงหักสิทธิวันลาแทนไม่ได้',
  // The days<=actualDays cap below (handleSave) is client-side only; this is
  // its server-side twin (setPenaltySettlement's `exceeds-penalty`) — reached
  // when the actual penalty shrank between opening the editor and saving.
  'exceeds-penalty': 'หักสิทธิได้ไม่เกินโทษจริงของเดือนนี้',
  // Defect 3: not reachable from this page today (page.tsx's
  // `buildPenaltyByEmployee` already excludes archived employees from the
  // list this editor renders for) — kept as a label for defense-in-depth
  // against a stale/refused server round-trip, same reasoning as
  // 'unsupported-salary-type' above.
  'employee-archived': 'พนักงานถูกเก็บเข้าคลังแล้ว ไม่สามารถหักสิทธิวันลาได้',
  // Defect 1: the month's advisory lock (month-lock.ts) is now acquired
  // non-blocking with a couple of short retries — `setPenaltySettlement`/
  // `clearPenaltySettlement` return this as a clean `Result` (not a throw)
  // once those retries are exhausted. Reuses BUSY_ERROR_TH's wording below so
  // this and the thrown-P2028 backstop read identically to the admin.
  busy: 'มีแอดมินอีกคนกำลังคำนวณหรือเผยแพร่เงินเดือนเดือนนี้อยู่ กรุณาลองใหม่อีกครั้ง',
};

// Backstop only: with the month lock now acquired non-blocking (a couple of
// short retries — see penalty-settlement-admin.ts), contention should surface
// as SETTLEMENT_ERROR_TH['busy'] above, not a thrown rejection. This catch
// stays as a safety net for a genuine DB hiccup (or any other unexpected
// throw), so it still reads as an actionable Thai message instead of an
// unhandled rejection inside the transition.
const BUSY_ERROR_TH = 'ระบบกำลังประมวลผลรายการอื่นอยู่ กรุณาลองใหม่อีกครั้ง';

// A notFound() denial (requireGlobalPermission('payroll.run') rejecting a
// branch-scoped admin) is not the same situation as BUSY_ERROR_TH above —
// retrying can never succeed. `canSettle` (page.tsx) already hides this
// whole control for such an admin, so this is only reachable if the grant
// changed (or this page loaded stale) between render and submit.
const PERMISSION_ERROR_TH = 'ไม่มีสิทธิ์หักสิทธิวันลาแทนค่าปรับนี้';

const PENALTY_KIND_LABEL: Record<PenaltyKindKey, string> = {
  Absent: 'ขาดงาน',
  LateThreeStrike: 'มาสายครบกำหนด',
  SevereLate: 'มาสายรุนแรง',
};

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

/**
 * One penalty kind's settlement line: what happened this month (actual
 * days), what's currently settled with leave (if anything), the
 * over-settlement warning, and — when the row is still Draft and the admin
 * holds payroll.run — the control to change it.
 *
 * The control is genuinely inert (not merely styled differently) once the
 * row leaves Draft: `!isDraft` short-circuits before any editor UI exists,
 * so there is no disabled-but-present form to route around. The same is
 * true when `!canSettle` — that branch never renders a control either,
 * matching the manual attendance form's rule that a choice an admin can't
 * exercise must not render at all.
 */
function PenaltySettlementLine({
  employeeId,
  month,
  kind,
  actualDays,
  settledDays,
  leaveTypeName,
  isDraft,
  canSettle,
  leaveTypeOptions,
}: {
  employeeId: string;
  month: string;
  kind: PenaltyKindKey;
  actualDays: number;
  settledDays: number;
  leaveTypeName: string | undefined;
  isDraft: boolean;
  canSettle: boolean;
  leaveTypeOptions: LeaveTypeOption[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [leaveTypeId, setLeaveTypeId] = useState('');
  const [days, setDays] = useState(1);
  const [balances, setBalances] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  // Distinct from `error`: the settlement itself saved successfully — only
  // the courtesy draft recalculation afterward failed (Defect 2). Rendered
  // as a notice, not an error, so the admin never reads a successful save as
  // a failure and retries an action that already applied.
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Balance is fetched only once the editor opens — most rows never edit,
  // so eagerly loading every row's balance up front would be wasted work.
  // Mirrors the manual attendance form's `getPenaltyLeaveBalance` usage.
  useEffect(() => {
    if (!editing) return;
    let cancelled = false;
    getPenaltyLeaveBalance({ employeeId, month })
      .then((result) => {
        if (!cancelled) setBalances(result);
      })
      .catch(() => {
        // Backstop: this editor only opens when `canSettle` already gated
        // it (page.tsx), so a denial here should be unreachable through
        // normal navigation — but leaving this unhandled would silently
        // keep `balances` empty, which renders every leave option as a
        // confident "สิทธิไม่พอ" indistinguishable from a real zero
        // balance. Surface that the check itself failed instead.
        if (!cancelled) setError('ไม่สามารถตรวจสอบสิทธิวันลาคงเหลือได้ กรุณาลองใหม่อีกครั้ง');
      });
    return () => {
      cancelled = true;
    };
  }, [editing, employeeId, month]);

  const overSettled = isOverSettled(actualDays, settledDays);

  function openEditor() {
    setError(null);
    setLeaveTypeId('');
    setDays(settledDays > 0 ? settledDays : Math.max(1, actualDays));
    setEditing(true);
  }

  function handleSave() {
    setError(null);
    setNotice(null);
    if (!leaveTypeId) {
      setError('กรุณาเลือกประเภทวันลาที่จะใช้หัก');
      return;
    }
    if (!Number.isInteger(days) || days <= 0) {
      setError('จำนวนวันไม่ถูกต้อง');
      return;
    }
    if (days > actualDays) {
      setError(`หักสิทธิได้ไม่เกินโทษจริงของเดือนนี้ (${actualDays} วัน)`);
      return;
    }
    startTransition(async () => {
      try {
        const result = await setReconcileSettlement({ employeeId, month, kind, leaveTypeId, days });
        if (!result.ok) {
          setError(SETTLEMENT_ERROR_TH[result.error] ?? 'เกิดข้อผิดพลาดไม่ทราบสาเหตุ');
          return;
        }
        setEditing(false);
        if (result.recalcPending) {
          // Same honesty contract as the manual attendance form's identical
          // case: name what was saved (the settlement), name what was not
          // (the recalculation), say what to do.
          setNotice(
            'บันทึกการหักสิทธิเรียบร้อยแล้ว แต่คำนวณฉบับร่างใหม่ไม่สำเร็จ — ตัวเลขที่หน้าเงินเดือนอาจยังไม่อัปเดต ไปกด "คำนวณใหม่ (ฉบับร่าง)" ที่หน้าเงินเดือนอีกครั้ง',
          );
        }
        router.refresh();
      } catch (err) {
        // Do not swallow silently — the admin must know the save did not
        // apply, not assume it did because no error rendered. A notFound()
        // denial is not retryable like a BUSY_ERROR_TH transaction timeout —
        // say so instead of telling the admin to try again.
        setError(isNotFoundError(err) ? PERMISSION_ERROR_TH : BUSY_ERROR_TH);
      }
    });
  }

  function handleClear() {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      try {
        const result = await clearReconcileSettlement({ employeeId, month, kind });
        if (!result.ok) {
          setError(SETTLEMENT_ERROR_TH[result.error] ?? 'เกิดข้อผิดพลาดไม่ทราบสาเหตุ');
          return;
        }
        setEditing(false);
        if (result.recalcPending) {
          setNotice(
            'ยกเลิกการหักสิทธิเรียบร้อยแล้ว แต่คำนวณฉบับร่างใหม่ไม่สำเร็จ — ตัวเลขที่หน้าเงินเดือนอาจยังไม่อัปเดต ไปกด "คำนวณใหม่ (ฉบับร่าง)" ที่หน้าเงินเดือนอีกครั้ง',
          );
        }
        router.refresh();
      } catch (err) {
        setError(isNotFoundError(err) ? PERMISSION_ERROR_TH : BUSY_ERROR_TH);
      }
    });
  }

  return (
    <div className="space-y-1.5 rounded-md border border-gray-100 px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm text-ink-2">
          {PENALTY_KIND_LABEL[kind]}{' '}
          <span className="text-xs text-ink-4">(เกิดขึ้นจริงเดือนนี้ {actualDays} วัน)</span>
        </span>
        <span className="text-sm font-medium text-ink-1">
          {settledDays > 0 ? `หักสิทธิ${leaveTypeName ?? 'วันลา'} ${settledDays} วัน` : 'หักเป็นเงิน'}
        </span>
      </div>

      {notice && (
        <p
          role="status"
          className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-sm text-amber-900"
        >
          {notice}
        </p>
      )}

      {overSettled && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-sm text-amber-900">
          มีการหักสิทธิ {settledDays} วัน แต่เดือนนี้เหลือโทษจริง {actualDays} วัน — รายการที่เกินไม่ถูกนำมาคิด
          กรุณาตรวจสอบ
        </p>
      )}

      {!isDraft ? (
        <p className="text-sm text-ink-2">
          เดือนนี้เผยแพร่แล้ว — วิธีหักของเดือนนี้ถือเป็นที่สิ้นสุด ไม่สามารถแก้ไขได้อีก
        </p>
      ) : (
        canSettle &&
        (editing ? (
          <div className="space-y-2 rounded-md bg-gray-50 p-2">
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={leaveTypeId}
                onChange={(e) => setLeaveTypeId(e.target.value)}
                className="rounded-md border border-gray-300 px-2 py-1 text-sm shadow-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              >
                <option value="">— เลือกประเภทวันลา —</option>
                {leaveTypeOptions.map((t) => {
                  const left = balances[t.id] ?? 0;
                  return (
                    <option key={t.id} value={t.id} disabled={left < 1}>
                      {t.name} (เหลือ {left} วัน){left < 1 ? ' — สิทธิไม่พอ' : ''}
                    </option>
                  );
                })}
              </select>
              <input
                type="number"
                min={1}
                max={Math.max(1, actualDays)}
                value={days}
                onChange={(e) => setDays(Number(e.target.value))}
                className="w-20 rounded-md border border-gray-300 px-2 py-1 text-sm shadow-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              />
              <span className="text-xs text-ink-4">วัน</span>
            </div>
            {error && (
              <p role="alert" className="text-xs text-red-600">
                {error}
              </p>
            )}
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handleSave}
                disabled={pending}
                className="rounded-md bg-primary-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-primary-700 disabled:opacity-60"
              >
                {pending ? 'กำลังบันทึก...' : 'บันทึก'}
              </button>
              <button
                type="button"
                onClick={() => setEditing(false)}
                disabled={pending}
                className="text-xs font-medium text-ink-3 hover:underline"
              >
                ยกเลิก
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={openEditor}
              className="text-xs font-medium text-primary-700 hover:underline"
            >
              {settledDays > 0 ? 'แก้ไขวิธีหัก' : 'หักสิทธิวันลาแทน'}
            </button>
            {settledDays > 0 && (
              <button
                type="button"
                onClick={handleClear}
                disabled={pending}
                className="text-xs font-medium text-red-700 hover:underline disabled:opacity-60"
              >
                เลิกหักสิทธิ (กลับไปหักเงิน)
              </button>
            )}
            {error && (
              <p role="alert" className="text-xs text-red-600">
                {error}
              </p>
            )}
          </div>
        ))
      )}
    </div>
  );
}

/** All penalty-kind lines for one row — only rendered when `penalty` is
 *  non-null (page.tsx already filtered to rows with something to show). */
function PenaltySettlementSection({
  row,
  month,
  canSettle,
  leaveTypeOptions,
  penalty,
}: {
  row: ReconRow;
  month: string;
  canSettle: boolean;
  leaveTypeOptions: LeaveTypeOption[];
  penalty: PenaltyRowInfo;
}) {
  const kinds = kindsToShow(penalty.actualDays, penalty.settledDays);
  if (kinds.length === 0) return null;

  return (
    <div className="mt-3 space-y-2 border-t border-gray-100 pt-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-4">
        การหักค่าปรับด้วยสิทธิวันลา
      </p>
      {kinds.map((kind) => (
        <PenaltySettlementLine
          key={kind}
          employeeId={row.employeeId}
          month={month}
          kind={kind}
          actualDays={penalty.actualDays[kind]}
          settledDays={penalty.settledDays[kind]}
          leaveTypeName={penalty.leaveTypeNames[kind]}
          isDraft={penalty.isDraft}
          canSettle={canSettle}
          leaveTypeOptions={leaveTypeOptions}
        />
      ))}
    </div>
  );
}

function RowDerivation({
  row,
  month,
  canSettle,
  leaveTypeOptions,
  penalty,
}: {
  row: ReconRow;
  month: string;
  canSettle: boolean;
  leaveTypeOptions: LeaveTypeOption[];
  penalty: PenaltyRowInfo | undefined;
}) {
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

      {penalty && (
        <PenaltySettlementSection
          row={row}
          month={month}
          canSettle={canSettle}
          leaveTypeOptions={leaveTypeOptions}
          penalty={penalty}
        />
      )}
    </div>
  );
}

export function ReconcileRows({
  rows,
  month,
  canSettle,
  leaveTypeOptions,
  penaltyByEmployee,
}: {
  rows: ReconRow[];
  month: string;
  canSettle: boolean;
  leaveTypeOptions: LeaveTypeOption[];
  penaltyByEmployee: Record<string, PenaltyRowInfo>;
}) {
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
            const penalty = penaltyByEmployee[row.employeeId];
            const overSettled = penalty
              ? hasAnyOverSettlement(penalty.actualDays, penalty.settledDays)
              : false;
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
                    {overSettled && (
                      <span
                        className="ml-2 inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800"
                        title="มีการหักสิทธิวันลามากกว่าโทษจริงของเดือนนี้"
                      >
                        หักสิทธิเกินโทษจริง
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 font-mono text-sm tabular-nums text-ink-1">
                    {row.current ? formatTHB2(row.current.netPay) : '—'}
                  </span>
                </button>
                {expanded && (
                  <RowDerivation
                    row={row}
                    month={month}
                    canSettle={canSettle}
                    leaveTypeOptions={leaveTypeOptions}
                    penalty={penalty}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
