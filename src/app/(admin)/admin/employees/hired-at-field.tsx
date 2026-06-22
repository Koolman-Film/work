'use client';

/**
 * วันเริ่มงาน (hire date) input + live อายุงาน (length-of-service) badge.
 *
 * A controlled client island so the tenure recomputes as the admin edits the
 * date — no page reload, no getElementById. Still submits via name="hiredAt",
 * so the server action is unchanged. `todayYmd` is passed from the server (the
 * page's Bangkok "today") so SSR and hydration agree on the reference date.
 */

import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { formatTenureThai, tenureBreakdown } from '@/lib/employee/tenure';

export function HiredAtField({
  initialValue,
  todayYmd,
}: {
  initialValue: string;
  todayYmd: string;
}) {
  const [value, setValue] = useState(initialValue);
  const tenure = value ? tenureBreakdown(value, todayYmd) : null;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <Input
        id="hiredAt"
        name="hiredAt"
        type="date"
        required
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="max-w-xs"
      />
      {value && (
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md bg-primary-50 px-2.5 py-1.5 text-sm">
          <span className="text-primary-500">อายุงาน</span>
          {tenure ? (
            <span className="font-semibold tabular-nums text-primary-800">
              {formatTenureThai(tenure)}
            </span>
          ) : (
            <span className="font-medium text-ink-4">ยังไม่เริ่มงาน</span>
          )}
        </span>
      )}
    </div>
  );
}
