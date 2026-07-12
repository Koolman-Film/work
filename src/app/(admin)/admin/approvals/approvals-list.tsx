'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { getAdvanceReviewRow, getLeaveReviewRow } from '@/app/(admin)/admin/_calendar/actions';
import type { AdvanceRowVM } from '@/app/(admin)/admin/advance/advance-review-modal';
import { AdvanceReviewModal } from '@/app/(admin)/admin/advance/advance-review-modal';
import type { LeaveRowVM } from '@/app/(admin)/admin/leave/leave-review-modal';
import { LeaveReviewModal } from '@/app/(admin)/admin/leave/leave-review-modal';
import { StatusBadge } from '@/components/ui/status-badge';
import type { ApprovalCard } from '@/lib/approvals/cards';
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

export function ApprovalsList({
  cards,
  canReview,
}: {
  cards: ApprovalCard[];
  canReview: { leave: boolean; advance: boolean; disputed: boolean };
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

  function summary(card: ApprovalCard): string {
    if (card.type === 'leave') return `${card.leaveType} · ${card.range}`;
    if (card.type === 'advance') return card.amount;
    return `${card.clockInLabel}${card.distanceMeters === null ? '' : ` · ${card.distanceMeters} ม.`} · ${card.reason}`;
  }

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

          <ul className="space-y-2">
            {items.map((card, index) => {
              const key = keyOf(card);
              const clickable = canReview[card.type];
              const loading = loadingId === card.id;
              return (
                <li
                  key={key}
                  className="u-enter-rise"
                  style={{ animationDelay: `calc(${Math.min(index, 8)} * 40ms)` }}
                >
                  <div className="u-collapse-wrap" data-exiting={isExiting(key)}>
                    <div className={`surface px-4 py-3 ${loading ? 'u-shimmer' : ''}`}>
                      <button
                        type="button"
                        onClick={() => open(card)}
                        disabled={!clickable || loading}
                        className="flex w-full items-center justify-between gap-3 text-left transition hover:-translate-y-px hover:shadow-sm active:scale-[0.99] disabled:cursor-default"
                      >
                        <span className="flex flex-wrap items-center gap-2">
                          <StatusBadge status="neutral">{TYPE_LABEL[card.type]}</StatusBadge>
                          <span className="font-medium text-ink-1">
                            {card.employeeName}
                            {card.nickname && (
                              <span className="text-ink-3"> ({card.nickname})</span>
                            )}
                          </span>
                          <span className="text-ink-3">· {summary(card)}</span>
                          <span className="text-xs text-ink-4">· {card.branch}</span>
                        </span>
                        {loading && <span className="text-xs text-ink-4">กำลังโหลด…</span>}
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
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
