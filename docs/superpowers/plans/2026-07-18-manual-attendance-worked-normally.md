# Manual Attendance "Worked Normally" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ให้แอดมินบันทึก "พนักงานมาทำงานปกติ แต่เช็คอินด้วย LINE ไม่ได้" ได้ โดยกรอกเวลาเข้า-ออก แล้วระบบสร้างแถว `CheckIn` (+ `Late` ถ้าสาย) ด้วยนโยบายเดียวกับ LIFF พร้อมเตือนก่อนบันทึก

**Architecture:** เพิ่ม pure function `computeManualPreview` เป็นแหล่งความจริงเดียวที่ทั้ง client preview และ server action เรียกใช้ แล้วเขียน `createManualAttendance` ใหม่ให้สร้างหลายแถวในทรานแซกชันเดียว และจัดโครง UI เป็น มา/ไม่มา + เวลา

**Tech Stack:** Next.js 16 App Router, Prisma/Postgres, Vitest (node env — ไม่มี jsdom/testing-library), Tailwind v4, Biome

**Spec:** `docs/superpowers/specs/2026-07-18-manual-attendance-worked-normally-design.md`

## Global Constraints

- **ห้ามแตะ** `src/lib/payroll/**` (calc.ts, run.ts, deduction-breakdown.ts) — งานนี้ไม่แก้สูตรเงินเดือนใด ๆ
- **ห้ามแตะ** `src/lib/attendance/check-in.ts` และเส้นทาง LIFF ทั้งหมด
- **ห้ามแก้ schema / migration / enum** — ใช้ `AttType` และ `AttSource` ที่มีอยู่แล้ว
- **ห้ามคำนวณ `EarlyLeave` อัตโนมัติ** — ต้องเป็น opt-in จากแอดมินเท่านั้น (เพราะไม่มีเส้นทางไหนในระบบสร้าง `EarlyLeave` อัตโนมัติ การคำนวณเองจะทำให้คีย์มือเข้มกว่า LIFF)
- **ห้ามแสดงยอดเงิน ฿ สำหรับ `Late`** — นโยบายมาสายเป็นแบบขั้นบันได/นับครั้งทั้งเดือน คำนวณล่วงหน้าให้ตรงไม่ได้ แสดงเป็นจำนวนนาที + คำอธิบายแทน
- **ทั้ง client และ server ต้องเรียก `computeManualPreview` ตัวเดียวกัน** — ห้ามเขียนตรรกะพรีวิวซ้ำในฝั่ง client
- แถวที่สร้างทุกแถวต้องมี `source: 'Manual'`, `createdById` = admin user id, และพิกัด GPS เป็น `null`
- ข้อความ UI ทั้งหมดเป็นภาษาไทย (admin เป็น Thai-only)
- Timezone: Asia/Bangkok คือ UTC+7 คงที่ (ไม่มี DST)
- รันทดสอบด้วย `pnpm test` — ต้องผ่านทั้งหมดก่อนจบแต่ละ task

## File Structure

| ไฟล์ | สถานะ | หน้าที่ |
|---|---|---|
| `src/lib/attendance/manual-preview.ts` | สร้าง | pure fn: เวลา+policy → แถวที่จะสร้าง + คำเตือน |
| `src/lib/attendance/manual-preview.test.ts` | สร้าง | unit tests ของ pure fn |
| `src/lib/attendance/manual.ts` | เขียนใหม่ | server action: โหลด policy, สร้างหลายแถวในทรานแซกชัน |
| `src/lib/attendance/manual.branch.test.ts` | แก้ | ปรับ input shape ให้ตรงของใหม่ |
| `src/app/(admin)/admin/attendance/manual/page.tsx` | แก้ | โหลด/ส่งตารางงาน + policy + วันหยุด + rates |
| `src/app/(admin)/admin/attendance/manual/manual-form.tsx` | เขียนใหม่ | UI มา/ไม่มา + เวลา + แผงเตือนสด |

---

### Task 1: `manual-preview.ts` — pure function + tests

**Files:**
- Create: `src/lib/attendance/manual-preview.ts`
- Create: `src/lib/attendance/manual-preview.test.ts`

**Interfaces:**
- Consumes: `LatePolicy`, `hhmmToMinutes`, `lateMinutesForCheckIn` จาก `./late-policy`
- Produces: `bangkokDateTime(ymd, hhmm): Date | null`, `computeManualPreview(input): ManualPreviewResult`, และ types `ManualPreviewInput` / `PreviewRow` / `ManualPreviewResult` — Task 2 และ Task 3 เรียกใช้ทั้งหมดนี้

**บริบท:** `lateMinutesForCheckIn(clockInAt: Date, policy)` มีอยู่แล้วและใช้กับ LIFF — เรียกใช้ซ้ำห้ามเขียนใหม่ กติกา grace คือ `lateBy > graceMin` (start 09:00 grace 15 → 09:15 ได้ 0, 09:16 ได้ 16 คือคืนค่าเต็มไม่ลบ grace)

