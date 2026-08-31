/**
 * Employee create/edit form parsing — shared, framework-agnostic Zod
 * schema + FormData reader. Lives outside actions.ts (which is
 * 'use server' and may only export async functions) so it can be unit
 * tested directly.
 *
 * All profile-extra fields (photoKey, dateOfBirth, bank*) are optional and
 * clearable: a blank form value parses to null, which the actions persist
 * as a NULL column — that is the "delete a field" path of add/edit/delete.
 */

import { z } from 'zod';
import { normalizeBankAccountNumber } from '@/lib/employee/bank';
import { isValidThaiNationalId } from '@/lib/tax/national-id';

export const EmployeeSchema = z
  .object({
    firstName: z.string().trim().min(1, 'กรุณากรอกชื่อจริง').max(80),
    lastName: z.string().trim().min(1, 'กรุณากรอกนามสกุล').max(80),
    nickname: z
      .string()
      .trim()
      .max(40)
      .optional()
      .transform((s) => (s ? s : null)),

    branchId: z.string().guid('กรุณาเลือกสาขาหลัก'),
    assignedBranchIds: z.array(z.string().guid()).default([]),

    departmentId: z
      .string()
      .optional()
      .transform((s) => (s && s !== '' ? s : null))
      .pipe(z.string().guid().nullable()),
    accountingGroupId: z
      .string()
      .optional()
      .transform((s) => (s && s !== '' ? s : null))
      .pipe(z.string().guid().nullable()),
    workScheduleId: z
      .string()
      .optional()
      .transform((s) => (s && s !== '' ? s : null))
      .pipe(z.string().guid().nullable()),

    salaryType: z.enum(['Monthly', 'Daily', 'Hourly']),
    baseSalary: z
      .string()
      .transform((s) => {
        const n = Number(s);
        return Number.isFinite(n) && n >= 0 ? n : NaN;
      })
      .refine((n) => Number.isFinite(n), 'เงินเดือนพื้นฐานต้องเป็นตัวเลข'),

    status: z.enum(['Probation', 'Active', 'Archived']),
    canCheckIn: z
      .string()
      .optional()
      .transform((s) => s === 'on'),
    hasSso: z
      .string()
      .optional()
      .transform((s) => s === 'on'),

    hiredAt: z
      .string()
      .min(1, 'กรุณาเลือกวันเริ่มงาน')
      .transform((s) => new Date(s))
      .refine((d) => !Number.isNaN(d.getTime()), 'วันที่ไม่ถูกต้อง'),

    // ─── Profile extras (all optional + clearable) ──────────────────────────
    photoKey: z
      .string()
      .optional()
      .transform((s) => (s && s !== '' ? s : null)),

    dateOfBirth: z
      .string()
      .optional()
      .transform((s) => (s && s.trim() !== '' ? new Date(s) : null))
      .refine((d) => d === null || !Number.isNaN(d.getTime()), 'วันเกิดไม่ถูกต้อง'),

    bankId: z
      .string()
      .optional()
      .transform((s) => (s && s !== '' ? s : null))
      .pipe(z.string().guid().nullable()),
    bankAccountNumber: z
      .string()
      .optional()
      .transform((s) => normalizeBankAccountNumber(s ?? null))
      .refine(
        (v) => v === null || (/^\d+$/.test(v) && v.length >= 8 && v.length <= 15),
        'เลขที่บัญชีต้องเป็นตัวเลข 8–15 หลัก',
      ),
    bankAccountName: z
      .string()
      .trim()
      .max(120)
      .optional()
      .transform((s) => (s ? s : null)),

    nationalId: z
      .string()
      .optional()
      .transform((s) => {
        const t = (s ?? '').replace(/\D/g, '');
        return t.length > 0 ? t : null;
      })
      .refine((v) => v === null || isValidThaiNationalId(v), 'เลขประจำตัวประชาชนไม่ถูกต้อง (13 หลัก)'),

    // ─── Default OT rate (all optional + clearable) ─────────────────────────
    defaultOtRateType: z
      .string()
      .optional()
      .transform((s) => (s === 'PerHourAmount' || s === 'Multiplier' ? s : null)),
    defaultOtRatePerHour: z
      .string()
      .optional()
      .transform((s) => (s && s.trim() !== '' ? Number(s) : null))
      .refine((n) => n === null || (Number.isFinite(n) && n >= 0), 'เรท OT ต้องเป็นตัวเลขไม่ติดลบ'),
    defaultOtMultiplier: z
      .string()
      .optional()
      .transform((s) => (s && s.trim() !== '' ? Number(s) : null))
      .refine(
        (n) => n === null || (Number.isFinite(n) && n >= 0 && n <= 9.99),
        'ตัวคูณ OT ต้องอยู่ระหว่าง 0–9.99',
      ),

    /** Nameable recurring extra pay — "เงินประจำตำแหน่ง" and the like. Empty
     *  label + 0 amount means "no allowance"; see the cross-field check below. */
    allowanceLabel: z
      .string()
      .optional()
      .transform((s) => {
        const v = (s ?? '').trim();
        return v === '' ? null : v;
      })
      .pipe(z.string().max(60, 'ชื่อเงินพิเศษต้องไม่เกิน 60 ตัวอักษร').nullable()),
    allowanceAmount: z
      .string()
      .optional()
      .transform((s) => {
        const raw = (s ?? '').trim();
        if (raw === '') return 0;
        const n = Number(raw);
        return Number.isFinite(n) && n >= 0 ? n : Number.NaN;
      })
      .refine((n) => Number.isFinite(n), 'เงินพิเศษต้องเป็นตัวเลขที่ไม่ติดลบ')
      .refine((n) => n <= 9_999_999.99, 'เงินพิเศษสูงเกินไป'),
  })
  // An amount with no label renders as an unnamed line on the payslip, which is
  // exactly the "why is there ฿27,450 of income here?" problem this feature was
  // built to replace. A label with no amount is harmless but almost certainly a
  // half-finished edit, so it is rejected too rather than silently discarded.
  .superRefine((v, ctx) => {
    if (v.allowanceAmount > 0 && v.allowanceLabel === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['allowanceLabel'],
        message: 'กรุณาตั้งชื่อเงินพิเศษ (เช่น เงินประจำตำแหน่ง)',
      });
    }
    if (v.allowanceAmount === 0 && v.allowanceLabel !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['allowanceAmount'],
        message: 'กรุณาระบุจำนวนเงินพิเศษ หรือลบชื่อออก',
      });
    }
  });

