'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { getAdvanceReviewRow, getLeaveReviewRow } from '@/app/(admin)/admin/_calendar/actions';
import type { AdvanceRowVM } from '@/app/(admin)/admin/advance/advance-review-modal';
import { AdvanceReviewModal } from '@/app/(admin)/admin/advance/advance-review-modal';
import type { LeaveRowVM } from '@/app/(admin)/admin/leave/leave-review-modal';
import { LeaveReviewModal } from '@/app/(admin)/admin/leave/leave-review-modal';
import { type Column, ResponsiveTable } from '@/components/ui/responsive-table';
import { StatusBadge } from '@/components/ui/status-badge';
import { type ApprovalCard, waitingDays } from '@/lib/approvals/cards';
import { formatThaiDate } from '@/lib/format';
import { reconcileApprovals } from '@/lib/motion/approvals-reconcile';
import { useToast } from '@/lib/motion/toast-context';
import { useExitTransition } from '@/lib/motion/use-exit-transition';
import { type DisputedReviewVM, getDisputedReviewRow } from './disputed-review';
import { DisputedReviewModalLite } from './disputed-review-modal-lite';

const TYPE_LABEL: Record<ApprovalCard['type'], string> = {
  leave: 'ลา',
  advance: 'เบิก',
  disputed: 'ลงเวลา',
};

const keyOf = (c: ApprovalCard) => `${c.type}:${c.id}`;

/** How long a request has sat. The single most useful triage signal on this
 *  page, and the one it never showed: with no date and no age, a 45-day-old
 *  dispute looked exactly like a 3-day-old one.
 *
 *  Two weeks is the threshold for colour. `danger-deep` rather than a literal
 *  red — it is redefined for dark mode (#b91c1c → #ffb7af), which a hardcoded
 *  hex would not be. */
const OVERDUE_DAYS = 14;

function WaitingFor({ days }: { days: number }) {
  const label = days === 0 ? 'วันนี้' : `${days} วัน`;
  return (
    <span
      className={days >= OVERDUE_DAYS ? 'font-medium text-danger-deep' : 'text-ink-3'}
      title={days === 0 ? 'ยื่นวันนี้' : `รอมาแล้ว ${days} วัน`}
    >
      {label}
    </span>
  );
}