- [ ] **Step 1: เขียนเทสต์ที่ยังไม่ผ่าน**

สร้าง `src/lib/attendance/manual-preview.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { LatePolicy } from './late-policy';
import { bangkokDateTime, computeManualPreview } from './manual-preview';

const POLICY: LatePolicy = { startTime: '09:00', graceMin: 15 };
const DATE = '2026-07-15';

const worked = (over: Partial<Parameters<typeof computeManualPreview>[0]> = {}) =>
  computeManualPreview({
    kind: 'worked',
    date: DATE,
    clockIn: '09:00',
    latePolicy: POLICY,
    scheduledEndTime: '18:00',
    isOffDay: false,
    ...over,
  });

const types = (r: ReturnType<typeof computeManualPreview>) => r.rows.map((x) => x.type);

describe('bangkokDateTime', () => {
  it('reads HH:MM as Bangkok local time (UTC+7)', () => {
    expect(bangkokDateTime('2026-07-15', '09:00')?.toISOString()).toBe('2026-07-15T02:00:00.000Z');
  });

  it('rejects malformed input', () => {
    expect(bangkokDateTime('15-07-2026', '09:00')).toBeNull();
    expect(bangkokDateTime('2026-07-15', '9:00')).toBeNull();
  });
});

describe('computeManualPreview — absent', () => {
  it('produces a single Absent row', () => {
    const r = computeManualPreview({
      kind: 'absent',
      date: DATE,
      latePolicy: POLICY,
      isOffDay: false,
    });
    expect(types(r)).toEqual(['Absent']);
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});

describe('computeManualPreview — lateness', () => {
  it('on time → CheckIn only', () => {
    const r = worked({ clockIn: '09:00' });
    expect(types(r)).toEqual(['CheckIn']);
    expect(r.lateMinutes).toBe(0);
  });

  it('within grace → CheckIn only', () => {
    const r = worked({ clockIn: '09:15' });
    expect(types(r)).toEqual(['CheckIn']);
    expect(r.lateMinutes).toBe(0);
  });

  it('past grace → CheckIn + Late with full minutes past start', () => {
    const r = worked({ clockIn: '09:16' });
    expect(types(r)).toEqual(['CheckIn', 'Late']);
    expect(r.lateMinutes).toBe(16);
    expect(r.rows[1].durationMinutes).toBe(16);
  });

  it('off day cancels lateness', () => {
    const r = worked({ clockIn: '09:45', isOffDay: true });
    expect(types(r)).toEqual(['CheckIn']);
    expect(r.lateMinutes).toBe(0);
  });

  it('null policy (not a scheduled workday) cancels lateness', () => {
    const r = worked({ clockIn: '09:45', latePolicy: null });
    expect(types(r)).toEqual(['CheckIn']);
    expect(r.lateMinutes).toBe(0);
  });

  it('exemptLate drops the Late row but keeps CheckIn and reports the minutes', () => {
    const r = worked({ clockIn: '09:45', exemptLate: true });
    expect(types(r)).toEqual(['CheckIn']);
    expect(r.lateMinutes).toBe(45);
  });
});

describe('computeManualPreview — clock-out', () => {
  it('leaving early does NOT create EarlyLeave unless opted in', () => {
    const r = worked({ clockOut: '16:00' });
    expect(types(r)).toEqual(['CheckIn']);
    expect(r.earlyLeaveMinutes).toBe(120);
  });

  it('recordEarlyLeave opts in to the EarlyLeave row', () => {
    const r = worked({ clockOut: '16:00', recordEarlyLeave: true });
    expect(types(r)).toEqual(['CheckIn', 'EarlyLeave']);
    expect(r.rows[1].durationMinutes).toBe(120);
  });

  it('leaving late reports OT minutes and creates no extra row', () => {
    const r = worked({ clockOut: '19:30' });
    expect(types(r)).toEqual(['CheckIn']);
    expect(r.otMinutes).toBe(90);
    expect(r.earlyLeaveMinutes).toBe(0);
  });

  it('no scheduled end time → no early-leave or OT signal', () => {
    const r = worked({ clockOut: '19:30', scheduledEndTime: null });
    expect(r.otMinutes).toBe(0);
    expect(r.earlyLeaveMinutes).toBe(0);
  });

  it('combines Late and opted-in EarlyLeave', () => {
    const r = worked({ clockIn: '09:45', clockOut: '16:00', recordEarlyLeave: true });
    expect(types(r)).toEqual(['CheckIn', 'Late', 'EarlyLeave']);
  });
});
```

- [ ] **Step 2: รันเทสต์ให้เห็นว่าไม่ผ่าน**

