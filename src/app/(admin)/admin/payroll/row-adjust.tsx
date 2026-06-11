'use client';

import { useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { MonthPicker } from '@/components/ui/month-picker';

/**
 * Per-row "เพิ่ม/ลด" action on the payroll run table.
 *
 * Opens a modal with the employee + month already locked in (the row IS the
 * context — no re-selecting from a dropdown), lists the adjustments already
 * applying to this month with one-click delete, and a quick-add form.
 * The server actions auto-recalculate the month's Drafts on save, so the
 * table numbers update in the same round-trip.
 */

export type RowAdjustment = {
  id: string;
  kind: 'Income' | 'Deduction';
  reason: string;
  /** Pre-formatted "฿1,500.00" — Decimal never crosses to the client. */
  amountLabel: string;
  /** "2026-06" / "2026-05 เป็นต้นไป" / "2026-05 – 2026-07" */
  windowLabel: string;
};

type Props = {
  employeeId: string;
  employeeName: string;
  month: string;
  monthLabel: string;
  adjustments: RowAdjustment[];
  createAction: (formData: FormData) => Promise<void>;
  deleteAction: (formData: FormData) => Promise<void>;
};

function PendingOverlay({ label }: { label: string }) {
  const { pending } = useFormStatus();
  if (!pending) return null;
  return (
    <div className="absolute inset-0 z-10 grid place-items-center rounded-2xl bg-white/80">
      <div className="flex flex-col items-center gap-3">
        <span
          className="size-8 animate-spin rounded-full border-4 border-primary-200 border-t-primary-600"
          aria-hidden="true"
        />
        <p className="text-sm font-medium text-ink-1">{label}</p>
      </div>
    </div>
  );
}

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {label}
    </Button>
  );
}

export function RowAdjust({
  employeeId,
  employeeName,
  month,
  monthLabel,
  adjustments,
  createAction,
  deleteAction,
}: Props) {
  const [open, setOpen] = useState(false);
  const [frequency, setFrequency] = useState<'once' | 'monthly' | 'range'>('once');

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-1 text-xs font-medium text-primary-700 hover:bg-primary-50"
      >
        + เพิ่ม/ลด
        {adjustments.length > 0 && (
          <span className="rounded-full bg-primary-600 px-1.5 py-0.5 font-display text-[10px] font-bold leading-none text-white">
            {adjustments.length}
          </span>
        )}
      </button>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={`เงินเพิ่ม/เงินลด — ${employeeName}`}
        className="sm:max-w-lg"
      >
        <p className="mt-1 text-xs text-ink-3">งวด {monthLabel}</p>

        {/* Existing adjustments applying to this month */}
        {adjustments.length > 0 && (
          <ul className="mt-4 divide-y divide-gray-100 rounded-xl border border-gray-200">
            {adjustments.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                <div className="min-w-0">
                  <p className="truncate text-ink-1">
                    <span
                      className={
                        a.kind === 'Income'
                          ? 'font-medium text-emerald-700'
                          : 'font-medium text-red-700'
                      }
                    >
                      {a.kind === 'Income' ? '+' : '−'}
                      {a.amountLabel}
                    </span>{' '}
                    {a.reason}
                  </p>
                  <p className="text-[11px] text-ink-4">{a.windowLabel}</p>
                </div>
                <form action={deleteAction} className="relative shrink-0">
                  <input type="hidden" name="id" value={a.id} />
                  <input type="hidden" name="month" value={month} />
                  <DeleteButton />
                </form>
              </li>
            ))}
          </ul>
        )}

        {/* Quick-add */}
        <form action={createAction} className="relative mt-4 space-y-4">
          <input type="hidden" name="employeeId" value={employeeId} />
          <input type="hidden" name="startMonth" value={month} />
          <input type="hidden" name="frequency" value={frequency} />

          <div className="flex gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="kind"
                value="Income"
                defaultChecked
                className="h-4 w-4 border-gray-300 text-primary-600 focus:ring-primary-500"
              />
              <span className="font-medium text-emerald-700">เงินเพิ่ม</span>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="kind"
                value="Deduction"
                className="h-4 w-4 border-gray-300 text-primary-600 focus:ring-primary-500"
              />
              <span className="font-medium text-red-700">เงินลด</span>
            </label>
          </div>

          <div className="flex gap-3">
            <FormField label="รายการ" htmlFor={`reason-${employeeId}`} required className="flex-1">
              <Input
                id={`reason-${employeeId}`}
                name="reason"
                required
                maxLength={200}
                placeholder="เช่น ค่าคอมมิชชั่น"
                data-autofocus
              />
            </FormField>
            <FormField label="จำนวนเงิน (บาท)" htmlFor={`amount-${employeeId}`} required>
              <Input
                id={`amount-${employeeId}`}
                name="amount"
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0.01"
                required
                className="w-32"
              />
            </FormField>
          </div>

          <div className="flex items-end gap-3">
            <FormField label="ความถี่" htmlFor={`freq-${employeeId}`}>
              <select
                id={`freq-${employeeId}`}
                value={frequency}
                onChange={(e) => setFrequency(e.target.value as typeof frequency)}
                className="block rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:ring-primary-500"
              >
                <option value="once">รายครั้ง (เฉพาะงวดนี้)</option>
                <option value="monthly">รายเดือน (ตั้งแต่งวดนี้ไป)</option>
                <option value="range">ตามช่วงเวลา</option>
              </select>
            </FormField>
            {frequency === 'range' && (
              <FormField label="ถึงเดือน" htmlFor={`end-${employeeId}`} required>
                <MonthPicker
                  id={`end-${employeeId}`}
                  name="endMonth"
                  defaultValue={month}
                  min={month}
                  className="w-44"
                />
              </FormField>
            )}
          </div>

          <div className="flex justify-end">
            <SubmitButton label="บันทึก + คำนวณใหม่" />
          </div>

          <PendingOverlay label="กำลังบันทึกและคำนวณใหม่…" />
        </form>
      </Dialog>
    </>
  );
}

function DeleteButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
    >
      {pending ? 'กำลังลบ…' : 'ลบ'}
    </button>
  );
}
