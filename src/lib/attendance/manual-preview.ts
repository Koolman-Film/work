/**
 * Pure preview of what a manual attendance entry will record.
 *
 * THE point of this module: the admin form shows "this is what will be
 * saved" BEFORE saving, and `createManualAttendance` then saves exactly
 * that. Both sides call this same function, so the preview can never
 * disagree with the write — a preview that lies about a payroll
 * deduction is the worst bug this feature could ship.
 *
 * Lateness reuses `lateMinutesForCheckIn` — the same helper the LIFF
 * check-in path uses — so a manual entry produces the same result as if
 * the employee's phone had worked. Early leave is deliberately NOT
 * derived: no non-manual path in the system ever creates an EarlyLeave
 * row, so auto-deriving it here would make the manual path stricter
 * than LIFF, which inverts the unfairness this feature exists to fix.
 */

import { hhmmToMinutes, type LatePolicy, lateMinutesForCheckIn } from './late-policy';

export type ManualPreviewInput = {
  kind: 'worked' | 'absent';
  /** YYYY-MM-DD — the Bangkok calendar day being recorded. */
  date: string;
  /** HH:MM — required when kind==='worked'. */
  clockIn?: string | null;
  /** HH:MM — optional; drives the OT / early-leave signals. */
  clockOut?: string | null;
  /**
   * Already resolved by the caller via `resolveLatePolicy(...)`, exactly
   * as check-in.ts does. `null` means the date is not a scheduled workday
   * for this employee, so lateness never applies.
   */
  latePolicy: LatePolicy | null;
  /** HH:MM scheduled end of day; null when the employee has no schedule. */
  scheduledEndTime?: string | null;
  /** Public holiday — cancels lateness, mirroring check-in.ts. */
  isOffDay: boolean;
  /** Admin chose to waive the late deduction for this entry. */
  exemptLate?: boolean;
  /** Admin explicitly opted in to recording an EarlyLeave row. */
  recordEarlyLeave?: boolean;
};

export type PreviewRow = {
  type: 'CheckIn' | 'Absent' | 'Late' | 'EarlyLeave';
  durationMinutes: number | null;
};

export type ManualPreviewResult = {
  /** Exactly the rows that will be inserted, in insertion order. */
  rows: PreviewRow[];
  /** Minutes late — reported even when exempted, so the UI can explain. */
  lateMinutes: number;
  /** Minutes before scheduled end — reported even when not recorded. */
  earlyLeaveMinutes: number;
  /** Minutes past scheduled end — surfaces as an OT candidate. */
  otMinutes: number;
  /** Thai strings for the warning panel. */
  warnings: string[];
};

/**
 * "YYYY-MM-DD" + "HH:MM" → Date at Bangkok local time.
 * Bangkok is UTC+7 year-round (no DST), so a fixed offset is exact.
 */
export function bangkokDateTime(ymd: string, hhmm: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  if (!/^\d{2}:\d{2}$/.test(hhmm)) return null;
  const d = new Date(`${ymd}T${hhmm}:00+07:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function computeManualPreview(input: ManualPreviewInput): ManualPreviewResult {
  if (input.kind === 'absent') {
    return {
      rows: [{ type: 'Absent', durationMinutes: null }],
      lateMinutes: 0,
      earlyLeaveMinutes: 0,
      otMinutes: 0,
      warnings: ['จะบันทึกเป็น "ขาดงาน" และหักเงินตามอัตราขาดงานต่อวัน'],
    };
  }

  const rows: PreviewRow[] = [{ type: 'CheckIn', durationMinutes: null }];
  const warnings: string[] = [];

  // ── Lateness — identical policy to the LIFF check-in path ──────────
  let lateMinutes = 0;
  const clockInAt = input.clockIn ? bangkokDateTime(input.date, input.clockIn) : null;
  if (clockInAt && input.latePolicy && !input.isOffDay) {
    lateMinutes = lateMinutesForCheckIn(clockInAt, input.latePolicy);
  }
  if (lateMinutes > 0) {
    if (input.exemptLate) {
      warnings.push(
        `มาสาย ${lateMinutes} นาที — ยกเว้นการหักครั้งนี้ (เหตุผลจะถูกบันทึกไว้ในประวัติการเปลี่ยนแปลง)`,
      );
    } else {
      rows.push({ type: 'Late', durationMinutes: lateMinutes });
      warnings.push(
        `มาสาย ${lateMinutes} นาที — จะถูกคิดหักตามนโยบายมาสายในรอบเงินเดือน (ขึ้นกับจำนวนครั้งในเดือนนั้น)`,
      );
    }
  }

  // ── Clock-out: early leave (opt-in) and OT signal ──────────────────
  let earlyLeaveMinutes = 0;
  let otMinutes = 0;
  const endMin = input.scheduledEndTime ? hhmmToMinutes(input.scheduledEndTime) : null;
  const outMin = input.clockOut ? hhmmToMinutes(input.clockOut) : null;

  if (endMin != null && outMin != null) {
    const diff = outMin - endMin;
    if (diff < 0) {
      earlyLeaveMinutes = -diff;
      if (input.recordEarlyLeave) {
        rows.push({ type: 'EarlyLeave', durationMinutes: earlyLeaveMinutes });
        warnings.push(`ออกก่อนเวลา ${earlyLeaveMinutes} นาที — จะหักเงินตามอัตราออกก่อนเวลาต่อครั้ง`);
      } else {
        warnings.push(
          `ออกก่อนเวลาเลิกงาน ${earlyLeaveMinutes} นาที — ยังไม่บันทึกเป็น "ออกก่อนเวลา" (ติ๊กเลือกด้านล่างถ้าต้องการหักเงิน)`,
        );
      }
    } else if (diff > 0) {
      otMinutes = diff;
      warnings.push(
        `เกินเวลาเลิกงาน ${otMinutes} นาที — จะขึ้นเป็นผู้เข้าข่าย OT ที่แท็บ OT (ยังไม่จ่ายจนกว่าจะอนุมัติ)`,
      );
    }
  }

  return { rows, lateMinutes, earlyLeaveMinutes, otMinutes, warnings };
}
