'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { MonthSelect } from '@/components/ui/month-select';

/**
 * Create/edit form for PayrollAdjustment (เงินเพิ่ม/เงินลด).
 *
 * Client component because the frequency radio toggles the endMonth
 * field — everything else is a plain uncontrolled form posting to the
 * Server Action, same as the other admin CRUD forms.
 */

export type EmployeeOption = { id: string; label: string };

export type AdjustmentInitial = {
  employeeId: string;
  kind: 'Income' | 'Deduction';
  reason: string;
  /** Decimal as plain string ("1500.50"). */
  amount: string;
  frequency: 'once' | 'monthly' | 'range';
  startMonth: string;
  endMonth: string;
  note: string;
};

type Props = {
  mode: 'create' | 'edit';
  action: (fd: FormData) => Promise<void>;
  employees: EmployeeOption[];
  /** Current Bangkok month "YYYY-MM" — anchors the month dropdowns. */
  currentMonth: string;
  initial?: AdjustmentInitial;
  error?: string | null;
  extraActions?: React.ReactNode;
};

const FREQ_CHOICES = [
  { value: 'once', label: 'รายครั้ง', hint: 'หักหรือจ่ายเฉพาะเดือนที่เลือก' },
  { value: 'monthly', label: 'รายเดือน', hint: 'ทุกเดือนตั้งแต่เดือนเริ่มต้น จนกว่าจะลบ' },
  { value: 'range', label: 'ตามช่วงเวลา', hint: 'ตั้งแต่เดือนเริ่มต้นถึงเดือนสิ้นสุด' },
] as const;

export function AdjustmentForm({
  mode,
  action,
  employees,
  currentMonth,
  initial,
  error,
  extraActions,
}: Props) {
  const [frequency, setFrequency] = useState<'once' | 'monthly' | 'range'>(
    initial?.frequency ?? 'once',
  );

  return (
    <>
      <form action={action}>
        <Card>
          <CardHeader>
            <CardTitle>
              {mode === 'create' ? 'เพิ่มรายการเงินเพิ่ม/เงินลด' : 'แก้ไขรายการเงินเพิ่ม/เงินลด'}
            </CardTitle>
          </CardHeader>
          <CardBody className="space-y-5">
            {error && (
              <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </p>
            )}

            <FormField label="พนักงาน" htmlFor="employeeId" required>
              <select
                id="employeeId"
                name="employeeId"
                required
                defaultValue={initial?.employeeId ?? ''}
                className="block w-full max-w-md rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:ring-primary-500"
              >
                <option value="" disabled>
                  — เลือกพนักงาน —
                </option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.label}
                  </option>
                ))}
              </select>
            </FormField>

            <FormField label="ประเภท" htmlFor="kind" required>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="kind"
                    value="Income"
                    defaultChecked={(initial?.kind ?? 'Income') === 'Income'}
                    className="h-4 w-4 border-gray-300 text-primary-600 focus:ring-primary-500"
                  />
                  <span className="font-medium text-emerald-700">เงินเพิ่ม</span>
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="kind"
                    value="Deduction"
                    defaultChecked={initial?.kind === 'Deduction'}
                    className="h-4 w-4 border-gray-300 text-primary-600 focus:ring-primary-500"
                  />
                  <span className="font-medium text-red-700">เงินลด</span>
                </label>
              </div>
            </FormField>

            <FormField
              label="รายการ"
              htmlFor="reason"
              required
              hint="เช่น ค่าคอมมิชชั่น, ค่าน้ำมัน, หักค่าชุดฟอร์ม"
            >
              <Input
                id="reason"
                name="reason"
                required
                maxLength={200}
                defaultValue={initial?.reason ?? ''}
                autoFocus={mode === 'create'}
              />
            </FormField>

            <FormField label="จำนวนเงิน (บาท)" htmlFor="amount" required>
              <Input
                id="amount"
                name="amount"
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0.01"
                required
                defaultValue={initial?.amount ?? ''}
                className="max-w-xs"
              />
            </FormField>

            <FormField label="ความถี่" htmlFor="frequency" required>
              <div className="space-y-2">
                {FREQ_CHOICES.map((c) => (
                  <label key={c.value} className="flex items-start gap-3">
                    <input
                      type="radio"
                      name="frequency"
                      value={c.value}
                      checked={frequency === c.value}
                      onChange={() => setFrequency(c.value)}
                      className="mt-1 h-4 w-4 border-gray-300 text-primary-600 focus:ring-primary-500"
                    />
                    <span className="text-sm">
                      <span className="font-medium text-gray-900">{c.label}</span>
                      <span className="block text-xs text-gray-500">{c.hint}</span>
                    </span>
                  </label>
                ))}
              </div>
            </FormField>

            <div className="flex flex-wrap gap-4">
              <FormField
                label={frequency === 'once' ? 'เดือน' : 'เดือนเริ่มต้น'}
                htmlFor="startMonth"
                required
              >
                <MonthSelect
                  id="startMonth"
                  name="startMonth"
                  from={currentMonth}
                  back={12}
                  forward={24}
                  defaultValue={initial?.startMonth || currentMonth}
                  required
                  className="w-44"
                />
              </FormField>

              {frequency === 'range' && (
                <FormField label="เดือนสิ้นสุด" htmlFor="endMonth" required>
                  <MonthSelect
                    id="endMonth"
                    name="endMonth"
                    from={currentMonth}
                    back={12}
                    forward={24}
                    defaultValue={initial?.endMonth || currentMonth}
                    required
                    className="w-44"
                  />
                </FormField>
              )}
            </div>

            <FormField label="หมายเหตุ" htmlFor="note">
              <Input id="note" name="note" maxLength={500} defaultValue={initial?.note ?? ''} />
            </FormField>
          </CardBody>
          <CardFooter className="flex items-center justify-between">
            <Link href="/admin/payroll/adjustments">
              <Button type="button" variant="secondary">
                ยกเลิก
              </Button>
            </Link>
            <Button type="submit">{mode === 'create' ? 'เพิ่มรายการ' : 'บันทึก'}</Button>
          </CardFooter>
        </Card>
      </form>

      {/* Destructive action lives OUTSIDE the update form — nested forms are
          invalid HTML and would submit the wrong action. */}
      {extraActions && (
        <div className="mt-6 rounded-xl border border-red-200 bg-red-50/30 px-5 py-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-red-700">พื้นที่อันตราย</p>
          <p className="mt-1 text-xs text-red-700/80">
            ลบรายการนี้ — เดือนที่เผยแพร่สลิปไปแล้วจะไม่เปลี่ยน แต่เดือนถัดไปจะไม่ถูกคิดอีก
          </p>
          <div className="mt-3 flex justify-end">{extraActions}</div>
        </div>
      )}
    </>
  );
}
