'use client';

/**
 * Dashboard work-calendar island.
 *
 * Reuses the employee `CalendarGrid` verbatim so the admin calendar looks and
 * behaves exactly like the one on /liff/calendar. Month navigation + branch
 * filtering are handled here without URL params (which would make the
 * dashboard page dynamic and kill its revalidate=30 caching): each change
 * calls the `loadAdminCalendar` server action and swaps the data in.
 *
 * `key={ym}` on CalendarGrid forces a remount on month change so the grid's
 * internal "selected day" resets to today / first-of-month. Branch changes
 * keep the same key, so the selected day persists and only the detail panel
 * refreshes (its lookup maps are useMemo'd over `entries`).
 */

import { useMemo, useState, useTransition } from 'react';
import { CalendarGrid } from '@/app/(liff)/liff/calendar/calendar-grid';
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  buildMonthGrid,
  currentMonthYM,
  formatThaiMonthLabel,
  parseMonth,
  shiftMonth,
  type TeamCalendarData,
} from '@/lib/leave/team-calendar-shape';
import { cn } from '@/lib/utils';
import { AdvanceReviewModal, type AdvanceRowVM } from '../advance/advance-review-modal';
import { LeaveReviewModal, type LeaveRowVM } from '../leave/leave-review-modal';
import { getAdvanceReviewRow, getLeaveReviewRow, loadAdminCalendar } from './actions';

type Branch = { id: string; name: string };

type Props = {
  branches: Branch[];
  initialYm: string;
  initialData: TeamCalendarData;
};

export function AdminCalendarCard({ branches, initialYm, initialData }: Props) {
  const [ym, setYm] = useState(initialYm);
  const [branchId, setBranchId] = useState(''); // '' = all branches
  const [data, setData] = useState<TeamCalendarData>(initialData);
  const [isPending, startTransition] = useTransition();
  const [openLeave, setOpenLeave] = useState<LeaveRowVM | null>(null);
  const [openAdvance, setOpenAdvance] = useState<AdvanceRowVM | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  const todayYm = useMemo(() => currentMonthYM(), []);

  // Grid + label derive purely from `ym` via client-safe helpers. The `??`
  // fallback can't realistically fire (ym is always a valid YYYY-MM), but keeps
  // TS happy about parseMonth's nullable return.
  const parsed = useMemo(() => parseMonth(ym) ?? parseMonth(todayYm), [ym, todayYm]);
  const grid = useMemo(() => (parsed ? buildMonthGrid(parsed.year, parsed.month0) : []), [parsed]);
  const monthLabel = parsed ? formatThaiMonthLabel(parsed.year, parsed.month0) : '';

  const branchName = branchId ? branches.find((b) => b.id === branchId)?.name : undefined;
  const scopeLabel = branchName ?? 'ทุกสาขา';

  function reload(nextYm: string, nextBranchId: string) {
    startTransition(async () => {
      const next = await loadAdminCalendar({ ym: nextYm, branchId: nextBranchId || null });
      setData(next);
    });
  }

  function goPrev() {
    const next = shiftMonth(ym, -1);
    setYm(next);
    reload(next, branchId);
  }
  function goNext() {
    const next = shiftMonth(ym, 1);
    setYm(next);
    reload(next, branchId);
  }
  function goToday() {
    setYm(todayYm);
    reload(todayYm, branchId);
  }
  function onBranchChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value;
    setBranchId(next);
    reload(ym, next);
  }

  function onLeaveClick(leaveRequestId: string) {
    setRowError(null);
    setBusyId(leaveRequestId);
    startTransition(async () => {
      const row = await getLeaveReviewRow(leaveRequestId);
      setBusyId(null);
      if (row) setOpenLeave(row);
      else setRowError('ไม่พบคำขอลานี้ (อาจถูกลบไปแล้ว)');
    });
  }

  function onAdvanceClick(cashAdvanceId: string) {
    setRowError(null);
    setBusyId(cashAdvanceId);
    startTransition(async () => {
      const row = await getAdvanceReviewRow(cashAdvanceId);
      setBusyId(null);
      if (row) setOpenAdvance(row);
      else setRowError('ไม่พบคำขอเบิกนี้ (อาจถูกลบไปแล้ว)');
    });
  }

  // Re-fetch the current month/branch after a review modal closes so the grid +
  // day-detail reflect any approve/reject/void (the modal's router.refresh() alone
  // doesn't update this island's local `data` state). Also clears any row error.
  function closeReview() {
    setOpenLeave(null);
    setOpenAdvance(null);
    setRowError(null);
    reload(ym, branchId);
  }

  return (
    <Card>
      <CardHeader className="flex-wrap gap-3">
        <div className="min-w-0">
          <CardTitle>ปฏิทินงาน</CardTitle>
          <CardDescription>วันลาและวันหยุด — {scopeLabel}</CardDescription>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Branch filter — first option = all branches */}
          <select
            aria-label="กรองตามสาขา"
            value={branchId}
            onChange={onBranchChange}
            className="max-w-[200px] rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-100"
          >
            <option value="">สาขาทั้งหมด</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>

          {/* Month navigator */}
          <div className="flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-1 py-0.5">
            <button
              type="button"
              onClick={goPrev}
              aria-label="เดือนก่อนหน้า"
              className="grid size-8 place-items-center rounded-md text-ink-3 hover:bg-gray-100 hover:text-ink-1"
            >
              ‹
            </button>
            <p className="min-w-[7.5rem] text-center text-sm font-semibold text-ink-1">
              {monthLabel}
            </p>
            <button
              type="button"
              onClick={goNext}
              aria-label="เดือนถัดไป"
              className="grid size-8 place-items-center rounded-md text-ink-3 hover:bg-gray-100 hover:text-ink-1"
            >
              ›
            </button>
          </div>

          {ym !== todayYm && (
            <button
              type="button"
              onClick={goToday}
              className="rounded-lg border border-gray-200 bg-white px-2.5 py-2 text-xs font-medium text-ink-2 hover:bg-gray-50"
            >
              วันนี้
            </button>
          )}
        </div>
      </CardHeader>

      <CardBody>
        <div
          aria-busy={isPending}
          className={cn('transition-opacity', isPending && 'pointer-events-none opacity-60')}
        >
          <CalendarGrid
            key={ym}
            grid={grid}
            entries={data.entries}
            holidays={data.holidays}
            advances={data.advances}
            detailPosition="right"
            onLeaveClick={onLeaveClick}
            onAdvanceClick={onAdvanceClick}
            busyId={busyId}
          />
        </div>
        {rowError && (
          <p role="alert" className="mt-2 text-xs font-medium text-danger-deep">
            {rowError}
          </p>
        )}
      </CardBody>

      <LeaveReviewModal row={openLeave} onClose={closeReview} />
      <AdvanceReviewModal row={openAdvance} onClose={closeReview} />
    </Card>
  );
}
