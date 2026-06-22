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
import { getSupabaseAdminClient } from '@/lib/supabase/admin';

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

/** A seeded Staff worker + geofenced branch, ready for LIFF check-in tests. */
export type E2eWorker = {
  email: string;
  password: string;
  authUserId: string;
  userId: string;
  employeeId: string;
  branchId: string;
  branchName: string;
};

/**
 * Seed a complete Staff worker the way LINE pairing would, minus the OIDC:
 *   - a real Supabase auth user (email-confirmed, with a password so the
 *     test-login route can sign in)
 *   - a `User` row bound by authUserId + a Staff role assignment
 *   - an `Employee` (canCheckIn, Active) at a geofenced branch
 *
 * The branch has `requireGps: true` (so the geofence verdict actually runs)
 * and `requireSelfie: false` (so the camera/Storage path is skipped — that's
 * a separate, heavier spec).
 */
/**
 * Provision the `attendance-photos` Storage bucket + its RLS policies in the
 * LOCAL stack, mirroring production. This infra is created out-of-band in prod
 * (Supabase dashboard) and isn't in any migration, so a fresh local stack has
 * neither the bucket nor the policies — selfie uploads would fail. Idempotent
 * (safe to call before every selfie test). Local-only; never run against prod.
 *
 * Policy definitions copied verbatim from production (read-only). They depend
 * on is_admin_or_owner() (migration 0022) and the storage built-ins, both
 * present locally.
 */
export async function ensureAttendancePhotosBucket(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    do $$
    begin
      insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
      values ('attendance-photos', 'attendance-photos', false, 5242880,
              array['image/jpeg','image/png'])
      on conflict (id) do nothing;

      if not exists (select 1 from pg_policies where schemaname='storage'
        and tablename='objects' and policyname='attendance_photos: users insert own folder') then
        create policy "attendance_photos: users insert own folder" on storage.objects
          for insert to authenticated
          with check (bucket_id='attendance-photos'
            and (storage.foldername(name))[1] = (auth.uid())::text);
      end if;

      if not exists (select 1 from pg_policies where schemaname='storage'
        and tablename='objects' and policyname='attendance_photos: users read own folder') then
        create policy "attendance_photos: users read own folder" on storage.objects
          for select to authenticated
          using (bucket_id='attendance-photos'
            and (storage.foldername(name))[1] = (auth.uid())::text);
      end if;

      if not exists (select 1 from pg_policies where schemaname='storage'
        and tablename='objects' and policyname='attendance_photos: admins read all') then
        create policy "attendance_photos: admins read all" on storage.objects
          for select to authenticated
          using (bucket_id='attendance-photos' and is_admin_or_owner(auth.uid()));
      end if;

      if not exists (select 1 from pg_policies where schemaname='storage'
        and tablename='objects' and policyname='attendance_photos: admins update all') then
        create policy "attendance_photos: admins update all" on storage.objects
          for update to authenticated
          using (bucket_id='attendance-photos' and is_admin_or_owner(auth.uid()))
          with check (bucket_id='attendance-photos' and is_admin_or_owner(auth.uid()));
      end if;

      if not exists (select 1 from pg_policies where schemaname='storage'
        and tablename='objects' and policyname='attendance_photos: admins delete all') then
        create policy "attendance_photos: admins delete all" on storage.objects
          for delete to authenticated
          using (bucket_id='attendance-photos' and is_admin_or_owner(auth.uid()));
      end if;
    end $$;
  `);
}

export async function createE2eWorker(opts?: {
  lat?: number;
  lng?: number;
  radiusMeters?: number;
  requireSelfie?: boolean;
}): Promise<E2eWorker> {
  const suffix = e2eId();
  const email = `e2e-worker-${suffix}@koolman.local`;
  const password = `E2e_Worker_${suffix}!`;

  // 1. Supabase auth user. email_confirm so signInWithPassword works immediately.
  const admin = getSupabaseAdminClient();
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`createE2eWorker: admin.createUser failed — ${error?.message ?? 'no user'}`);
  }
  const authUserId = data.user.id;

  // 2. The 'staff' system role (seeded by migration 0030's predecessor).
  const staffRole = await prisma.roleDefinition.findUniqueOrThrow({ where: { key: 'staff' } });

  // 3. Geofenced branch.
  const branch = await prisma.branch.create({
    data: {
      name: `e2e-branch-${suffix}`,
      latitude: opts?.lat ?? 13.7563,
      longitude: opts?.lng ?? 100.5018,
      radiusMeters: opts?.radiusMeters ?? 150,
      requireGps: true,
      requireSelfie: opts?.requireSelfie ?? false,
      requireCheckOut: false,
    },
  });

  // 4. User (+ Staff assignment) and the Employee.
  const user = await prisma.user.create({
    data: {
      authUserId,
      roleAssignments: { create: { roleId: staffRole.id } },
    },
  });
  const employee = await prisma.employee.create({
    data: {
      userId: user.id,
      firstName: 'e2e-Worker',
      lastName: suffix,
      branchId: branch.id,
      salaryType: 'Monthly',
      baseSalary: 20_000,
      status: 'Active',
      canCheckIn: true,
      hiredAt: new Date('2026-01-01'),
    },
  });

  return {
    email,
    password,
    authUserId,
    userId: user.id,
    employeeId: employee.id,
    branchId: branch.id,
    branchName: branch.name,
  };
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
      // Capture the Supabase auth ids before deleting the User rows so we can
      // also reap the auth.users entries (createE2eWorker minted them).
      const users = await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { authUserId: true },
      });

      await prisma.attendance.deleteMany({ where: { employeeId: { in: empIds } } });
      await prisma.cashAdvance.deleteMany({ where: { employeeId: { in: empIds } } });
      await prisma.leaveRequest.deleteMany({ where: { employeeId: { in: empIds } } });
      await prisma.employee.deleteMany({ where: { id: { in: empIds } } });
      // UserRoleAssignment rows cascade on User delete (onDelete: Cascade).
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });

      // Reap the Supabase auth users. Best-effort — a leftover dev auth user
      // is harmless, so a failure here must not fail the suite.
      const authIds = users.map((u) => u.authUserId).filter((id): id is string => id != null);
      if (authIds.length > 0) {
        const admin = getSupabaseAdminClient();

        // Selfie objects uploaded under {authUserId}/checkins/ aren't tied to a
        // Prisma row. Reap them via the Storage API — direct SQL DELETE on
        // storage.objects is blocked by Supabase. Best-effort.
        await Promise.all(
          authIds.map(async (id) => {
            try {
              const folder = `${id}/checkins`;
              const { data: files } = await admin.storage.from('attendance-photos').list(folder);
              if (files?.length) {
                await admin.storage
                  .from('attendance-photos')
                  .remove(files.map((f) => `${folder}/${f.name}`));
              }
            } catch (e) {
              console.error('[e2e cleanup] storage remove failed', id, e);
            }
          }),
        );

        await Promise.all(
          authIds.map((id) =>
            admin.auth.admin.deleteUser(id).catch((e) => {
              console.error('[e2e cleanup] auth.deleteUser failed', id, e);
            }),
          ),
        );
      }
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
