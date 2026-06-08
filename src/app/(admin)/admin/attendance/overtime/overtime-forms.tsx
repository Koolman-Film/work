'use client';

import { useState } from 'react';

type Mode = 'PerHourAmount' | 'Multiplier';

/** Rate-mode inputs for the manual-add form (no `form=` association needed —
 *  they sit inside the form). Toggles between ฿/hour and ×multiplier. */
export function RateModeFields({
  defaultRateType = 'PerHourAmount',
  defaultRatePerHour = '',
  defaultMultiplier = '',
}: {
  defaultRateType?: Mode;
  defaultRatePerHour?: string;
  defaultMultiplier?: string;
}) {
  const [mode, setMode] = useState<Mode>(defaultRateType);
  return (
    <span className="inline-flex items-center gap-2">
      <select
        name="rateType"
        value={mode}
        onChange={(e) => setMode(e.target.value as Mode)}
        className="rounded-md border border-gray-300 px-2 py-1 text-sm"
      >
        <option value="PerHourAmount">฿/ชม.</option>
        <option value="Multiplier">×เท่า</option>
      </select>
      {mode === 'PerHourAmount' ? (
        <input
          name="ratePerHour"
          type="number"
          step="1"
          min="0"
          defaultValue={defaultRatePerHour}
          placeholder="฿/ชม."
          className="w-24 rounded-md border border-gray-300 px-2 py-1 text-sm"
        />
      ) : (
        <input
          name="multiplier"
          type="number"
          step="0.25"
          min="0"
          max="9.99"
          defaultValue={defaultMultiplier}
          placeholder="× เช่น 1.5"
          className="w-24 rounded-md border border-gray-300 px-2 py-1 text-sm"
        />
      )}
    </span>
  );
}

/** Rate-mode inputs for a candidate row — associated with the row's approve
 *  `<form id={formId}>` via the HTML `form=` attribute, prefilled from the
 *  employee's defaults. */
export function RateModeFieldsHidden({
  formId,
  defaultRateType,
  defaultRatePerHour,
  defaultMultiplier,
}: {
  formId: string;
  defaultRateType: Mode | null;
  defaultRatePerHour: string | null;
  defaultMultiplier: string | null;
}) {
  const [mode, setMode] = useState<Mode>(defaultRateType ?? 'PerHourAmount');
  return (
    <span className="inline-flex items-center gap-1">
      <select
        form={formId}
        name="rateType"
        value={mode}
        onChange={(e) => setMode(e.target.value as Mode)}
        className="rounded-md border border-gray-300 px-1 py-1 text-xs"
      >
        <option value="PerHourAmount">฿/ชม.</option>
        <option value="Multiplier">×</option>
      </select>
      {mode === 'PerHourAmount' ? (
        <input
          form={formId}
          name="ratePerHour"
          type="number"
          step="1"
          min="0"
          defaultValue={defaultRatePerHour ?? ''}
          className="w-20 rounded-md border border-gray-300 px-1 py-1 text-xs"
        />
      ) : (
        <input
          form={formId}
          name="multiplier"
          type="number"
          step="0.25"
          min="0"
          max="9.99"
          defaultValue={defaultMultiplier ?? ''}
          className="w-20 rounded-md border border-gray-300 px-1 py-1 text-xs"
        />
      )}
    </span>
  );
}