Run: `npx vitest run src/lib/attendance/manual-preview.test.ts`
Expected: FAIL — `Cannot find module './manual-preview'`

- [ ] **Step 3: เขียน implementation**

สร้าง `src/lib/attendance/manual-preview.ts`:

```ts
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
        warnings.push(
          `ออกก่อนเวลา ${earlyLeaveMinutes} นาที — จะหักเงินตามอัตราออกก่อนเวลาต่อครั้ง`,
        );
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
```

- [ ] **Step 4: รันเทสต์ให้ผ่าน**

Run: `npx vitest run src/lib/attendance/manual-preview.test.ts`
Expected: PASS ทุกเคส

- [ ] **Step 5: ตรวจ gates**

Run: `npx tsc --noEmit && npx biome check --write src/lib/attendance/manual-preview.ts src/lib/attendance/manual-preview.test.ts`
Expected: ไม่มี error

- [ ] **Step 6: Commit**

```bash
git add src/lib/attendance/manual-preview.ts src/lib/attendance/manual-preview.test.ts
git commit -m "feat(attendance): pure preview fn for manual entries"
```

---

### Task 2: เขียน `manual.ts` server action ใหม่

**Files:**
- Modify: `src/lib/attendance/manual.ts` (เขียนใหม่ทั้งไฟล์)
- Modify: `src/lib/attendance/manual.branch.test.ts` (ปรับ input shape)

**Interfaces:**
- Consumes: `computeManualPreview`, `bangkokDateTime`, `ManualPreviewResult` จาก Task 1; `resolveLatePolicy` / `latePolicyFrom` จาก `./late-policy`; `isClosedDay` จาก `./date`
- Produces: `CreateManualInput` (shape ใหม่) และ `createManualAttendance` ที่ Task 3 เรียกใช้

**สิ่งที่ต้องคงไว้จากของเดิม:** branch gate (`canActOnEmployeeBranches` + `notFound()`), `requirePermission('attendance.manual-create')`, ตรวจ archived, ตรวจรูปแบบวันที่, ตรวจวันอนาคต, `auditLog`, `revalidatePath`

- [ ] **Step 1: อ่านของเดิมก่อนแก้**

Run: `cat src/lib/attendance/manual.ts && cat src/lib/attendance/manual.branch.test.ts`
เพื่อรักษา gate เดิมทุกตัวไว้ครบ

- [ ] **Step 2: เขียนไฟล์ใหม่**

แทนที่ `src/lib/attendance/manual.ts` ทั้งไฟล์ โดยคงส่วน helper เดิม (`parseInputDate`, `bangkokTodayUtc`, `MAX_NOTE`) และเปลี่ยน input/logic:

