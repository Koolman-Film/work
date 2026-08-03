'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { waiveLeaveDeduction } from '@/lib/leave/waive-deduction';

/**
 * Forgive some or all of an over-quota leave deduction.
 *
 * The admin works in DAYS because that is how leave is discussed and how the
 * charge is built (one over-quota day costs one day's pay). Minutes are what
 * gets stored — the deduction is derived at the employee's current per-minute
 * rate, so a waiver kept in days-as-baht would drift after a raise.
 */
export function WaiveDeductionSection({
  leaveRequestId,
  overQuotaMinutes,
  waivedMinutes,
  waiveReason,
  standardDayMinutes,
  onDone,
}: {
  leaveRequestId: string;
  /** Over-quota ceiling if the caller knows it. The SERVER clamps regardless
   *  (against the live figure), so this is only for display and the
   *  "waive everything" shortcut. */
  overQuotaMinutes?: number;
  waivedMinutes: number;
  waiveReason: string | null;
  standardDayMinutes: number;
  onDone?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [days, setDays] = useState<string>('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Sentinel when the ceiling is unknown: the server clamps to the real
  // live over-quota, so "everything" is always expressible.
  const overDays = overQuotaMinutes == null ? null : overQuotaMinutes / standardDayMinutes;
  const waivedDays = waivedMinutes / standardDayMinutes;
  const fmt = (d: number) => (Number.isInteger(d) ? String(d) : d.toFixed(2));
  const WAIVE_ALL = 10_000_000; // clamped server-side to the true over-quota

  function submit(minutes: number) {
    setError(null);
    startTransition(async () => {
      const res = await waiveLeaveDeduction({ leaveRequestId, waiveMinutes: minutes, reason });
      if (res.ok) {
        setOpen(false);
        setDays('');
        setReason('');
        onDone?.();
      } else {
        setError(res.message);
      }
    });
  }

  if (waivedMinutes > 0 && !open) {
    return (
      <div className="rounded-md border border-line bg-surface-muted px-3 py-2 text-sm">
        <p className="text-ink-2">
          ยกเว้นการหักเงินแล้ว <strong>{fmt(waivedDays)} วัน</strong>
          {waiveReason ? <span className="text-ink-3"> — {waiveReason}</span> : null}
        </p>
        <button
          type="button"
          className="mt-1 text-xs text-primary-700 underline"
          onClick={() => setOpen(true)}
        >
          แก้ไข / ยกเลิกการยกเว้น
        </button>
      </div>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        className="text-sm text-primary-700 underline"
        onClick={() => setOpen(true)}
      >
        ยกเว้นการหักเงินวันลาเกินสิทธิ
      </button>
    );
  }

  return (
    <div className="space-y-2 rounded-md border border-line bg-surface-muted px-3 py-3 text-sm">
      <p className="text-ink-2">
        {overDays == null
          ? 'ระบุจำนวนวันที่ต้องการยกเว้นการหักเงิน (เว้นว่าง = ยกเว้นทั้งหมด)'
          : `เกินสิทธิ ${fmt(overDays)} วัน — ระบุจำนวนวันที่ต้องการยกเว้นการหักเงิน`}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="number"
          min={0}
          max={overDays ?? undefined}
          step="0.5"
          value={days}
          onChange={(e) => setDays(e.target.value)}
          placeholder={overDays == null ? 'ทั้งหมด' : fmt(overDays)}
          aria-label="จำนวนวันที่ยกเว้น"
          className="w-28 rounded-md border border-line-strong px-2 py-1"
          disabled={pending}
        />
        <span className="text-ink-3">วัน</span>
        <button
          type="button"
          className="text-xs text-primary-700 underline"
          onClick={() => setDays(overDays == null ? '' : fmt(overDays))}
          disabled={pending}
        >
          ยกเว้นทั้งหมด
        </button>
      </div>
      <input
        type="text"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="เหตุผล (จำเป็น)"
        aria-label="เหตุผล"
        className="w-full rounded-md border border-line-strong px-2 py-1"
        disabled={pending}
      />
      {error && (
        <p role="alert" className="text-danger-deep">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          onClick={() =>
            submit(
              days.trim() === ''
                ? // Blank means "all of it". The server clamps this to the true
                  // live over-quota, so it can never over-forgive.
                  WAIVE_ALL
                : Math.round(Number(days) * standardDayMinutes),
            )
          }
          disabled={pending || !reason.trim()}
        >
          {pending ? 'กำลังบันทึก…' : 'บันทึกการยกเว้น'}
        </Button>
        {waivedMinutes > 0 && (
          // 0 clears the waiver and restores the full charge — how a mistaken
          // waiver is undone, and itself audited.
          <Button type="button" variant="secondary" onClick={() => submit(0)} disabled={pending}>
            ยกเลิกการยกเว้น
          </Button>
        )}
        <Button type="button" variant="secondary" onClick={() => setOpen(false)} disabled={pending}>
          ปิด
        </Button>
      </div>
    </div>
  );
}
