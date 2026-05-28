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
      // Employees
      'employee.read',
      'employee.create',
      'employee.update',
      'employee.archive',
      'employee.line-unlink',
      // Attendance — full operational control
      'attendance.read',
      'attendance.live-board',
      'attendance.manual-create',
      'attendance.dispute-resolve',
      // Approval workflows
      'leave.read',
      'leave.approve',
      'advance.read',
      'advance.approve',
      // Org config — they manage their branch's config but the perms
      // are listed flat; Phase 3 will restrict by branch scope.
      'settings.branch.manage',
      'settings.department.manage',
      'settings.holiday.manage',
      'settings.work-schedule.manage',
      // Read-only on team / roles — they can SEE other admins but
      // can't create/edit them (that's Superadmin territory).
      'team.read',
      'role.read',
      // Audit + dashboard
      'audit.read',
      'dashboard.read',
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
