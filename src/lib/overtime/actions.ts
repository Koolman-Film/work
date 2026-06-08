'use server';

import Decimal from 'decimal.js';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { auditLog } from '@/lib/audit/log';
import { requirePermission } from '@/lib/auth/check-permission';
import { prisma } from '@/lib/db/prisma';
import { getLeaveConfig } from '@/lib/leave/leave-config';
import { standardDayMinutes } from '@/lib/leave/units';
import { computeOtAmount, hourlyWage, type OtRateType } from './rate';

const BASE = '/admin/attendance/overtime';
const RATE_TYPES = ['PerHourAmount', 'Multiplier'] as const;

function backUrl(ym: string, error?: string): string {
  const safeYm = /^\d{4}-\d{2}$/.test(ym) ? ym : '';
  const q = new URLSearchParams();
  if (safeYm) q.set('ym', safeYm);
  if (error) q.set('error', error);
  const qs = q.toString();
  return qs ? `${BASE}?${qs}` : BASE;
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: string }).code === 'P2002'
  );
}

function dateOnly(ymd: string): Date {
  return new Date(`${ymd}T00:00:00.000Z`);
}

const ApproveSchema = z.object({
  employeeId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  minutes: z.coerce
    .number()
    .int()
    .min(1)
    .max(24 * 60),
  rateType: z.enum(RATE_TYPES),
  ratePerHour: z.coerce.number().min(0).max(100000).optional(),
  multiplier: z.coerce.number().min(0).max(9.99).optional(),
  note: z.string().trim().max(200).optional(),
  sourceAttendanceId: z.string().uuid().optional(),
});

/** Price an OT entry. PerHourAmount needs no wage; Multiplier derives the
 *  employee's hourly wage from salary + config. */
async function priceOt(input: {
  employeeId: string;
  minutes: number;
  rateType: OtRateType;
  ratePerHour?: number;
  multiplier?: number;
}): Promise<Decimal> {
  if (input.rateType === 'PerHourAmount') {
    return computeOtAmount({
      minutes: input.minutes,
      rateType: 'PerHourAmount',
      ratePerHour: input.ratePerHour ?? 0,
      wage: new Decimal(0),
    });
  }
  const [emp, cfg, leaveCfg] = await Promise.all([
    prisma.employee.findUnique({
      where: { id: input.employeeId },
      select: { salaryType: true, baseSalary: true },
    }),
    prisma.payrollConfig.findFirst({ select: { workingDaysPerMonth: true } }),
    getLeaveConfig(),
  ]);
  const wage = emp
    ? hourlyWage({
        salaryType: emp.salaryType,
        baseSalary: emp.baseSalary,
        standardDayHours: standardDayMinutes(leaveCfg) / 60,
        workingDaysPerMonth: cfg?.workingDaysPerMonth ?? 30,
      })
    : new Decimal(0);
  return computeOtAmount({
    minutes: input.minutes,
    rateType: 'Multiplier',
    multiplier: input.multiplier ?? 0,
    wage,
  });
}

/** Approve a candidate (or any day) as OT, or add OT manually. */
export async function approveOt(formData: FormData): Promise<void> {
  const { user } = await requirePermission('attendance.overtime.manage');
  const ym = String(formData.get('ym') ?? '');
  const parsed = ApproveSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    redirect(backUrl(ym, parsed.error.issues[0]?.message ?? 'ข้อมูลไม่ถูกต้อง'));
  }
  const d = parsed.data;
  const amount = await priceOt(d);

  try {
    const row = await prisma.overtimeEntry.create({
      data: {
        employeeId: d.employeeId,
        date: dateOnly(d.date),
        minutes: d.minutes,
        rateType: d.rateType,
        ratePerHour: d.rateType === 'PerHourAmount' ? new Decimal(d.ratePerHour ?? 0) : null,
        multiplier: d.rateType === 'Multiplier' ? new Decimal(d.multiplier ?? 0) : null,
        computedAmount: amount,
        status: 'Approved',
        sourceAttendanceId: d.sourceAttendanceId ?? null,
        note: d.note || null,
        reviewedById: user.id,
        reviewedAt: new Date(),
        createdById: user.id,
      },
    });
    auditLog({
      actorId: user.id,
      action: 'overtime.approve',
      entityType: 'OvertimeEntry',
      entityId: row.id,
      after: {
        employeeId: d.employeeId,
        date: d.date,
        minutes: d.minutes,
        amount: amount.toString(),
      },
      metadata: { source: 'admin-ui' },
    });
  } catch (err) {
    if (isUniqueViolation(err)) redirect(backUrl(ym, 'วันนี้มีรายการ OT อยู่แล้ว'));
    throw err;
  }
  redirect(backUrl(ym));
}

/** Dismiss a candidate ("not OT") — a Rejected marker that stops re-surfacing. */
export async function dismissOt(formData: FormData): Promise<void> {
  const { user } = await requirePermission('attendance.overtime.manage');
  const ym = String(formData.get('ym') ?? '');
  const employeeId = String(formData.get('employeeId') ?? '');
  const date = String(formData.get('date') ?? '');
  const sourceAttendanceId = formData.get('sourceAttendanceId');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) redirect(backUrl(ym, 'วันที่ไม่ถูกต้อง'));

  try {
    const row = await prisma.overtimeEntry.create({
      data: {
        employeeId,
        date: dateOnly(date),
        minutes: 0,
        rateType: 'PerHourAmount',
        ratePerHour: new Decimal(0),
        computedAmount: new Decimal(0),
        status: 'Rejected',
        sourceAttendanceId: sourceAttendanceId ? String(sourceAttendanceId) : null,
        reviewedById: user.id,
        reviewedAt: new Date(),
        createdById: user.id,
      },
    });
    auditLog({
      actorId: user.id,
      action: 'overtime.dismiss',
      entityType: 'OvertimeEntry',
      entityId: row.id,
      after: { employeeId, date },
      metadata: { source: 'admin-ui' },
    });
  } catch (err) {
    if (isUniqueViolation(err)) redirect(backUrl(ym, 'วันนี้ตัดสินใจไปแล้ว'));
    throw err;
  }
  redirect(backUrl(ym));
}

/** Void (soft-delete) an OT entry, freeing its (employee, date) slot. */
export async function voidOt(formData: FormData): Promise<void> {
  const { user } = await requirePermission('attendance.overtime.manage');
  const ym = String(formData.get('ym') ?? '');
  const id = String(formData.get('id') ?? '');
  const reason = String(formData.get('reason') ?? '').trim() || null;
  const row = await prisma.overtimeEntry.update({
    where: { id },
    data: { deletedAt: new Date(), deletedById: user.id, deleteReason: reason },
  });
  auditLog({
    actorId: user.id,
    action: 'overtime.void',
    entityType: 'OvertimeEntry',
    entityId: row.id,
    metadata: { source: 'admin-ui', reason },
  });
  redirect(backUrl(ym));
}
