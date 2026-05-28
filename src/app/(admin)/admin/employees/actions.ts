'use server';

import { Prisma } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { auditLog } from '@/lib/audit/log';
import { requirePermission } from '@/lib/auth/check-permission';
import { prisma } from '@/lib/db/prisma';
import { getSupabaseAdminClient } from '@/lib/supabase/admin';

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
  const { user } = await requirePermission('employee.create');

  const parsed = readForm(formData);
  if (!parsed.success) {
    redirect(
      `/admin/employees/new?error=${encodeURIComponent(parsed.error.issues[0]?.message ?? 'ข้อมูลไม่ถูกต้อง')}`,
    );
  }

  const data = parsed.data;
  const assignedBranchIds = normalizeAssigned(data.branchId, data.assignedBranchIds);

  // Create User + Employee + Staff UserRoleAssignment(s) atomically.
  // Phase 4.1: the assignment writes mirror the home + assignedBranches
  // structure migration 0009 used for the backfill — one Staff
  // assignment per branch. This is the canonical authorization
  // source now; User.role='Staff' is kept in lockstep until Phase 4.6
  // drops the column.
  let createdEmpId: string;
  try {
    const result = await prisma.$transaction(async (tx) => {
      const u = await tx.user.create({
        data: { role: 'Staff' },
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
      // Look up the 'staff' system role definition once.
      const staffRole = await tx.roleDefinition.findUnique({
        where: { key: 'staff' },
        select: { id: true },
      });
      if (!staffRole) {
        throw new Error("System role 'staff' not found — DB seed corrupt?");
      }
      // One assignment per branch (home + any extra assignedBranches).
      // The Set dedupes if home appears in assignedBranchIds (which
      // normalizeAssigned guarantees, but defense-in-depth).
      const branchSet = new Set<string>([data.branchId, ...assignedBranchIds]);
      await tx.userRoleAssignment.createMany({
        data: Array.from(branchSet).map((branchId) => ({
          userId: u.id,
          roleId: staffRole.id,
          branchId,
        })),
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
  // Phase 3.6: gate on employee.update. Phase 3.7 will add the
  // employee's branchId as context so branch-scoped admins can only
  // edit employees in their own branch.
  const { user } = await requirePermission('employee.update');

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
  const { user } = await requirePermission('employee.archive');

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

/**
 * Hard-delete an employee from the database. Only works for employees
 * with NO related records (attendances, leave, advance, payroll, etc.).
 *
 * Why not cascade-delete the related rows too:
 *   - Thai labor law requires HR records be retained for the longer of
 *     (a) the employment duration + 2 years, or (b) any open dispute.
 *   - Cascade-deleting attendance/payroll would destroy that history.
 *   - For employees who DO have records, the right answer is Archive
 *     (soft delete) — preserves data, hides from active views.
 *
 * So this action is mostly useful for cleaning up mistakes:
 *   - Test employees from UAT
 *   - Duplicates created in error before any check-in/leave was logged
 *   - New hires who quit before their first day
 *
 * For populated employees, the action returns with `?error=...` rather
 * than throwing — the UI can render the message inline.
 *
 * The associated User row is also deleted (cascading via Prisma since
 * Employee.userId is the FK direction; we delete Employee first then User).
 * The Supabase auth.users row IS also deleted when this user had been
 * paired with LINE — leaving it orphaned would break the next admin
 * attempt to re-create + re-pair this person, because Supabase would
 * silently re-bind the orphan to the new pair flow and the cross-row
 * uniqueness check on User.authUserId would trip.
 */
export async function deleteEmployee(id: string) {
  const { user } = await requirePermission('employee.delete');

  const emp = await prisma.employee.findUnique({
    where: { id },
    select: {
      id: true,
      userId: true,
      firstName: true,
      lastName: true,
      user: { select: { authUserId: true, lineUserId: true } },
      _count: {
        select: {
          attendances: true,
          leaveRequests: true,
          cashAdvances: true,
          payrolls: true,
          recurringDeductions: true,
        },
      },
    },
  });
  if (!emp) redirect('/admin/employees');

  // Refuse if any related data exists — admin should use Archive instead.
  const counts = emp._count;
  const totalRelated =
    counts.attendances +
    counts.leaveRequests +
    counts.cashAdvances +
    counts.payrolls +
    counts.recurringDeductions;

  if (totalRelated > 0) {
    const parts = [
      counts.attendances > 0 && `${counts.attendances} รายการลงเวลา`,
      counts.leaveRequests > 0 && `${counts.leaveRequests} คำขอลา`,
      counts.cashAdvances > 0 && `${counts.cashAdvances} คำขอเบิก`,
      counts.payrolls > 0 && `${counts.payrolls} รายการเงินเดือน`,
      counts.recurringDeductions > 0 && `${counts.recurringDeductions} รายการหักประจำ`,
    ].filter(Boolean) as string[];
    const message = `ไม่สามารถลบได้ — พนักงานคนนี้มี ${parts.join(', ')} ในระบบ กรุณาใช้ "พ้นสภาพ" แทน`;
    redirect(`/admin/employees/${id}/edit?error=${encodeURIComponent(message)}`);
  }

  // Safe to delete. Audit-log BEFORE deletion so we capture identity.
  auditLog({
    actorId: user.id,
    action: 'employee.delete',
    entityType: 'Employee',
    entityId: id,
    before: {
      firstName: emp.firstName,
      lastName: emp.lastName,
      userId: emp.userId,
      authUserId: emp.user.authUserId,
      lineUserId: emp.user.lineUserId,
    },
    metadata: { source: 'admin-ui', reason: 'hard-delete-no-related-records' },
  });

  // Transaction: delete Employee row, then the parent User row.
  // Notification rows referencing the User cascade via the schema's
  // onDelete behavior (Cascade for Notification.userId).
  await prisma.$transaction(async (tx) => {
    await tx.employee.delete({ where: { id } });
    await tx.user.delete({ where: { id: emp.userId } });
  });

  // Also delete the Supabase auth.users row when this employee had been
  // paired. Leaving it orphaned causes the very real bug we hit in prod:
  // if an admin later re-creates an Employee for the same person, the new
  // pair attempt has signInWithIdToken silently re-bind the orphaned
  // authUserId, then the Prisma cross-row uniqueness check trips with
  // a confusing "line-account-in-use" error. Best-effort: a failure here
  // is logged but doesn't roll back the Prisma delete (the user CAN'T log
  // in anymore either way, since the Prisma side is gone).
  if (emp.user.authUserId) {
    try {
      const sb = getSupabaseAdminClient();
      const { error: authErr } = await sb.auth.admin.deleteUser(emp.user.authUserId);
      if (authErr) {
        console.error('[deleteEmployee] supabase auth deleteUser failed — orphan left behind', {
          employeeId: id,
          authUserId: emp.user.authUserId,
          message: authErr.message,
        });
      }
    } catch (err) {
      console.error('[deleteEmployee] supabase admin client unavailable', err);
    }
  }

  revalidatePath('/admin/employees');
  redirect('/admin/employees');
}

// ─── Unlink LINE ───────────────────────────────────────────────────────────

/**
 * `unlinkLineFromEmployee` — clears the LINE binding from an Employee.
 *
 * Use when:
 *   - Employee got a new phone / new LINE account
 *   - Wrong person paired (e.g., admin's LINE accidentally got attached)
 *   - The "archive-and-recreate blocked the new pair" recovery flow:
 *     unlink the OLD (archived) Employee's User row so the new Employee
 *     can pair cleanly. This is the workflow used to recover ฝ้าย's
 *     "ทัพไทย" case in production on 2026-05-28.
 *
 * What we do:
 *   1. Clear Prisma User.authUserId + User.lineUserId on the Employee's
 *      paired User row.
 *   2. Delete the corresponding Supabase auth.users row (so the LINE
 *      OIDC sub is no longer associated with any Supabase identity).
 *      Next sign-in from that LINE account will issue a fresh
 *      authUserId.
 *   3. Reset Employee.inviteToken / inviteExpiresAt so any stale QR
 *      that was already printed/shared stops working. Admin will
 *      generate a fresh QR explicitly.
 *   4. Audit-log as 'employee.line-unlink'.
 *
 * Safety: requirePermission('employee.line-unlink') gates. No-op when the User row already
 * has authUserId=null AND lineUserId=null (already unlinked).
 */
export async function unlinkLineFromEmployee(id: string): Promise<void> {
  const { user: actor } = await requirePermission('employee.line-unlink');

  const emp = await prisma.employee.findUnique({
    where: { id },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      nickname: true,
      user: { select: { id: true, authUserId: true, lineUserId: true } },
    },
  });
  if (!emp) {
    redirect(`/admin/employees?error=${encodeURIComponent('ไม่พบพนักงาน')}`);
  }

  // Idempotency: already unlinked → no-op.
  if (!emp.user.authUserId && !emp.user.lineUserId) {
    redirect(`/admin/employees/${id}/edit?ok=${encodeURIComponent('LINE ถูกปลดล็อกอยู่แล้ว')}`);
  }

  const headerList = await headers();
  const ip =
    headerList.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    headerList.get('x-real-ip') ??
    undefined;
  const userAgent = headerList.get('user-agent') ?? undefined;

  const before = {
    authUserId: emp.user.authUserId,
    lineUserId: emp.user.lineUserId,
  };

  // 1+3. Prisma side: clear binding + nullify invite token in one tx.
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: emp.user.id },
      data: { authUserId: null, lineUserId: null },
    });
    await tx.employee.update({
      where: { id: emp.id },
      data: { inviteToken: null, inviteExpiresAt: null },
    });
  });

  // 2. Supabase side: delete the auth.users row. Best-effort — failure
  //    is logged but doesn't reverse the Prisma changes. The employee
  //    can no longer use that LINE-bound session either way.
  if (before.authUserId) {
    try {
      const sb = getSupabaseAdminClient();
      const { error: authErr } = await sb.auth.admin.deleteUser(before.authUserId);
      if (authErr) {
        console.error('[unlinkLineFromEmployee] supabase auth deleteUser failed — orphan left', {
          employeeId: id,
          authUserId: before.authUserId,
          message: authErr.message,
        });
      }
    } catch (err) {
      console.error('[unlinkLineFromEmployee] supabase admin client unavailable', err);
    }
  }

  // 4. Audit.
  auditLog({
    actorId: actor.id,
    action: 'employee.line-unlink',
    entityType: 'Employee',
    entityId: id,
    before,
    after: { authUserId: null, lineUserId: null },
    metadata: {
      ip,
      userAgent,
      source: 'admin-ui',
      employeeName: `${emp.firstName} ${emp.lastName}`.trim(),
      nickname: emp.nickname,
    },
  });

  revalidatePath('/admin/employees');
  revalidatePath(`/admin/employees/${id}/edit`);
  redirect(
    `/admin/employees/${id}/edit?ok=${encodeURIComponent('ปลดล็อก LINE เรียบร้อย — สร้าง QR ใหม่เพื่อจับคู่ใหม่')}`,
  );
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
