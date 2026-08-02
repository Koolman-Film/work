'use client';

/**
 * Adjustment cell for the entitlement editor — a number input + วัน/ชม. unit
 * toggle. Flipping the unit converts the shown number LOSSLESSLY through the
 * stored minutes (so the quantity never changes on toggle, and it round-trips),
 * and a subtle "= N ชม." hint appears when a วัน value isn't a whole/half day.
 *
 * Submits `adjustment` (the number) + `adjustmentUnit` on the row's form; the
 * server action (upsertEntitlement) does the authoritative → minutes convert.
 */

import { useState } from 'react';
import {
  type AdjustmentUnit,
  adjustmentDisplay,
  adjustmentToMinutes,
  minutesInUnit,
} from '@/lib/leave/units';

/** Trim float noise for display ("-0.125", "-3.5", "2"). */
function fmt(n: number): string {
  return String(Number(n.toFixed(6)));
}

export function AdjustmentInput({
  formId,
  initialMinutes,
  std,
}: {
  formId: string;
  initialMinutes: number;
  std: number;
}) {
  const initial = adjustmentDisplay(initialMinutes, std);
  const [unit, setUnit] = useState<AdjustmentUnit>(initial.unit);
  const [value, setValue] = useState<string>(fmt(initial.value));

  // Current entry as stored minutes — the single source of truth for both the
  // toggle conversion and the equivalence hint. Guard the transient invalid
  // states of a number field ("", "-", "1e") → treat as 0 so the toggle and
  // hint never surface NaN.
  const parsed = Number(value);
  const minutes = Number.isFinite(parsed) ? adjustmentToMinutes(parsed, unit, std) : 0;

  function switchUnit(next: AdjustmentUnit) {
    if (next === unit) return;
    setValue(fmt(minutesInUnit(minutes, next, std)));
    setUnit(next);
  }

  // In วัน mode, a value that isn't a whole/half day reads as an odd fraction —
  // show its clean hour equivalent so it's self-explanatory.
  const showHint = unit === 'day' && (2 * minutes) % std !== 0;

  return (
    <div className="flex items-center gap-1.5">
      <input
        form={formId}
        name="adjustment"
        type="number"
        step="any"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="w-20 rounded-md border border-line-strong px-2 py-1"
      />
      <select
        form={formId}
        name="adjustmentUnit"
        aria-label="หน่วยของค่าปรับปรุง"
        value={unit}
        onChange={(e) => switchUnit(e.target.value as AdjustmentUnit)}
        className="rounded-md border border-line-strong px-1 py-1 text-sm"
      >
        <option value="day">วัน</option>
        <option value="hour">ชม.</option>
      </select>
      {showHint && (
        <span className="whitespace-nowrap text-xs text-ink-4">
          = {fmt(minutesInUnit(minutes, 'hour', std))} ชม.
        </span>
      )}
    </div>
  );
}
