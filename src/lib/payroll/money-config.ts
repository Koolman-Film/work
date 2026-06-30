import { Prisma } from '@prisma/client';
import { z } from 'zod';

/**
 * Validation + conversion for the Payroll money-config form.
 *
 * Lives outside the `'use server'` action module because a server-action
 * file may only export async functions — this pure schema/converter must
 * be importable by both the action and its unit tests.
 *
 * Money is validated as a numeric string and persisted via `Prisma.Decimal`
 * built from that string, so values never round-trip through a JS float.
 */

const MONEY_MAX = 9_999_999.99;

/** A non-negative money string with up to 2 decimal places, within [min, max]. */
function money(label: string, min: number) {
  return z
    .string()
    .trim()
    .refine((s) => /^\d+(\.\d{1,2})?$/.test(s), `${label}: ต้องเป็นตัวเลข (ทศนิยมไม่เกิน 2 ตำแหน่ง)`)
    .refine((s) => {
      const n = Number(s);
      return n >= min && n <= MONEY_MAX;
    }, `${label}: ต้องอยู่ระหว่าง ${min.toLocaleString()}–${MONEY_MAX.toLocaleString()}`);
}

export const payrollMoneySchema = z.object({
  // SSO. Rate entered as a percent (0–100, ≤2 dp); stored as a /100 fraction.
  ssoRatePercent: z
    .string()
    .trim()
    .refine((s) => /^\d+(\.\d{1,2})?$/.test(s), 'อัตราประกันสังคม: ต้องเป็นตัวเลข (ทศนิยมไม่เกิน 2 ตำแหน่ง)')
    .refine((s) => {
      const n = Number(s);
      return n >= 0 && n <= 100;
    }, 'อัตราประกันสังคม: ต้องอยู่ระหว่าง 0–100%'),
  ssoSalaryCap: money('เพดานเงินเดือน (ประกันสังคม)', 0.01),
  ssoAmountCap: money('เพดานเงินสมทบ (ประกันสังคม)', 0.01),
  // OT.
  otMultiplier: z
    .string()
    .trim()
    .refine((s) => /^\d+(\.\d{1,2})?$/.test(s), 'ตัวคูณ OT: ต้องเป็นตัวเลข (ทศนิยมไม่เกิน 2 ตำแหน่ง)')
    .refine((s) => {
      const n = Number(s);
      return n >= 1 && n <= 9.99;
    }, 'ตัวคูณ OT: ต้องอยู่ระหว่าง 1.00–9.99'),
  workingDaysPerMonth: z.coerce.number().int('วันทำงาน/เดือน: ต้องเป็นจำนวนเต็ม').min(1).max(31),
  otThresholdMinutes: z.coerce.number().int('เกณฑ์นาที OT: ต้องเป็นจำนวนเต็ม').min(0).max(480),
  // Deductions.
  absentDeductionPerDay: money('หักขาดงาน/วัน', 0),
  lateDeduction: money('หักมาสาย', 0),
  earlyLeaveDeduction: money('หักออกก่อนเวลา', 0),
});

export type PayrollMoneyInput = z.infer<typeof payrollMoneySchema>;

/** Map validated form input to a Prisma update payload (Decimal-safe). */
export function toPayrollConfigData(input: PayrollMoneyInput): Prisma.PayrollConfigUpdateInput {
  return {
    ssoRate: new Prisma.Decimal(input.ssoRatePercent).div(100),
    ssoSalaryCap: new Prisma.Decimal(input.ssoSalaryCap),
    ssoAmountCap: new Prisma.Decimal(input.ssoAmountCap),
    otMultiplier: new Prisma.Decimal(input.otMultiplier),
    workingDaysPerMonth: input.workingDaysPerMonth,
    otThresholdMinutes: input.otThresholdMinutes,
    absentDeductionPerDay: new Prisma.Decimal(input.absentDeductionPerDay),
    lateDeduction: new Prisma.Decimal(input.lateDeduction),
    earlyLeaveDeduction: new Prisma.Decimal(input.earlyLeaveDeduction),
  };
}