export function ApprovalsList({
  cards,
  canReview,
  now,
}: {
  cards: ApprovalCard[];
  canReview: { leave: boolean; advance: boolean; disputed: boolean };
  /** Server-rendered "today" as epoch ms. Passed in rather than read from
   *  Date.now() here: this is a client component that also renders on the
   *  server, and deriving today on both sides produces two different ages
   *  around midnight and a hydration mismatch. */
  now: number;
}) {
  const [items, setItems] = useState(() => cards);
  const removed = useRef(new Set<string>());
  const activeKeyRef = useRef<string | null>(null);
  const { isExiting, beginExit, exitingKeys } = useExitTransition();
  const { toast } = useToast();

  const [leaveRow, setLeaveRow] = useState<LeaveRowVM | null>(null);
  const [advanceRow, setAdvanceRow] = useState<AdvanceRowVM | null>(null);
  const [disputedRow, setDisputedRow] = useState<DisputedReviewVM | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const router = useRouter();

  // Reconcile the list-owned `items` against the server-derived `cards` prop —
  // this fires both on filter-driven prop changes and on the background
  // `router.refresh()` that follows an optimistic exit. `exitingKeys` is a
  // stable function pulled off the exit controller (created once per mount in
  // useExitTransition), so listing it here never causes an extra run — only
  // `cards` changing actually re-triggers this effect.
  useEffect(() => {
    setItems((prev) => reconcileApprovals(prev, cards, removed.current, exitingKeys(), keyOf));
  }, [cards, exitingKeys]);

  async function open(card: ApprovalCard) {
    if (!canReview[card.type]) return;
    activeKeyRef.current = keyOf(card);
    setLoadingId(card.id);
    try {
      if (card.type === 'leave') {
        const vm = await getLeaveReviewRow(card.id);
        setLeaveRow(vm);
        if (!vm) router.refresh();
      } else if (card.type === 'advance') {
        const vm = await getAdvanceReviewRow(card.id);
        setAdvanceRow(vm);
        if (!vm) router.refresh();
      } else {
        const vm = await getDisputedReviewRow(card.id);
        setDisputedRow(vm);
        if (!vm) router.refresh();
      }
    } catch (err) {
      console.error('approvals: failed to load review row', err);
      router.refresh();
    } finally {
      setLoadingId(null);
    }
  }

  function handleActioned() {
    const key = activeKeyRef.current;
    if (!key || isExiting(key)) return;
    beginExit(key, () => {
      removed.current.add(key);
      setItems((xs) => xs.filter((c) => keyOf(c) !== key));
      router.refresh();
    });
    toast('อัปเดตคำขอแล้ว', 'success');
  }

  /** The type-specific detail cell.
   *
   * Returns nodes, not a joined string. The previous version built
   * `· a · b · c` as text inside a flex-wrap span, so at mobile widths each
   * fragment wrapped onto its own line still carrying its leading separator —
   * rows literally began with a dangling "·". Separators now belong to the
   * layout, and the date has a column of its own. */
  function detail(card: ApprovalCard) {
    if (card.type === 'leave') {
      return (
        <>
          <span className="text-ink-1">{card.leaveType}</span>
          <span className="text-ink-3">
            {'\u00a0'}· {card.range}
          </span>
        </>
      );
    }
    if (card.type === 'advance') return <span className="tabular text-ink-1">{card.amount}</span>;
    // The stored reason for a geofence dispute already spells out the
    // distance ("อยู่นอกรัศมี geofence (≈240 ม. เกิน 150 ม.)"), so printing
    // the computed metres beside it says the same number twice. Fall back to
    // the computed distance only when there is no reason to show.
    const why =
      card.reason !== 'ไม่ระบุ'
        ? card.reason
        : card.distanceMeters !== null
          ? `นอกรัศมี ${card.distanceMeters} ม.`
          : card.reason;
    return (
      <>
        <span className="tabular text-ink-1">{card.clockInLabel}</span>
        <span className="text-ink-3">
          {'\u00a0'}· {why}
        </span>
      </>
    );
  }

  const columns: Column<ApprovalCard>[] = [
    {
      key: 'type',
      header: 'ประเภท',
      cell: (c) => <StatusBadge status="neutral">{TYPE_LABEL[c.type]}</StatusBadge>,
    },
    {
      key: 'employee',
      header: 'พนักงาน',
      cell: (c) => (
        <span className="font-medium text-ink-1">
          {c.employeeName}
          {c.nickname && <span className="text-ink-3"> ({c.nickname})</span>}
        </span>
      ),
    },
    {
      key: 'date',
      header: 'วันที่',
      cell: (c) => <span className="tabular text-ink-2">{formatThaiDate(c.submittedAt)}</span>,
    },
    {
      key: 'detail',
      header: 'รายละเอียด',
      // The one column allowed to wrap: a dispute reason is prose, and the
      // no-wrap default would push the table into a horizontal scroll.
      cell: (c) => detail(c),
      // The one column allowed to wrap: a dispute reason is prose, and the
      // no-wrap default would push the table into a horizontal scroll. The
      // rest size from their content.
      className: 'whitespace-normal',
    },
    {
      key: 'branch',
      header: 'สาขา',
      cell: (c) => <span className="text-xs text-ink-4">{c.branch}</span>,
    },
    {
      key: 'waiting',
      header: 'รอมาแล้ว',
      cell: (c) => <WaitingFor days={waitingDays(c.submittedAt, new Date(now))} />,
      className: 'text-right',
    },
  ];

  return (
    <>
      {items.length === 0 ? (
        <div className="surface u-moment-in p-8 text-center text-ink-4">ไม่มีรายการรออนุมัติ</div>
      ) : (
        <>
          <div className="mb-2 flex items-center gap-1 text-sm text-ink-3">
            <span>รออนุมัติ</span>
            <span key={items.length} className="u-badge-pop font-medium text-ink-1">
              {items.length}
            </span>
            <span>รายการ</span>
          </div>

          <ResponsiveTable
            columns={columns}
            rows={items}
            rowKey={keyOf}
            // Room for every column at its natural width. Without it auto
            // layout squeezes the nowrap columns and `.u-collapse-cell`'s
            // hidden overflow truncates them silently; the ScrollArea scrolls
            // instead, which is what `minWidth` exists for.
            minWidth="md:min-w-[64rem]"
            onRowClick={(c) => open(c)}
            collapsing={(c) => isExiting(keyOf(c))}
            rowClassName={(c) => `u-enter-rise${loadingId === c.id ? ' u-shimmer' : ''}`}
            // Cap the cascade at 8: past that the last rows wait on an
            // animation nobody is still watching.
            rowStyle={(_c, i) => ({ animationDelay: `${Math.min(i, 8) * 40}ms` })}
            actions={(c) =>
              loadingId === c.id ? (
                <span className="text-xs text-ink-4">กำลังโหลด…</span>
              ) : canReview[c.type] ? (
                // A span, not a button: the whole row is already clickable and
                // a nested button would swallow the row's own click.
                <span className="whitespace-nowrap rounded-lg border border-[var(--border-color)] px-2.5 py-1 text-xs text-ink-1">
                  ตรวจสอบ
                </span>
              ) : null
            }
            renderMobileRow={(c) => {
              const clickable = canReview[c.type];
              return (
                <div className="px-4 py-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <StatusBadge status="neutral">{TYPE_LABEL[c.type]}</StatusBadge>
                    <WaitingFor days={waitingDays(c.submittedAt, new Date(now))} />
                  </div>
                  <p className="mt-2 font-medium text-ink-1">
                    {c.employeeName}
                    {c.nickname && <span className="text-ink-3"> ({c.nickname})</span>}
                  </p>
                  <p className="mt-0.5 tabular text-xs text-ink-2">
                    {formatThaiDate(c.submittedAt)}
                  </p>
                  <p className="mt-0.5">{detail(c)}</p>
                  <p className="mt-0.5 text-xs text-ink-4">{c.branch}</p>
                  {clickable && (
                    <p className="mt-3 rounded-lg border border-[var(--border-color)] py-2 text-center text-ink-1">
                      {loadingId === c.id ? 'กำลังโหลด…' : 'ตรวจสอบ'}
                    </p>
                  )}
                </div>
              );
            }}
          />
        </>
      )}

      <LeaveReviewModal
        row={leaveRow}
        onClose={() => setLeaveRow(null)}
        onActioned={handleActioned}
      />
      <AdvanceReviewModal
        row={advanceRow}
        onClose={() => setAdvanceRow(null)}
        onActioned={handleActioned}
      />
      <DisputedReviewModalLite
        row={disputedRow}
        onClose={() => setDisputedRow(null)}
        onActioned={handleActioned}
      />
    </>
  );
}