export type EmployeeInput = z.infer<typeof EmployeeSchema>;

/**
 * Create-only requirement: a brand-new employee must have a WorkSchedule so
 * they aren't silently defaulted to "works Mon–Sat" (see
 * src/lib/employee/no-schedule.ts). Edit mode must still accept a null
 * workScheduleId (an existing employee may legitimately have none yet), so
 * this check is NOT part of `EmployeeSchema` itself — it is called only from
 * the create-employee server action, after `readForm` has already parsed.
 */
export function validateWorkScheduleRequiredForCreate(
  workScheduleId: string | null,
): string | null {
  return workScheduleId == null ? 'กรุณาเลือกตารางงาน' : null;
}

/** Read a string field; returns the value or empty string when absent. */
function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? '');
}

export function readForm(formData: FormData) {
  // Multi-value field: getAll returns all entries with the same name.
  const assignedBranchIds = formData.getAll('assignedBranchIds').map(String).filter(Boolean);
  return EmployeeSchema.safeParse({
    firstName: str(formData, 'firstName'),
    lastName: str(formData, 'lastName'),
    nickname: str(formData, 'nickname'),
    branchId: str(formData, 'branchId'),
    assignedBranchIds,
    departmentId: str(formData, 'departmentId'),
    accountingGroupId: str(formData, 'accountingGroupId'),
    workScheduleId: str(formData, 'workScheduleId'),
    salaryType: str(formData, 'salaryType'),
    baseSalary: str(formData, 'baseSalary'),
    allowanceLabel: str(formData, 'allowanceLabel'),
    allowanceAmount: str(formData, 'allowanceAmount'),
    status: str(formData, 'status'),
    canCheckIn: str(formData, 'canCheckIn'),
    hasSso: str(formData, 'hasSso'),
    hiredAt: str(formData, 'hiredAt'),
    photoKey: str(formData, 'photoKey'),
    dateOfBirth: str(formData, 'dateOfBirth'),
    bankId: str(formData, 'bankId'),
    bankAccountNumber: str(formData, 'bankAccountNumber'),
    bankAccountName: str(formData, 'bankAccountName'),
    nationalId: str(formData, 'nationalId'),
    defaultOtRateType: str(formData, 'defaultOtRateType'),
    defaultOtRatePerHour: str(formData, 'defaultOtRatePerHour'),
    defaultOtMultiplier: str(formData, 'defaultOtMultiplier'),
  });
}