```ts
'use server';

/**
 * `createManualAttendance` — admin records attendance directly for the
 * cases where the LIFF check-in couldn't happen (broken phone, dead
 * battery, no signal) or the employee didn't show up at all.
 *
 * Two shapes:
 *   - `kind: 'worked'` — employee DID work. Records a `CheckIn` row with
 *     the admin-supplied times, plus a derived `Late` row using the same
 *     policy as the LIFF path, so the outcome matches "what would have
 *     happened if the phone worked".
 *   - `kind: 'absent'` — didn't show up. Records a single `Absent` row.
 *
 * `EarlyLeave` is opt-in only — nothing else in the system derives those
 * rows, so deriving them here would make manual entry stricter than LIFF.
 *
 * `OnLeave` is still not accepted: leave approval creates those rows per
 * range, and hand-entry would duplicate what the working-days calculator
 * reads.
 *
 * Geofence integrity: manual rows carry `source='Manual'`, the admin's
 * `createdById`, and null GPS columns — structurally distinguishable from
 * a GPS-verified LIFF row. The LIFF path's geofence is untouched.
 */

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { auditLog } from '@/lib/audit/log';
import { canActOnEmployeeBranches, getPermittedBranches } from '@/lib/auth/branch-scope';
import { requirePermission } from '@/lib/auth/check-permission';
import { prisma } from '@/lib/db/prisma';
import { isClosedDay } from './date';
import { latePolicyFrom, resolveLatePolicy } from './late-policy';
import { bangkokDateTime, computeManualPreview } from './manual-preview';

export type CreateManualInput = {
  employeeId: string;
  /** YYYY-MM-DD — treated as a Bangkok-local calendar day. */
  date: string;
  kind: 'worked' | 'absent';
  /** HH:MM — required when kind==='worked'. */
  clockIn?: string | null;
  /** HH:MM — optional. */
  clockOut?: string | null;
  exemptLate?: boolean;
  /** Why the late deduction was waived — required when exemptLate. */
  exemptReason?: string | null;
  recordEarlyLeave?: boolean;
  /** Free-form note explaining why this manual entry exists. ≤500 chars. */
  note?: string | null;
};

export type CreateManualResult =
  | { ok: true; ids: string[] }
  | {
      ok: false;
      code:
        | 'forbidden'
        | 'employee-not-found'
        | 'employee-archived'
        | 'bad-date'
        | 'future-date'
        | 'bad-time'
        | 'missing-exempt-reason'
        | 'already-checked-in'
        | 'duplicate'
        | 'db-error';
      message: string;
    };

const MAX_NOTE = 500;

/** Parse YYYY-MM-DD as UTC-midnight Date (matches @db.Date semantics). */
function parseInputDate(raw: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const d = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return null;
  if (d.toISOString().slice(0, 10) !== raw) return null;
  return d;
}

/** Today at UTC midnight, in Asia/Bangkok terms. */
function bangkokTodayUtc(): Date {
  const ymd = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' });
  return new Date(`${ymd}T00:00:00.000Z`);
}

export async function createManualAttendance(
  input: CreateManualInput,
): Promise<CreateManualResult> {
  const emp = await prisma.employee.findUnique({
    where: { id: input.employeeId },
    select: {
      id: true,
      archivedAt: true,
      status: true,
      branchId: true,
      assignedBranchIds: true,
      workSchedule: {
        select: {
          lateToleranceMin: true,
          days: { select: { dayOfWeek: true, startTime: true, endTime: true } },
        },
      },
    },
  });
  if (!emp) {
    return { ok: false, code: 'employee-not-found', message: 'ไม่พบพนักงาน' };
  }

  const { user } = await requirePermission('attendance.manual-create');
  const permitted = await getPermittedBranches(user, 'attendance.manual-create');
  if (!canActOnEmployeeBranches(permitted, [emp.branchId, ...emp.assignedBranchIds])) notFound();

  if (emp.archivedAt || emp.status === 'Archived') {
    return { ok: false, code: 'employee-archived', message: 'พนักงานคนนี้พ้นสภาพแล้ว' };
  }

  const date = parseInputDate(input.date);
  if (!date) {
    return { ok: false, code: 'bad-date', message: 'รูปแบบวันที่ไม่ถูกต้อง' };
  }
  if (date.getTime() > bangkokTodayUtc().getTime()) {
    return { ok: false, code: 'future-date', message: 'ไม่สามารถบันทึกล่วงหน้าได้' };
  }

  // ── Time validation (worked only) ──────────────────────────────────
  if (input.kind === 'worked') {
    if (!input.clockIn || !bangkokDateTime(input.date, input.clockIn)) {
      return { ok: false, code: 'bad-time', message: 'กรุณากรอกเวลาเข้างานให้ถูกต้อง (HH:MM)' };
    }
    if (input.clockOut) {
      if (!bangkokDateTime(input.date, input.clockOut)) {
        return { ok: false, code: 'bad-time', message: 'รูปแบบเวลาออกงานไม่ถูกต้อง (HH:MM)' };
      }
      if (input.clockOut <= input.clockIn) {
        return {
          ok: false,
          code: 'bad-time',
          message: 'เวลาออกงานต้องหลังเวลาเข้างาน',
        };
      }
    }
  }

  if (input.exemptLate && !input.exemptReason?.trim()) {
    return {
      ok: false,
      code: 'missing-exempt-reason',
      message: 'กรุณาระบุเหตุผลที่ยกเว้นการหักมาสาย',
    };
  }

  const note = input.note?.trim() || null;
  if (note && note.length > MAX_NOTE) {
    return { ok: false, code: 'bad-date', message: `หมายเหตุยาวเกิน ${MAX_NOTE} ตัวอักษร` };
  }

  // ── Resolve the late policy exactly as check-in.ts does ────────────
  const dow = date.getUTCDay();
  const scheduleDays = emp.workSchedule?.days ?? null;
  const hasSchedule = !!scheduleDays && scheduleDays.length > 0;

  const [payrollCfg, holiday] = await Promise.all([
    prisma.payrollConfig.findFirst({ select: { workStartTime: true, lateGraceMinutes: true } }),
    prisma.holiday.findFirst({ where: { date, archivedAt: null }, select: { id: true } }),
  ]);
  const hasHoliday = holiday != null;

  const latePolicy = resolveLatePolicy(
    scheduleDays,
    emp.workSchedule?.lateToleranceMin ?? null,
    dow,
    latePolicyFrom(payrollCfg),
  );
  const isOffDay = hasSchedule ? hasHoliday : isClosedDay(date, hasHoliday);
  const scheduledEndTime = scheduleDays?.find((d) => d.dayOfWeek === dow)?.endTime ?? null;

  const preview = computeManualPreview({
    kind: input.kind,
    date: input.date,
    clockIn: input.clockIn,
    clockOut: input.clockOut,
    latePolicy,
    scheduledEndTime,
    isOffDay,
    exemptLate: input.exemptLate,
    recordEarlyLeave: input.recordEarlyLeave,
  });

  // ── Duplicate guards ───────────────────────────────────────────────
  // A pre-existing CheckIn means the employee already checked in (LIFF or
  // an earlier manual entry) — never stack a second one on top.
  if (preview.rows.some((r) => r.type === 'CheckIn')) {
    const existingCheckIn = await prisma.attendance.findFirst({
      where: { employeeId: emp.id, date, type: 'CheckIn', deletedAt: null },
      select: { id: true },
    });
    if (existingCheckIn) {
      return {
        ok: false,
        code: 'already-checked-in',
        message: 'พนักงานคนนี้มีการเช็คอินของวันนี้อยู่แล้ว',
      };
    }
  }

  const existingSame = await prisma.attendance.findFirst({
    where: {
      employeeId: emp.id,
      date,
      type: { in: preview.rows.map((r) => r.type) },
      deletedAt: null,
    },
    select: { type: true },
  });
  if (existingSame) {
    return {
      ok: false,
      code: 'duplicate',
      message: `มีรายการ "${existingSame.type}" ของพนักงานคนนี้ในวันนี้แล้ว`,
    };
  }

  const clockInAt = input.clockIn ? bangkokDateTime(input.date, input.clockIn) : null;
  const clockOutAt = input.clockOut ? bangkokDateTime(input.date, input.clockOut) : null;

  const headerList = await headers();
  const ip =
    headerList.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    headerList.get('x-real-ip') ??
    undefined;
  const userAgent = headerList.get('user-agent') ?? undefined;

  try {
    const created = await prisma.$transaction(async (tx) =>
      Promise.all(
        preview.rows.map((row) =>
          tx.attendance.create({
            data: {
              employeeId: emp.id,
              date,
              type: row.type,
              source: 'Manual',
              durationMinutes: row.durationMinutes,
              // Times live on the CheckIn row only; derived Late/EarlyLeave
              // rows are the deduction unit and carry no clock evidence,
              // matching how check-in.ts writes its derived Late row.
              clockInAt: row.type === 'CheckIn' ? clockInAt : null,
              clockOutAt: row.type === 'CheckIn' ? clockOutAt : null,
              createdById: user.id,
            },
            select: { id: true, type: true },
          }),
        ),
      ),
    );

    for (const row of created) {
      auditLog({
        actorId: user.id,
        action: 'attendance.manual-create',
        entityType: 'Attendance',
        entityId: row.id,
        after: {
          employeeId: emp.id,
          date: input.date,
          kind: input.kind,
          type: row.type,
          clockIn: input.clockIn ?? null,
          clockOut: input.clockOut ?? null,
          lateMinutes: preview.lateMinutes,
          exemptLate: !!input.exemptLate,
          exemptReason: input.exemptReason?.trim() || null,
          note,
        },
        metadata: { ip, userAgent, source: 'admin-manual' },
      });
    }

    revalidatePath('/admin');
    revalidatePath('/admin/attendance');
    return { ok: true, ids: created.map((c) => c.id) };
  } catch (err) {
    console.error('[createManualAttendance] db error', err);
    return { ok: false, code: 'db-error', message: 'ระบบขัดข้อง กรุณาลองใหม่อีกครั้ง' };
  }
}
```

