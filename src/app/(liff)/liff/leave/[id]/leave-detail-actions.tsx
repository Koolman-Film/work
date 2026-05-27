'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { cancelLeaveRequest } from '@/lib/leave/actions';

/**
 * Cancel button + inline confirm.
 *
 * UX: first tap "ยกเลิกคำขอ" opens a confirm sheet (extra space below
 * with "ยืนยันยกเลิก" / "ไม่ยกเลิก"); second tap fires the action.
 * This prevents accidental cancellation of a request the employee may
 * have spent time crafting.
 */

export function LeaveDetailActions({ leaveRequestId }: { leaveRequestId: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onCancel() {
    setError(null);
    startTransition(async () => {
      const result = await cancelLeaveRequest(leaveRequestId);
      if (result.ok) {
        router.refresh(); // re-renders parent Server Component with new status
        setConfirming(false);
      } else {
        setError(result.message);
      }
    });
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="w-full rounded-xl border border-red-200 bg-white px-4 py-3 text-sm font-medium text-red-700 transition hover:bg-red-50"
      >
        ยกเลิกคำขอ
      </button>
    );
  }

  return (
    <div className="space-y-3 rounded-xl border border-red-200 bg-red-50/40 p-4">
      <p className="text-sm text-red-900">
        ยืนยันการยกเลิกคำขอนี้? <span className="text-xs text-red-700">ไม่สามารถย้อนกลับได้</span>
      </p>
      {error && <p className="text-xs text-red-700">{error}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setConfirming(false)}
          disabled={pending}
          className="flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          ไม่ยกเลิก
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          className="flex-1 rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-red-700 disabled:opacity-60"
        >
          {pending ? '...' : 'ยืนยันยกเลิก'}
        </button>
      </div>
    </div>
  );
}
