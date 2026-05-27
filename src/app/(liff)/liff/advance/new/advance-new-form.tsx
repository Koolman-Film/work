'use client';

/**
 * Cash-advance request form.
 *
 * Mobile-first: numeric keypad on phones via inputMode='decimal', large
 * tap target on submit, ฿ prefix to set expectations.
 *
 * Why we coerce the string to a number client-side rather than letting
 * the server parse:
 *   - The form's "valid" state (enables/disables submit) depends on a
 *     finite, positive, 2-decimal value. Coercing once at the boundary
 *     keeps that gate honest.
 *   - On submit, we still send the number — the server re-validates
 *     because client trust is zero.
 */

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { submitCashAdvance } from '@/lib/advance/actions';

const QUICK_AMOUNTS = [500, 1_000, 2_000, 5_000];

export function AdvanceNewForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [amount, setAmount] = useState<string>(''); // string for input fidelity
  const [error, setError] = useState<string | null>(null);

  const parsed = (() => {
    if (!amount.trim()) return null;
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) return null;
    // Two decimal places max.
    if (Math.round(n * 100) !== n * 100) return null;
    return n;
  })();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (parsed == null) {
      setError('กรุณากรอกจำนวนเงินที่ถูกต้อง');
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await submitCashAdvance({ amount: parsed });
      if (result.ok) {
        router.push(`/liff/advance/${result.id}`);
      } else {
        setError(result.message);
      }
    });
  }

  return (
    <main className="mx-auto max-w-md px-4 pt-8 pb-12">
      <h1 className="text-2xl font-semibold text-gray-900">ขอเบิกเงินล่วงหน้า</h1>
      <p className="mt-1 text-sm text-gray-500">เงินที่เบิกจะถูกหักจากเงินเดือนงวดถัดไปโดยอัตโนมัติ</p>

      <form
        onSubmit={onSubmit}
        className="mt-6 space-y-5 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm"
      >
        {error && (
          <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}

        <div>
          <label htmlFor="amount" className="mb-1.5 block text-sm font-medium text-gray-700">
            จำนวนเงิน (บาท) <span className="text-red-600">*</span>
          </label>
          <div className="relative">
            <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-lg font-medium text-gray-400">
              ฿
            </span>
            <input
              id="amount"
              inputMode="decimal"
              autoComplete="off"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
              className="w-full rounded-md border border-gray-300 py-3 pr-3 pl-8 text-right text-lg font-semibold tabular-nums shadow-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
            />
          </div>
        </div>

        {/* Quick-amount chips */}
        <div>
          <p className="mb-2 text-xs text-gray-500">ตัวเลือกด่วน</p>
          <div className="flex flex-wrap gap-2">
            {QUICK_AMOUNTS.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setAmount(n.toString())}
                disabled={pending}
                className="rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
              >
                ฿{n.toLocaleString('th-TH')}
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <strong>หมายเหตุ:</strong> สามารถมีคำขอที่รออนุมัติได้ครั้งละ 1 รายการ
          หากต้องการขอเพิ่มต้องรอให้แอดมินตัดสินใจหรือยกเลิกคำขอเดิมก่อน
        </div>

        <div className="flex items-center justify-between gap-2 pt-2">
          <button
            type="button"
            onClick={() => router.back()}
            disabled={pending}
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            ยกเลิก
          </button>
          <button
            type="submit"
            disabled={pending || parsed == null}
            className="rounded-lg bg-primary-600 px-5 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pending ? 'กำลังส่ง...' : 'ส่งคำขอ'}
          </button>
        </div>
      </form>
    </main>
  );
}
