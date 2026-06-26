import { prisma } from '@/lib/db/prisma';

/**
 * Core (auth-free, testable): ensure the employee's User holds a GLOBAL admin
 * role assignment. Idempotent — a NULL branch part means we can't use the
 * compound-unique upsert, so guard with findFirst + create (mirrors seed.ts).
 */
export async function assignAdminRole(employeeId: string): Promise<void> {
  const emp = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { userId: true },
  });
  if (!emp) throw new Error('employee-not-found');
  const adminRole = await prisma.roleDefinition.findUnique({ where: { key: 'admin' } });
  if (!adminRole) throw new Error("System role 'admin' not found — DB seed corrupt?");
  const existing = await prisma.userRoleAssignment.findFirst({
    where: { userId: emp.userId, roleId: adminRole.id, branchId: null },
  });
  if (existing) return;
  await prisma.userRoleAssignment.create({
    data: { userId: emp.userId, roleId: adminRole.id, branchId: null },
  });
}
