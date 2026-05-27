'use server';

import { Prisma } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { auditLog } from '@/lib/audit/log';
import { requireRole } from '@/lib/auth/require-role';
import { prisma } from '@/lib/db/prisma';

/**
 * Employee CRUD Server Actions.
 *
 * Notes specific to Employee:
 *   - Creating an Employee also creates a paired User row (role=Employee,
 *     authUserId=null). The auth.users row gets created lazily during the
 *     W3 LINE pairing flow — Employees don't have email+password.
 *   - Multi-branch: assignedBranchIds is a TEXT[] in Postgres; we accept
 *     it as repeated form fields ("assignedBranchIds" multiple times).
 *   - Salary stored as Prisma Decimal — we cast from string explicitly.
 *   - Hire date stored as @db.Date — strip time component.
 */

const EmployeeSchema = z.object({
  firstName: z.string().trim().min(1, 'กรุณากรอกชื่อจริง').max(80),
  lastName: z.string().trim().min(1, 'กรุณากรอกนามสกุล').max(80),
  nickname: z
    .string()
    .trim()
    .max(40)
    .optional()
    .transform((s) => (s ? s : null)),

  branchId: z.string().uuid('กรุณาเลือกสาขาหลัก'),
  // Multi-select arrives as repeated form values. Zod parses array; we
  // sanitize to make sure the home branch is included (idempotent).
  assignedBranchIds: z.array(z.string().uuid()).default([]),

  departmentId: z
    .string()
    .optional()
    .transform((s) => (s && s !== '' ? s : null))
    .pipe(z.string().uuid().nullable()),
  accountingGroupId: z
    .string()
    .optional()
    .transform((s) => (s && s !== '' ? s : null))
    .pipe(z.string().uuid().nullable()),
  workScheduleId: z
    .string()
    .optional()
    .transform((s) => (s && s !== '' ? s : null))
    .pipe(z.string().uuid().nullable()),

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

  hiredAt: z
    .string()
    .min(1, 'กรุณาเลือกวันเริ่มงาน')
    .transform((s) => new Date(s))
    .refine((d) => !Number.isNaN(d.getTime()), 'วันที่ไม่ถูกต้อง'),
});

function readForm(formData: FormData) {
  // Multi-value field: getAll returns all entries with the same name.
  const assignedBranchIds = formData.getAll('assignedBranchIds').map(String).filter(Boolean);
  return EmployeeSchema.safeParse({
    firstName: formData.get('firstName'),
    lastName: formData.get('lastName'),
    nickname: formData.get('nickname'),
    branchId: formData.get('branchId'),
    assignedBranchIds,
    departmentId: formData.get('departmentId'),
    accountingGroupId: formData.get('accountingGroupId'),
    workScheduleId: formData.get('workScheduleId'),
    salaryType: formData.get('salaryType'),
    baseSalary: formData.get('baseSalary'),
    status: formData.get('status'),
    canCheckIn: formData.get('canCheckIn'),
    hiredAt: formData.get('hiredAt'),
  });
}

/** Ensure home branch is in the assigned set; dedupe. */
function normalizeAssigned(branchId: string, raw: string[]): string[] {
  const set = new Set<string>([branchId, ...raw]);
  return Array.from(set);
}

export async function createEmployee(formData: FormData) {
  const { user } = await requireRole(['Admin']);

  const parsed = readForm(formData);
  if (!parsed.success) {
    redirect(
      `/admin/employees/new?error=${encodeURIComponent(parsed.error.issues[0]?.message ?? 'ข้อมูลไม่ถูกต้อง')}`,
    );
  }

  const data = parsed.data;
  const assignedBranchIds = normalizeAssigned(data.branchId, data.assignedBranchIds);

  // Create User + Employee atomically.
  let createdEmpId: string;
  try {
    const result = await prisma.$transaction(async (tx) => {
      const u = await tx.user.create({
        data: { role: 'Employee' },
      });
      const e = await tx.employee.create({
        data: {
          userId: u.id,
          firstName: data.firstName,
          lastName: data.lastName,
          nickname: data.nickname,
          branchId: data.branchId,
          assignedBranchIds,
          departmentId: data.departmentId,
          accountingGroupId: data.accountingGroupId,
          workScheduleId: data.workScheduleId,
          salaryType: data.salaryType,
          baseSalary: new Prisma.Decimal(data.baseSalary),
          status: data.status,
          canCheckIn: data.canCheckIn,
          hiredAt: data.hiredAt,
        },
      });
      return { employee: e, user: u };
    });
    createdEmpId = result.employee.id;

    auditLog({
      actorId: user.id,
      action: 'employee.create',
      entityType: 'Employee',
      entityId: result.employee.id,
      after: {
        firstName: data.firstName,
        lastName: data.lastName,
        nickname: data.nickname,
        branchId: data.branchId,
        assignedBranchIds,
        departmentId: data.departmentId,
        accountingGroupId: data.accountingGroupId,
        workScheduleId: data.workScheduleId,
        salaryType: data.salaryType,
        baseSalary: data.baseSalary,
        status: data.status,
        canCheckIn: data.canCheckIn,
        hiredAt: data.hiredAt.toISOString().slice(0, 10),
      },
      metadata: { source: 'admin-ui' },
    });
  } catch (err: unknown) {
    if (isFkViolation(err)) {
      redirect(
        `/admin/employees/new?error=${encodeURIComponent('อ้างอิงข้อมูลไม่ถูกต้อง (สาขา / แผนก / กลุ่มบัญชี)')}`,
      );
    }
    throw err;
  }

  revalidatePath('/admin/employees');
  redirect(`/admin/employees/${createdEmpId}/edit`);
}

