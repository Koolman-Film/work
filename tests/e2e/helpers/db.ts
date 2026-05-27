/**
 * Direct DB access for test setup / cleanup.
 *
 * Why we use Prisma directly here instead of driving the UI:
 *   - Setup (seeding a pending LeaveRequest, creating a known Employee)
 *     is cheap and deterministic via Prisma. Building it through the
 *     admin CRUD UI would triple the test time and conflate "the thing
 *     under test" with "getting the system into the precondition state."
 *   - Cleanup must be reliable on failed tests, not "I hope the admin UI
 *     archive flow still works after that exception."
 *
 * Naming convention: every test-created entity gets a name starting with
 * `e2e-` plus a short suffix from the running test, so cleanup can
 * safely sweep "anything starting with `e2e-`" without risking real data.
 */

import { PrismaClient } from '@prisma/client';

// One process-wide client. Playwright runs sequentially (workers: 1) so
// concurrent connection growth isn't a concern here.
const globalPrisma = globalThis as unknown as { prisma?: PrismaClient };
export const prisma = globalPrisma.prisma ?? new PrismaClient();
if (!globalPrisma.prisma) globalPrisma.prisma = prisma;

/** Short unique suffix for test-created entity names. */
export function e2eId(): string {
  // 8 chars of randomness — enough to avoid collisions across parallel
  // test files even though we run sequentially today.
  return Math.random().toString(36).slice(2, 10);
}

/**
 * Wipe every test-created Department, LeaveType, Holiday, etc. Called from
 * the global afterAll hook in each spec file that touches those tables.
 *
 * We delete in the order children-before-parents to respect FK Restrict
 * relations. (E.g., LeaveRequest before LeaveType.)
 */
export async function cleanupE2eRecords(): Promise<void> {
  try {
    // LeaveRequests created with reasons starting with "e2e-"
    await prisma.leaveRequest.deleteMany({ where: { reason: { startsWith: 'e2e-' } } });

    // CashAdvances — schema has no `name`/`reason` for content matching, so
    // we can't easily find e2e rows. Tests that create them must clean up
    // by id in their own afterAll. We delete advance rows attached to e2e
    // employees below via the cascade-by-employee deletion.

    // Attendance rows created by approving an e2e leave will be deleted
    // when their LeaveRequest is deleted only if the relation cascades —
    // ours is `onDelete: SetNull` on Attendance.leaveRequestId, so the
    // Attendance rows survive. Delete them explicitly by leaveRequestId
    // being null + employeeId in our e2e set.

    // Find e2e employees first so we can cascade.
    const e2eEmployees = await prisma.employee.findMany({
      where: {
        OR: [{ firstName: { startsWith: 'e2e-' } }, { lastName: { startsWith: 'e2e-' } }],
      },
      select: { id: true, userId: true },
    });
    const empIds = e2eEmployees.map((e) => e.id);
    const userIds = e2eEmployees.map((e) => e.userId);

    if (empIds.length > 0) {
      await prisma.attendance.deleteMany({ where: { employeeId: { in: empIds } } });
      await prisma.cashAdvance.deleteMany({ where: { employeeId: { in: empIds } } });
      await prisma.leaveRequest.deleteMany({ where: { employeeId: { in: empIds } } });
      await prisma.employee.deleteMany({ where: { id: { in: empIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }

    await prisma.leaveType.deleteMany({ where: { name: { startsWith: 'e2e-' } } });
    await prisma.department.deleteMany({ where: { name: { startsWith: 'e2e-' } } });
    await prisma.branch.deleteMany({ where: { name: { startsWith: 'e2e-' } } });
    await prisma.accountingGroup.deleteMany({ where: { name: { startsWith: 'e2e-' } } });
    await prisma.holiday.deleteMany({ where: { name: { startsWith: 'e2e-' } } });
  } catch (err) {
    // Cleanup failure is logged but not fatal — better to leave the test
    // result green than mask the actual failure with a cleanup error.
    console.error('[e2e cleanup] non-fatal failure', err);
  }
}
