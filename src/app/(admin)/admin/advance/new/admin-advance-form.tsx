'use client';

/**
 * Admin "record a cash-advance on behalf of an employee" form.
 *
 * For the worker who can't use LIFF (broken phone, etc.). Just employee +
 * amount — advances have no date/type. On submit it creates a Pending request
 * via `adminCreateCashAdvance`; the admin is sent to /admin/advance to approve
 * it (where the receipt upload + money-confirm already live). Admin panel is
 * Thai-only by convention, so no i18n here.
 */

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { adminCreateCashAdvance } from '@/lib/advance/admin';

type EmployeeOption = { id: string; label: string };
type Props = { employees: EmployeeOption[] };

export function AdminAdvanceForm({ employees }: Props) {
  const router = useRouter();
  const [employeeId, setEmployeeId] = useState('');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!employeeId) {
      setError('กรุณาเลือกพนักงาน');
      return;
    }
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      setError('กรุณากรอกจำนวนเงินให้ถูกต้อง');
      return;
    }

    startTransition(async () => {
      const result = await adminCreateCashAdvance({ employeeId, amount: amt });
      if (result.ok) {
        // Land on the Pending inbox so the admin can approve (+ attach slip).
        router.push('/admin/advance');
        router.refresh();
      } else {
        setError(result.message);
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <FormField label="พนักงาน" htmlFor="employeeId" required>
        <select
          id="employeeId"
          value={employeeId}
          onChange={(e) => setEmployeeId(e.target.value)}
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          required
        >
          <option value="">— เลือกพนักงาน —</option>
          {employees.map((e) => (
            <option key={e.id} value={e.id}>
              {e.label}
            </option>
          ))}
        </select>
      </FormField>

      <FormField label="จำนวนเงิน (บาท)" htmlFor="amount" required hint="สูงสุด ฿100,000 ต่อครั้ง">
        <Input
          id="amount"
          type="number"
          min={1}
          max={100000}
          step="0.01"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="เช่น 5000"
          required
        />
      </FormField>

      {error && (
        <div role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="flex items-center justify-end gap-3 pt-2">
        <Button type="button" variant="ghost" onClick={() => router.back()} disabled={pending}>
          ยกเลิก
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? 'กำลังบันทึก...' : 'บันทึก → รออนุมัติ'}
        </Button>
      </div>
    </form>
  );
}