- [ ] **Step 3: ปรับเทสต์เดิมให้ใช้ input shape ใหม่**

ใน `src/lib/attendance/manual.branch.test.ts` เปลี่ยนทุกจุดที่ส่ง `type: 'Absent'` เป็น `kind: 'absent'` และที่ส่ง `type: 'Late', durationMinutes: N` เป็น `kind: 'worked', clockIn: 'HH:MM'` โดยรักษาเจตนาเดิมของแต่ละเคส (การทดสอบ branch scope) ไว้ทั้งหมด — อย่าลบเคสใด

- [ ] **Step 4: รันเทสต์**

Run: `npx vitest run src/lib/attendance/`
Expected: PASS ทั้งหมด

- [ ] **Step 5: ตรวจ gates**

Run: `npx tsc --noEmit && npx biome check --write src/lib/attendance/manual.ts src/lib/attendance/manual.branch.test.ts`
Expected: ไม่มี error

- [ ] **Step 6: Commit**

```bash
git add src/lib/attendance/manual.ts src/lib/attendance/manual.branch.test.ts
git commit -m "feat(attendance): manual action records worked days with derived lateness"
```

---

### Task 3: UI — page + form พร้อมแผงเตือนสด

**Files:**
- Modify: `src/app/(admin)/admin/attendance/manual/page.tsx`
- Modify: `src/app/(admin)/admin/attendance/manual/manual-form.tsx` (เขียนใหม่)

**Interfaces:**
- Consumes: `createManualAttendance` + `CreateManualInput` จาก Task 2; `computeManualPreview` + `bangkokDateTime` จาก Task 1; `resolveLatePolicy` / `latePolicyFrom` จาก `./late-policy`
- Produces: หน้าเว็บที่ใช้งานได้จริง (ไม่มี task อื่นเรียกใช้ต่อ)

