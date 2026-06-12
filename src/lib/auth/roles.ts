/**
 * Default system roles — the three built-in roles every fresh install
 * comes with. Custom roles created later by admins have isSystem=false
 * and can be edited / archived; system roles are protected.
 *
 * Why these three:
 *   - Superadmin: the only account holder who can manage other admins,
 *     change role definitions, edit payroll config, etc. Bypasses
 *     all per-permission checks via isSuperadmin=true.
 *   - Admin: branch-level operations team. Manages employees,
 *     approves leave/advances, edits org config IN their branch.
 *     Per-branch scoping is recorded but not enforced until Phase 3.
 *   - Staff: rank-and-file employees. Can use LIFF (check-in,
 *     submit leave/advance, edit own profile). Nothing more.
 *
 * Adding a new system role: add a key here and a row to the migration's
 * seed block. Don't add system roles through code alone — the migration
 * is the source-of-truth boundary; the seed.ts re-applies it
 * idempotently for fresh DBs.
 */

import type { Permission } from './permissions';

export type SystemRoleKey = 'superadmin' | 'admin' | 'staff';

export const SYSTEM_ROLES: Record<
  SystemRoleKey,
  {
    key: SystemRoleKey;
    name: string;
    description: string;
    isSuperadmin: boolean;
    permissions: ReadonlyArray<Permission>;
  }
> = {
  superadmin: {
    key: 'superadmin',
    name: 'Superadmin',
    description:
      'ผู้ดูแลระบบสูงสุด — เข้าถึงทุกฟังก์ชัน ในทุกสาขา ' +
      '(รวมการสร้าง/แก้ไขบทบาท การจัดการบัญชีผู้ดูแลคนอื่น และเงินเดือน)',
    isSuperadmin: true,
    // Even though isSuperadmin=true short-circuits canDo() to grant
    // everything, we still record an empty permissions array here so
    // the admin "view role" page renders meaningfully. Updating this
    // array doesn't change Superadmin's powers — that's the flag.
    permissions: [],
  },
  admin: {
    key: 'admin',
    name: 'Admin',
    description: 'ผู้ดูแลสาขา — จัดการพนักงาน คำขอลา/เบิก และการลงเวลาในสาขาที่ได้รับมอบหมาย',
    isSuperadmin: false,
    permissions: [
      // Employees — full lifecycle including hard delete. We grant
      // employee.delete here (unlike team.delete, which is Superadmin-
      // only) because hiring + firing is the bread-and-butter of branch
      // admin work; deleted-then-recreated is a real workflow our
      // customer hit on day 1 (the "ฝ้าย" incident). Customers can
      // tighten via the Roles CRUD if their policy differs.
      'employee.read',
      'employee.create',
      'employee.update',
      'employee.archive',
      'employee.delete',
      'employee.line-unlink',
      // Attendance — full operational control
      'attendance.read',
      'attendance.live-board',
      'attendance.manual-create',
      'attendance.dispute-resolve',
      'attendance.void',
      'attendance.overtime.manage',
      // Approval workflows
      'leave.read',
      'leave.approve',
      'leave.void',
      'leave.entitlement.manage',
      'advance.read',
      'advance.approve',
      'advance.void',
      // Org config — they manage their branch's config but the perms
      // are listed flat; Phase 3.7 will restrict by branch scope.
      'settings.branch.manage',
      'settings.department.manage',
      'settings.accounting-group.manage',
      'settings.leave-type.manage',
      'settings.leave-config.manage',
      'settings.holiday.manage',
      'settings.work-schedule.manage',
      // Team management — Admin can manage OTHER ADMINS in the same
      // branch (enforced by canActOnRole + canActOnUserScope guards in
      // team/actions.ts). They can't create/edit Superadmins, and a
      // branch-scoped Admin can't touch admins outside their branch.
      // Phase 3.7 relaxed this from Superadmin-only (which Phase 3.5
      // had over-tightened) — the bread-and-butter case is a branch
      // manager onboarding their own sub-admins, which shouldn't
      // require Superadmin intervention.
      'team.read',
      'team.create',
      'team.update',
      'team.delete',
      'team.password-reset',
      // Roles catalog is still read-only for Admin (Superadmin owns
      // the catalog), but role.assign is granted so Admins can
      // attach existing roles to their branch's team members.
      'role.read',
      'role.assign',
      // Audit + dashboard + reports
      'audit.read',
      'dashboard.read',
      'report.read',
      // Payroll (run + publish; backfilled to live DBs in 0028)
      'payroll.read',
      'payroll.run',
      'payroll.publish',
      // LIFF admin pages (LINE) — backfilled to existing installs by migration 0029
      'liff.admin',
    ],
  },
  staff: {
    key: 'staff',
    name: 'Staff',
    description: 'พนักงาน — เช็คอิน/เช็คเอาท์ ยื่นคำขอลา/เบิก และดู/แก้โปรไฟล์ตนเองผ่าน LIFF',
    isSuperadmin: false,
    permissions: ['liff.check-in', 'liff.leave-submit', 'liff.advance-submit', 'liff.profile-edit'],
  },
};
