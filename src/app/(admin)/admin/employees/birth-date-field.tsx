'use client';

/**
 * วันเกิด (date of birth) input + live อายุ (age) badge — the sibling of
 * HiredAtField's อายุงาน badge, built the same way: a controlled client island
 * that still submits through name="dateOfBirth", so the server action is
 * unchanged. `todayYmd` comes from the server (Bangkok today) so SSR and
 * hydration agree, and caps the picker: nobody is born tomorrow.
 */

import { useState } from 'react';
import { DateField } from '@/components/ui/date-field';
import { tenureBreakdown } from '@/lib/employee/tenure';

export function BirthDateField({
  initialValue,
  todayYmd,
}: {
  initialValue: string | null;
  todayYmd: string;
}) {
  const [value, setValue] = useState<string | null>(initialValue);
  const age = value ? tenureBreakdown(value, todayYmd) : null;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <DateField
        id="dateOfBirth"
        name="dateOfBirth"
        value={value}
        onChange={setValue}
        max={todayYmd}
        clearable
        placeholder="เลือกหรือพิมพ์วันที่"
        className="min-w-0 flex-1 basis-56"
      />
      {age && (
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md bg-primary-50 px-2.5 py-1.5 text-sm">
          <span className="text-primary-500">อายุ</span>
          <span className="font-semibold tabular-nums text-primary-800">{age.years} ปี</span>
        </span>
      )}
    </div>
  );
}