**หลักการสำคัญ:** client **ต้อง** เรียก `computeManualPreview` ตัวเดียวกับ server ห้ามเขียนตรรกะพรีวิวขึ้นใหม่ — ถ้าพรีวิวคำนวณเองแยก มันจะโกหกเรื่องการหักเงินได้

- [ ] **Step 1: แก้ `page.tsx` ให้โหลดและส่งข้อมูลที่ฟอร์มต้องใช้**

เปลี่ยน docblock บนสุดให้ตรงความจริงใหม่ เปลี่ยน `PageHeader` และส่ง props เพิ่ม:

```tsx
      <PageHeader
        breadcrumb="ลงเวลา"
        title="คีย์มือ — บันทึกเวลาทำงาน"
        subtitle="ใช้เมื่อพนักงานเช็คอินด้วย LINE ไม่ได้ — เช่น โทรศัพท์พัง แบตหมด เน็ตล่ม หรือขาดงาน"
      />
```

ขยาย query พนักงานให้ดึงตารางงาน และโหลด config + วันหยุดเพิ่ม:

```tsx
  const [employees, payrollCfg, holidays] = await Promise.all([
    prisma.employee.findMany({
      where: {
        archivedAt: null,
        status: { not: 'Archived' },
        ...employeeBranchScope(permitted),
      },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
      select: {
        id: true,
        firstName: true,
        lastName: true,
        nickname: true,
        branch: { select: { name: true } },
        workSchedule: {
          select: {
            lateToleranceMin: true,
            days: { select: { dayOfWeek: true, startTime: true, endTime: true } },
          },
        },
      },
    }),
    prisma.payrollConfig.findFirst({
      select: {
        workStartTime: true,
        lateGraceMinutes: true,
        absentDeductionPerDay: true,
        earlyLeaveDeduction: true,
      },
    }),
    prisma.holiday.findMany({ where: { archivedAt: null }, select: { date: true } }),
  ]);
```

ส่งลง `<ManualAttendanceForm>`:

```tsx
            <ManualAttendanceForm
              employees={employees.map((e) => ({
                id: e.id,
                label:
                  `${e.firstName} ${e.lastName}${e.nickname ? ` (${e.nickname})` : ''} — ${e.branch.name}`.trim(),
                lateToleranceMin: e.workSchedule?.lateToleranceMin ?? null,
                scheduleDays:
                  e.workSchedule?.days.map((d) => ({
                    dayOfWeek: d.dayOfWeek,
                    startTime: d.startTime,
                    endTime: d.endTime,
                  })) ?? null,
              }))}
              companyPolicy={{
                workStartTime: payrollCfg?.workStartTime ?? null,
                lateGraceMinutes: payrollCfg?.lateGraceMinutes ?? null,
              }}
              rates={{
                absentPerDay: payrollCfg?.absentDeductionPerDay?.toString() ?? '0',
                earlyLeave: payrollCfg?.earlyLeaveDeduction?.toString() ?? '0',
              }}
              holidayYmds={holidays.map((h) => h.date.toISOString().slice(0, 10))}
            />
```

- [ ] **Step 2: เขียน `manual-form.tsx` ใหม่**

แทนที่ทั้งไฟล์:

```tsx
'use client';

/**
 * Manual attendance entry form.
 *
 * Structured as "did they work?" rather than "which anomaly was it?",
 * because CheckIn and Late are separate rows that legitimately co-occur —
 * the old three mutually-exclusive buttons had no way to say "worked, but
 * couldn't tap the phone", which pushed admins toward ขาดงาน and deducted
 * pay from people who had worked a full day.
 *
 * The live preview panel calls `computeManualPreview` — the exact function
 * the server action uses — so what the admin is shown is what gets saved.
 */

import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { DateField } from '@/components/ui/date-field';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { type CreateManualResult, createManualAttendance } from '@/lib/attendance/manual';
import { latePolicyFrom, resolveLatePolicy } from '@/lib/attendance/late-policy';
import { computeManualPreview } from '@/lib/attendance/manual-preview';

type ScheduleDay = { dayOfWeek: number; startTime: string; endTime: string };

type EmployeeOption = {
  id: string;
  label: string;
  lateToleranceMin: number | null;
  scheduleDays: ScheduleDay[] | null;
};

type Props = {
  employees: EmployeeOption[];
  companyPolicy: { workStartTime: string | null; lateGraceMinutes: number | null };
  rates: { absentPerDay: string; earlyLeave: string };
  holidayYmds: string[];
};

const baht = (v: string) => `฿${Number(v).toLocaleString()}`;

export function ManualAttendanceForm({ employees, companyPolicy, rates, holidayYmds }: Props) {
  const router = useRouter();

  const today = useMemo(
    () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' }),
    [],
  );

  const [employeeId, setEmployeeId] = useState('');
  const [date, setDate] = useState(today);
  const [kind, setKind] = useState<'worked' | 'absent'>('worked');
  const [clockIn, setClockIn] = useState('');
  const [clockOut, setClockOut] = useState('');
  const [exemptLate, setExemptLate] = useState(false);
  const [exemptReason, setExemptReason] = useState('');
  const [recordEarlyLeave, setRecordEarlyLeave] = useState(false);
  const [note, setNote] = useState('');

  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const employee = employees.find((e) => e.id === employeeId) ?? null;

  // Resolve the same way the server does, then preview with the same fn.
  const preview = useMemo(() => {
    if (kind === 'absent') {
      return computeManualPreview({ kind: 'absent', date, latePolicy: null, isOffDay: false });
    }
    if (!clockIn) return null;

    const dow = new Date(`${date}T00:00:00.000Z`).getUTCDay();
    const scheduleDays = employee?.scheduleDays ?? null;
    const latePolicy = resolveLatePolicy(
      scheduleDays,
      employee?.lateToleranceMin ?? null,
      dow,
      latePolicyFrom({
        workStartTime: companyPolicy.workStartTime,
        lateGraceMinutes: companyPolicy.lateGraceMinutes,
      }),
    );
    return computeManualPreview({
      kind: 'worked',
      date,
      clockIn,
      clockOut: clockOut || null,
      latePolicy,
      scheduledEndTime: scheduleDays?.find((d) => d.dayOfWeek === dow)?.endTime ?? null,
      isOffDay: holidayYmds.includes(date),
      exemptLate,
      recordEarlyLeave,
    });
  }, [
    kind,
    date,
    clockIn,
    clockOut,
    employee,
    companyPolicy,
    holidayYmds,
    exemptLate,
    recordEarlyLeave,
  ]);

  const showEarlyLeaveOptIn = (preview?.earlyLeaveMinutes ?? 0) > 0;
  const showExemptOptIn = (preview?.lateMinutes ?? 0) > 0;

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    if (!employeeId) {
      setError('กรุณาเลือกพนักงาน');
      return;
    }
    if (kind === 'worked' && !clockIn) {
      setError('กรุณากรอกเวลาเข้างาน');
      return;
    }

    startTransition(async () => {
      const result: CreateManualResult = await createManualAttendance({
        employeeId,
        date,
        kind,
        clockIn: kind === 'worked' ? clockIn : null,
        clockOut: kind === 'worked' && clockOut ? clockOut : null,
        exemptLate: showExemptOptIn ? exemptLate : false,
        exemptReason: exemptLate ? exemptReason : null,
        recordEarlyLeave: showEarlyLeaveOptIn ? recordEarlyLeave : false,
        note,
      });

      if (result.ok) {
        router.push('/admin');
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
          name="employeeId"
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

      <FormField label="วันที่" htmlFor="date" required>
        <DateField
          id="date"
          name="date"
          required
          value={date}
          onChange={(iso) => setDate(iso ?? '')}
          max={today}
        />
      </FormField>

      <FormField label="วันนั้นมาทำงานหรือไม่" htmlFor="kind" required>
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              ['worked', 'มาทำงาน'],
              ['absent', 'ไม่มา (ขาดงาน)'],
            ] as const
          ).map(([value, label]) => (
            <label
              key={value}
              className={`flex cursor-pointer items-center justify-center rounded-md border px-3 py-2 text-sm font-medium transition ${
                kind === value
                  ? 'border-primary-500 bg-primary-50 text-primary-700'
                  : 'border-gray-200 bg-white text-gray-700 hover:border-primary-200'
              }`}
            >
              <input
                type="radio"
                name="kind"
                value={value}
                checked={kind === value}
                onChange={() => setKind(value)}
                className="sr-only"
              />
              {label}
            </label>
          ))}
        </div>
      </FormField>

      {kind === 'worked' ? (
        <div className="grid grid-cols-2 gap-3">
          <FormField label="เวลาเข้างาน" htmlFor="clockIn" required>
            <Input
              id="clockIn"
              name="clockIn"
              type="time"
              value={clockIn}
              onChange={(e) => setClockIn(e.target.value)}
              required
            />
          </FormField>
          <FormField label="เวลาออกงาน" htmlFor="clockOut" hint="ถ้ายังไม่ออก เว้นว่างได้">
            <Input
              id="clockOut"
              name="clockOut"
              type="time"
              value={clockOut}
              onChange={(e) => setClockOut(e.target.value)}
            />
          </FormField>
        </div>
      ) : (
        <p className="rounded-md bg-gray-50 px-3 py-2 text-sm text-ink-3">
          ถ้าเป็นการลาที่ได้รับอนุมัติ ให้บันทึกผ่านหน้าคำขอลาแทน — ระบบจะสร้างรายการให้เอง
        </p>
      )}

      {preview && preview.warnings.length > 0 && (
        <div className="space-y-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-3">
          {preview.warnings.map((w) => (
            <p key={w} className="text-sm text-amber-900">
              {w}
            </p>
          ))}
          <p className="pt-1 text-sm font-medium text-ink-1">
            จะบันทึก:{' '}
            {preview.rows
              .map((r) =>
                r.type === 'CheckIn'
                  ? `มาทำงาน${clockIn ? ` ${clockIn}` : ''}${clockOut ? `–${clockOut}` : ''}`
                  : r.type === 'Late'
                    ? `มาสาย ${r.durationMinutes} นาที`
                    : r.type === 'EarlyLeave'
                      ? `ออกก่อนเวลา ${r.durationMinutes} นาที (${baht(rates.earlyLeave)})`
                      : `ขาดงาน (${baht(rates.absentPerDay)})`,
              )
              .join(' + ')}
          </p>
        </div>
      )}

      {showExemptOptIn && (
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm text-ink-1">
            <input
              type="checkbox"
              checked={exemptLate}
              onChange={(e) => setExemptLate(e.target.checked)}
              className="rounded border-gray-300"
            />
            ยกเว้นการหักมาสายครั้งนี้
          </label>
          {exemptLate && (
            <FormField label="เหตุผลที่ยกเว้น" htmlFor="exemptReason" required>
              <Input
                id="exemptReason"
                name="exemptReason"
                value={exemptReason}
                onChange={(e) => setExemptReason(e.target.value)}
                placeholder="เช่น รถติดเพราะน้ำท่วม"
                required
              />
            </FormField>
          )}
        </div>
      )}

      {showEarlyLeaveOptIn && (
        <label className="flex items-center gap-2 text-sm text-ink-1">
          <input
            type="checkbox"
            checked={recordEarlyLeave}
            onChange={(e) => setRecordEarlyLeave(e.target.checked)}
            className="rounded border-gray-300"
          />
          บันทึกเป็น "ออกก่อนเวลา" ด้วย (หัก {baht(rates.earlyLeave)})
        </label>
      )}

      <FormField label="หมายเหตุ" htmlFor="note" hint="เหตุผลที่ต้องบันทึกด้วยตนเอง (ถ้ามี)">
        <textarea
          id="note"
          name="note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          maxLength={500}
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          placeholder="เช่น โทรศัพท์พนักงานเสีย — ยืนยันกับหัวหน้าสาขาแล้ว"
        />
      </FormField>

      {error && (
        <div role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="flex items-center justify-end gap-3 pt-2">
        <Button type="button" variant="ghost" onClick={() => router.back()}>
          ยกเลิก
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? 'กำลังบันทึก...' : 'บันทึก'}
        </Button>
      </div>
    </form>
  );
}
```

