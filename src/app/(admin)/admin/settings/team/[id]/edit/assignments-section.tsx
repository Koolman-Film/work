/**
 * Role-assignments section on the team edit page (Phase 2b).
 *
 * Server Component — renders the current list of UserRoleAssignment rows
 * for the target user plus an "Add assignment" form (role + branch).
 *
 * Permission semantics (matches actions.ts):
 *   - Only Superadmin can grant or revoke the 'superadmin' role.
 *   - Admin can grant/revoke other roles to any team member they manage.
 *   - The actor can never demote their own 'superadmin' assignment (no-
 *     self-demotion guard in removeRoleAssignment).
 *
 * The "add" form shows ALL active (non-archived) roles in the picker —
 * even ones the actor can't grant — and surfaces the permission error
 * at submit time. Rationale: hiding the Superadmin option for Admin
 * actors hides the existence of the role (confusing in a multi-Admin
 * org); showing it with a clear "ต้องเป็น Superadmin" error makes the
 * boundary explicit. The action enforces the same check server-side.
 */

import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { FormField } from '@/components/ui/form-field';
import { prisma } from '@/lib/db/prisma';
import { addRoleAssignment, removeRoleAssignment } from '../../actions';

type Props = {
  userId: string;
  actorRole: 'Admin' | 'Superadmin';
  actorId: string;
};

export async function AssignmentsSection({ userId, actorRole, actorId }: Props) {
  const [assignments, allRoles, allBranches] = await Promise.all([
    prisma.userRoleAssignment.findMany({
      where: { userId },
      include: {
        role: { select: { id: true, key: true, name: true, isSuperadmin: true } },
        branch: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.roleDefinition.findMany({
      where: { archivedAt: null },
      orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
      select: {
        id: true,
        key: true,
        name: true,
        isSuperadmin: true,
        isSystem: true,
      },
    }),
    prisma.branch.findMany({
      where: { archivedAt: null },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
  ]);

  const addBound = addRoleAssignment.bind(null, userId);

  return (
    <Card>
      <CardHeader>
        <CardTitle>การมอบหมายบทบาท</CardTitle>
      </CardHeader>
      <CardBody className="space-y-4">
        <p className="text-xs text-gray-500">
          ผู้ใช้คนหนึ่งสามารถมีบทบาทหลายบทบาท แยกตามสาขาได้ — เช่น "Admin ที่สาขา A + Staff ที่สาขา B"
          {actorRole !== 'Superadmin' && (
            <>
              <br />
              <span className="text-amber-700">
                บทบาท Superadmin จำเป็นต้องให้ Superadmin คนอื่นเป็นผู้มอบหมาย
              </span>
            </>
          )}
        </p>

        {/* ─── Existing assignments list ──────────────────────────────── */}
        {assignments.length === 0 ? (
          <p className="rounded-md border border-dashed border-gray-200 px-4 py-6 text-center text-sm text-gray-400">
            ยังไม่มีการมอบหมายบทบาท
          </p>
        ) : (
          <ul className="divide-y divide-gray-100 rounded-md border border-gray-200">
            {assignments.map((a) => {
              // Permission for the remove button: Admin can't remove
              // Superadmin assignments; nobody can remove their own
              // Superadmin assignment.
              const canRemove =
                !(a.role.isSuperadmin && actorRole !== 'Superadmin') &&
                !(a.userId === actorId && a.role.isSuperadmin);

              return (
                <li
                  key={a.id}
                  className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm"
                >
                  <div className="min-w-0">
                    <span className="font-medium text-gray-900">{a.role.name}</span>
                    <span className="ml-2 text-gray-500">
                      @{' '}
                      {a.branch ? (
                        <span>{a.branch.name}</span>
                      ) : (
                        <span className="rounded bg-purple-50 px-1.5 py-0.5 text-xs font-medium text-purple-700">
                          ทุกสาขา
                        </span>
                      )}
                    </span>
                    {a.role.isSuperadmin && (
                      <span className="ml-2 rounded-full bg-purple-100 px-2 py-0.5 text-[10px] font-medium text-purple-800">
                        Superadmin
                      </span>
                    )}
                  </div>
                  {canRemove ? (
                    <form action={removeRoleAssignment.bind(null, a.id)}>
                      <button
                        type="submit"
                        aria-label="เอาบทบาทออก"
                        className="grid size-8 place-items-center rounded-md text-gray-400 transition hover:bg-red-50 hover:text-red-700"
                      >
                        <Trash2 size={16} aria-hidden="true" />
                      </button>
                    </form>
                  ) : (
                    <span className="text-xs text-gray-400" title="ไม่มีสิทธิ์เอาออก">
                      —
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {/* ─── Add-assignment form ────────────────────────────────────── */}
        <form action={addBound} className="space-y-3 rounded-md border border-gray-200 p-4">
          <p className="text-xs font-medium uppercase tracking-wider text-gray-500">
            มอบหมายบทบาทใหม่
          </p>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FormField label="บทบาท" htmlFor="roleId" required>
              <select
                id="roleId"
                name="roleId"
                required
                defaultValue=""
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500/30"
              >
                <option value="" disabled>
                  เลือกบทบาท...
                </option>
                {allRoles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                    {r.isSuperadmin ? ' (Superadmin)' : ''}
                    {!r.isSystem ? ' [กำหนดเอง]' : ''}
                  </option>
                ))}
              </select>
            </FormField>

            <FormField label="สาขา" htmlFor="branchId" required>
              <select
                id="branchId"
                name="branchId"
                required
                defaultValue="global"
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500/30"
              >
                <option value="global">ทุกสาขา (Global)</option>
                {allBranches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </FormField>
          </div>

          <p className="text-[11px] text-gray-400">
            Phase 1: ขอบเขตสาขายังไม่ถูกบังคับใช้ — ระบบบันทึกไว้แต่ตอนนี้ยังให้ผ่านทุกสาขา (ดูเอกสาร
            docs/v2/permissions.md)
          </p>

          <div className="flex justify-end">
            <Button type="submit" size="sm">
              + เพิ่มการมอบหมาย
            </Button>
          </div>
        </form>
      </CardBody>
      <CardFooter className="text-xs text-gray-500">
        บทบาทของผู้ใช้คำนวณอัตโนมัติจากการมอบหมายด้านบน — สิทธิ์สูงสุดจะถูกใช้
      </CardFooter>
    </Card>
  );
}
