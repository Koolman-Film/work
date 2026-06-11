import { z } from 'zod';

/**
 * Form schema for PayrollAdjustment (เงินเพิ่ม/เงินลด).
 *
 * The UI exposes three frequency choices; storage is two month fields
 * (see prisma/schema.prisma PayrollAdjustment doc-comment):
 *   once    → endMonth = startMonth
 *   monthly → endMonth = null (open-ended)
 *   range   → both, validated startMonth <= endMonth
 */

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

const Schema = z
  .object({
    employeeId: z.string().uuid('กรุณาเลือกพนักงาน'),
    kind: z.enum(['Income', 'Deduction'], { message: 'กรุณาเลือกประเภท' }),
    reason: z.string().trim().min(1, 'กรุณากรอกรายการ').max(200),
    amount: z
      .string()
      .trim()
      .regex(/^\d+(\.\d{1,2})?$/, 'จำนวนเงินไม่ถูกต้อง (เช่น 1500 หรือ 1500.50)')
      .refine((v) => Number(v) > 0, 'จำนวนเงินต้องมากกว่า 0'),
    frequency: z.enum(['once', 'monthly', 'range'], { message: 'กรุณาเลือกความถี่' }),
    startMonth: z.string().regex(MONTH_RE, 'รูปแบบเดือนไม่ถูกต้อง'),
    endMonth: z
      .string()
      .regex(MONTH_RE, 'รูปแบบเดือนสิ้นสุดไม่ถูกต้อง')
      .optional()
      .or(z.literal('').transform(() => undefined)),
    note: z
      .string()
      .trim()
      .max(500)
      .optional()
      .or(z.literal('').transform(() => undefined)),
  })
  .superRefine((data, ctx) => {
    if (data.frequency === 'range') {
      if (!data.endMonth) {
        ctx.addIssue({ code: 'custom', path: ['endMonth'], message: 'กรุณาเลือกเดือนสิ้นสุด' });
      } else if (data.endMonth < data.startMonth) {
        ctx.addIssue({
          code: 'custom',
          path: ['endMonth'],
          message: 'เดือนสิ้นสุดต้องไม่ก่อนเดือนเริ่มต้น',
        });
      }
    }
  });

export type AdjustmentFormData = {
  employeeId: string;
  kind: 'Income' | 'Deduction';
  reason: string;
  amount: string;
  startMonth: string;
  endMonth: string | null;
  note: string | null;
};

/** Map the validated 3-way frequency onto the 2-field storage shape. */
function toStorage(parsed: z.infer<typeof Schema>): AdjustmentFormData {
  const endMonth =
    parsed.frequency === 'once'
      ? parsed.startMonth
      : parsed.frequency === 'monthly'
        ? null
        : (parsed.endMonth as string);
  return {
    employeeId: parsed.employeeId,
    kind: parsed.kind,
    reason: parsed.reason,
    amount: parsed.amount,
    startMonth: parsed.startMonth,
    endMonth,
    note: parsed.note ?? null,
  };
}

export type ReadFormResult =
  | { success: true; data: AdjustmentFormData }
  | { success: false; error: string };

export function readForm(formData: FormData): ReadFormResult {
  const parsed = Schema.safeParse({
    employeeId: formData.get('employeeId'),
    kind: formData.get('kind'),
    reason: formData.get('reason'),
    amount: formData.get('amount'),
    frequency: formData.get('frequency'),
    startMonth: formData.get('startMonth'),
    endMonth: formData.get('endMonth') ?? undefined,
    note: formData.get('note') ?? undefined,
  });
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? 'ข้อมูลไม่ถูกต้อง' };
  }
  return { success: true, data: toStorage(parsed.data) };
}

/** Derive the UI frequency choice back from the stored month window. */
export function frequencyOf(
  startMonth: string,
  endMonth: string | null,
): 'once' | 'monthly' | 'range' {
  if (endMonth === null) return 'monthly';
  if (endMonth === startMonth) return 'once';
  return 'range';
}
