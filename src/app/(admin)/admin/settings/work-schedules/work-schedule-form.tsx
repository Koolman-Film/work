import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';

/**
 * Per-day work schedule form — shared between Create and Edit.
 *
 * Layout:
 *   - Name + late-tolerance at the top (one card)
 *   - 7-row grid: Sun..Sat with [enabled?] + [start time] + [end time]
 *   - Submit / Cancel
 *
 * Day-of-week order: Sun first per Date.getDay() convention, but visually
 * we lead with Mon to match Thai workplace expectations (the week
 * starts on Monday in everyday speech). The form's `name="day-N-*"`
 * keys still use 0=Sun for round-trip compatibility with the schema.
 *
 * Time inputs use `<input type="time">` — browsers render this as a
 * native picker on mobile (LIFF webview) and a stepper on desktop.
 * Falls back to a plain text input on really old browsers; the Server
 * Action re-validates with the HH:MM regex either way.
 */

type DayInitial = {
  enabled: boolean;
  startTime: string;
  endTime: string;
};

type Initial = {
  name: string;
  lateToleranceMin: number;
  days: ReadonlyArray<DayInitial>; // length 7, index 0=Sun..6=Sat
};

type Mode =
  | { mode: 'create'; action: (formData: FormData) => Promise<void>; initial?: undefined }
  | { mode: 'edit'; action: (formData: FormData) => Promise<void>; initial: Initial };

type Props = Mode & {
  error?: string | null;
  /** Optional trailing slot (e.g. Archive button) on edit mode. */
  extraActions?: React.ReactNode;
};

// Day-of-week labels — visually ordered Mon-first; data-indexed Sun-first.
const DAY_DISPLAY_ORDER: ReadonlyArray<{ dow: number; label: string }> = [
  { dow: 1, label: 'จันทร์' },
  { dow: 2, label: 'อังคาร' },
  { dow: 3, label: 'พุธ' },
  { dow: 4, label: 'พฤหัสบดี' },
  { dow: 5, label: 'ศุกร์' },
  { dow: 6, label: 'เสาร์' },
  { dow: 0, label: 'อาทิตย์' },
];

/** Default times — used when the form starts a fresh row (no initial). */
const DEFAULT_START = '09:00';
const DEFAULT_END = '18:00';

/**
 * Default "enabled" pattern: Mon–Sat. The user explicitly asked for
 * this default. Sunday is the default closed day.
 */
const DEFAULT_ENABLED: Record<number, boolean> = {
  0: false, // Sun
  1: true, // Mon
  2: true, // Tue
  3: true, // Wed
  4: true, // Thu
  5: true, // Fri
  6: true, // Sat
};

export function WorkScheduleForm({ mode, action, initial, error, extraActions }: Props) {
  const submitLabel = mode === 'create' ? 'สร้างตาราง' : 'บันทึก';

  // For each dayOfWeek index 0..6, pick the initial values: if editing,
  // use initial; if creating, use the Mon-Sat default pattern.
  function defaultsFor(dow: number): DayInitial {
    if (initial) return initial.days[dow] ?? { enabled: false, startTime: '', endTime: '' };
    return {
      enabled: DEFAULT_ENABLED[dow] ?? false,
      startTime: DEFAULT_START,
      endTime: DEFAULT_END,
    };
  }

  return (
    <>
      <form action={action} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>{mode === 'create' ? 'สร้างตารางงานใหม่' : `แก้ไข: ${initial.name}`}</CardTitle>
          </CardHeader>
          <CardBody className="space-y-5">
            {error && (
              <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </p>
            )}

            <FormField label="ชื่อตาราง" htmlFor="name" required>
              <Input
                id="name"
                name="name"
                required
                maxLength={80}
                defaultValue={initial?.name ?? ''}
                placeholder="เช่น ตารางหลัก (จ.–ส.)"
                autoFocus
              />
            </FormField>

            <FormField
              label="เวลายืดหยุ่นก่อนสาย (นาที)"
              htmlFor="lateToleranceMin"
              hint="เช็คอินหลังเวลาเริ่ม + ค่านี้ จะถูกบันทึกเป็น Late อัตโนมัติ"
            >
              <Input
                id="lateToleranceMin"
                name="lateToleranceMin"
                type="number"
                min={0}
                max={240}
                step={1}
                defaultValue={initial?.lateToleranceMin ?? 15}
                className="max-w-[10rem]"
              />
            </FormField>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>เวลาทำงานต่อวัน</CardTitle>
          </CardHeader>
          <CardBody>
            <p className="mb-3 text-xs text-gray-500">
              เลือกวันทำงาน + ตั้งเวลาเริ่ม-เลิกงานสำหรับแต่ละวัน (ต้องเลือกอย่างน้อย 1 วัน)
            </p>

            <ul className="divide-y divide-gray-100">
              {DAY_DISPLAY_ORDER.map(({ dow, label }) => {
                const d = defaultsFor(dow);
                return (
                  <li
                    key={dow}
                    className="grid grid-cols-[7rem_auto_1fr_1fr] items-center gap-3 py-3"
                  >
                    {/* Day name */}
                    <span className="text-sm font-medium text-gray-700">{label}</span>

                    {/* Enabled checkbox */}
                    <label className="inline-flex items-center gap-2">
                      <input
                        type="checkbox"
                        name={`day-${dow}-enabled`}
                        defaultChecked={d.enabled}
                        className="size-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500/30"
                      />
                      <span className="text-xs text-gray-500">ทำงาน</span>
                    </label>

                    {/* Start time — label wraps input for accessibility
                        without needing a unique htmlFor on every row. */}
                    <label className="block">
                      <span className="block text-[10px] uppercase tracking-wider text-gray-400">
                        เริ่ม
                      </span>
                      <input
                        type="time"
                        name={`day-${dow}-startTime`}
                        defaultValue={d.startTime || DEFAULT_START}
                        className="mt-0.5 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm tabular-nums focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500/30"
                      />
                    </label>

                    {/* End time */}
                    <label className="block">
                      <span className="block text-[10px] uppercase tracking-wider text-gray-400">
                        เลิก
                      </span>
                      <input
                        type="time"
                        name={`day-${dow}-endTime`}
                        defaultValue={d.endTime || DEFAULT_END}
                        className="mt-0.5 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm tabular-nums focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500/30"
                      />
                    </label>
                  </li>
                );
              })}
            </ul>
          </CardBody>
          <CardFooter className="flex items-center justify-between">
            <Link href="/admin/settings/work-schedules">
              <Button type="button" variant="secondary">
                ยกเลิก
              </Button>
            </Link>
            <Button type="submit">{submitLabel}</Button>
          </CardFooter>
        </Card>
      </form>

      {extraActions && (
        <div className="mt-6 rounded-xl border border-red-200 bg-red-50/30 px-5 py-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-red-700">พื้นที่อันตราย</p>
          <p className="mt-1 text-xs text-red-700/80">การกระทำในส่วนนี้ไม่สามารถย้อนกลับได้</p>
          <div className="mt-3 flex justify-end">{extraActions}</div>
        </div>
      )}
    </>
  );
}