- [ ] **Step 3: ตรวจ gates**

Run: `npx tsc --noEmit && npx biome check --write "src/app/(admin)/admin/attendance/manual/"`
Expected: ไม่มี error

- [ ] **Step 4: รันชุดทดสอบทั้งหมด**

Run: `pnpm test`
Expected: PASS ทั้งหมด (ไม่มี regression)

- [ ] **Step 5: Commit**

```bash
git add "src/app/(admin)/admin/attendance/manual/page.tsx" "src/app/(admin)/admin/attendance/manual/manual-form.tsx"
git commit -m "feat(attendance): restructure manual form to worked/absent with live preview"
```

---

## Verification (หลังครบทุก task)

- [ ] `pnpm test` ผ่านทั้งหมด
- [ ] `npx tsc --noEmit` และ `npx biome check` สะอาด
- [ ] Browser smoke ที่ `/admin/attendance/manual`:
  - เลือกพนักงาน + "มาทำงาน" + เวลาเข้า `09:45` → เห็นแผงเตือนบอกว่าจะบันทึก "มาสาย 45 นาที"
  - ติ๊ก "ยกเว้นการหัก" → แผงเปลี่ยนเป็นบอกว่ายกเว้น และ "จะบันทึก" เหลือแค่ "มาทำงาน"
  - กรอกเวลาออก `19:30` → เห็นข้อความว่าจะขึ้นเป็นผู้เข้าข่าย OT
  - กรอกเวลาออกก่อนเวลาเลิกงาน → เห็น checkbox "บันทึกเป็นออกก่อนเวลา" (ไม่ติ๊กอัตโนมัติ)
  - บันทึกจริง → ตรวจว่าพนักงานหลุดจากรายการ "ยังไม่เช็คอิน" และขึ้นในประวัติ
  - บันทึกซ้ำวันเดิม → ได้ข้อความ "มีการเช็คอินของวันนี้อยู่แล้ว"