export async function updateEmployee(id: string, formData: FormData) {
  const { user } = await requireRole(['Admin']);

  const parsed = readForm(formData);
  if (!parsed.success) {
    redirect(
      `/admin/employees/${id}/edit?error=${encodeURIComponent(parsed.error.issues[0]?.message ?? 'ข้อมูลไม่ถูกต้อง')}`,
    );
  }

  const data = parsed.data;
  const assignedBranchIds = normalizeAssigned(data.branchId, data.assignedBranchIds);

  const before = await prisma.employee.findUnique({ where: { id } });
  if (!before) redirect('/admin/employees');

  try {
    await prisma.employee.update({
      where: { id },
      data: {
        firstName: data.firstName,
        lastName: data.lastName,
        nickname: data.nickname,
        branchId: data.branchId,
        assignedBranchIds,
        departmentId: data.departmentId,
        accountingGroupId: data.accountingGroupId,
        workScheduleId: data.workScheduleId,
        salaryType: data.salaryType,
        baseSalary: new Prisma.Decimal(data.baseSalary),
        status: data.status,
        canCheckIn: data.canCheckIn,
        hiredAt: data.hiredAt,
      },
    });

    auditLog({
      actorId: user.id,
      action: 'employee.update',
      entityType: 'Employee',
      entityId: id,
      before: serializableEmployee(before),
      after: {
        firstName: data.firstName,
        lastName: data.lastName,
        nickname: data.nickname,
        branchId: data.branchId,
        assignedBranchIds,
        departmentId: data.departmentId,
        accountingGroupId: data.accountingGroupId,
        workScheduleId: data.workScheduleId,
        salaryType: data.salaryType,
        baseSalary: data.baseSalary,
        status: data.status,
        canCheckIn: data.canCheckIn,
        hiredAt: data.hiredAt.toISOString().slice(0, 10),
      },
      metadata: { source: 'admin-ui' },
    });
  } catch (err: unknown) {
    if (isFkViolation(err)) {
      redirect(
        `/admin/employees/${id}/edit?error=${encodeURIComponent('อ้างอิงข้อมูลไม่ถูกต้อง (สาขา / แผนก / กลุ่มบัญชี)')}`,
      );
    }
    throw err;
  }

  revalidatePath('/admin/employees');
  revalidatePath(`/admin/employees/${id}/edit`);
  redirect(`/admin/employees/${id}/edit?ok=1`);
}

export async function archiveEmployee(id: string) {
  const { user } = await requireRole(['Admin']);

  const before = await prisma.employee.findUnique({ where: { id } });
  if (!before || before.archivedAt) redirect('/admin/employees');

  await prisma.employee.update({
    where: { id },
    data: { archivedAt: new Date(), status: 'Archived', canCheckIn: false },
  });

  auditLog({
    actorId: user.id,
    action: 'employee.archive',
    entityType: 'Employee',
    entityId: id,
    before: serializableEmployee(before),
    metadata: { source: 'admin-ui' },
  });

  revalidatePath('/admin/employees');
  redirect('/admin/employees');
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function serializableEmployee(e: {
  firstName: string;
  lastName: string;
  nickname: string | null;
  branchId: string;
  assignedBranchIds: string[];
  departmentId: string | null;
  accountingGroupId: string | null;
  workScheduleId: string | null;
  salaryType: string;
  baseSalary: unknown;
  status: string;
  canCheckIn: boolean;
  hiredAt: Date;
}) {
  return {
    firstName: e.firstName,
    lastName: e.lastName,
    nickname: e.nickname,
    branchId: e.branchId,
    assignedBranchIds: e.assignedBranchIds,
    departmentId: e.departmentId,
    accountingGroupId: e.accountingGroupId,
    workScheduleId: e.workScheduleId,
    salaryType: e.salaryType,
    baseSalary: String(e.baseSalary),
    status: e.status,
    canCheckIn: e.canCheckIn,
    hiredAt: e.hiredAt.toISOString().slice(0, 10),
  };
}

function isFkViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: string }).code === 'P2003'
  );
}
