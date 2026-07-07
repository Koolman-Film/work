'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { getAdvanceReviewRow, getLeaveReviewRow } from '@/app/(admin)/admin/_calendar/actions';
import type { AdvanceRowVM } from '@/app/(admin)/admin/advance/advance-review-modal';
import { AdvanceReviewModal } from '@/app/(admin)/admin/advance/advance-review-modal';
import type { LeaveRowVM } from '@/app/(admin)/admin/leave/leave-review-modal';
import { LeaveReviewModal } from '@/app/(admin)/admin/leave/leave-review-modal';
import { StatusBadge } from '@/components/ui/status-badge';
import type { ApprovalCard } from '@/lib/approvals/cards';
import { type DisputedReviewVM, getDisputedReviewRow } from './disputed-review';
import { DisputedReviewModalLite } from './disputed-review-modal-lite';

const TYPE_LABEL: Record<ApprovalCard['type'], string> = {
  leave: 'ลา',
  advance: 'เบิก',
  disputed: 'ลงเวลา',
};

export function ApprovalsList({
  cards,
  canReview,
}: {
  cards: ApprovalCard[];
  canReview: { leave: boolean; advance: boolean; disputed: boolean };
}) {
  const [leaveRow, setLeaveRow] = useState<LeaveRowVM | null>(null);
  const [advanceRow, setAdvanceRow] = useState<AdvanceRowVM | null>(null);
  const [disputedRow, setDisputedRow] = useState<DisputedReviewVM | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const router = useRouter();

  async function open(card: ApprovalCard) {
    if (!canReview[card.type]) return;
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

  function summary(card: ApprovalCard): string {
    if (card.type === 'leave') return `${card.leaveType} · ${card.range}`;
    if (card.type === 'advance') return card.amount;
    return `${card.clockInLabel}${card.distanceMeters === null ? '' : ` · ${card.distanceMeters} ม.`} · ${card.reason}`;
  }

  return (
    <>
      <ul className="space-y-2">
        {cards.map((card) => {
          const clickable = canReview[card.type];
          return (
            <li key={`${card.type}:${card.id}`} className="surface px-4 py-3">
              <button
                type="button"
                onClick={() => open(card)}
                disabled={!clickable || loadingId === card.id}
                className="flex w-full items-center justify-between gap-3 text-left disabled:cursor-default"
              >
                <span className="flex flex-wrap items-center gap-2">
                  <StatusBadge status="neutral">{TYPE_LABEL[card.type]}</StatusBadge>
                  <span className="font-medium text-ink-1">
                    {card.employeeName}
                    {card.nickname && <span className="text-ink-3"> ({card.nickname})</span>}
                  </span>
                  <span className="text-ink-3">· {summary(card)}</span>
                  <span className="text-xs text-ink-4">· {card.branch}</span>
                </span>
                {loadingId === card.id && <span className="text-xs text-ink-4">กำลังโหลด…</span>}
              </button>
            </li>
          );
        })}
      </ul>

      <LeaveReviewModal row={leaveRow} onClose={() => setLeaveRow(null)} />
      <AdvanceReviewModal row={advanceRow} onClose={() => setAdvanceRow(null)} />
      <DisputedReviewModalLite row={disputedRow} onClose={() => setDisputedRow(null)} />
    </>
  );
}
