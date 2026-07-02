/**
 * Permission catalog — the canonical list of granular actions the role
 * system can grant.
 *
 * Each key is stable: once published it doesn't change. The value is the
 * Thai human-readable label shown in the admin UI when picking permissions
 * for a custom role.
 *
 * Naming convention: "<domain>.<action>" lowercase-kebab. Domains roughly
 * match Prisma model names (singular). Common action verbs:
 *   - read       — list / view detail
 *   - create     — add a new row
 *   - update     — edit existing
 *   - archive    — soft delete (sets archivedAt)
 *   - delete     — hard delete (DB row removal)
 *   - approve    — approve/reject for moderation workflows
 *
 * When adding a new permission: append here, then update the relevant
 * default-role permission list in src/lib/auth/roles.ts. The Superadmin
 * role automatically gains it via the `isSuperadmin=true` short-circuit
 * in canDo() — no migration needed for that case.
 *
 * Permissions are NOT inherently branch-scoped. Whether a particular
 * grant applies to one branch or globally is decided by the
 * `UserRoleAssignment.branchId` of the assignment that conferred it
 * (NULL = global, non-NULL = scoped to that branch). The caller of
 * `canDo()` passes a `branchId` context when relevant; helpers in
 * src/lib/auth/check-permission.ts handle the scope intersection.
 *
 * Phase 1 note: branch-scope is RECORDED but NOT ENFORCED yet —
 * canDo() ignores the context branchId. Phase 3 wires up real
 * scope-based enforcement. See docs/v2/permissions.md.
 */

export const PERMISSIONS = {
  // ─── Employee operations ─────────────────────────────────────────────
  'employee.read': 'ดูข้อมูลพนักงาน',
  'employee.create': 'สร้างพนักงาน',
  'employee.update': 'แก้ไขพนักงาน',
  'employee.archive': 'พ้นสภาพพนักงาน',
  'employee.delete': 'ลบพนักงานถาวร',
  'employee.line-unlink': 'ปลดล็อก LINE ของพนักงาน',

  // ─── Attendance ──────────────────────────────────────────────────────
  'attendance.read': 'ดูข้อมูลการลงเวลา',
  'attendance.manual-create': 'สร้างการลงเวลาด้วยมือ',
  'attendance.dispute-resolve': 'อนุมัติ/ปฏิเสธรายการตรวจสอบ',
  'attendance.live-board': 'ดูสถานะการลงเวลาแบบเรียลไทม์',
  'attendance.void': 'ลบ/ยกเลิกรายการลงเวลา',
  'attendance.overtime.manage': 'จัดการการทำงานล่วงเวลา (OT)',

  // ─── Leave ───────────────────────────────────────────────────────────
  'leave.read': 'ดูคำขอลา',
  'leave.approve': 'อนุมัติ/ปฏิเสธคำขอลา',
  'leave.void': 'ลบ/ยกเลิกคำขอลา (รวมรายการลงเวลาที่สร้างอัตโนมัติ)',
  'leave.entitlement.manage': 'จัดการสิทธิวันลาของพนักงาน',

  // ─── Cash advance ────────────────────────────────────────────────────
  'advance.read': 'ดูคำขอเบิก',
  'advance.approve': 'อนุมัติ/ปฏิเสธคำขอเบิก',
  'advance.void': 'ลบ/ยกเลิกคำขอเบิก',

  // ─── Org settings (config entities) ──────────────────────────────────
  'settings.branch.manage': 'จัดการสาขา',
  'settings.department.manage': 'จัดการแผนก',
  'settings.accounting-group.manage': 'จัดการกลุ่มบัญชี',
  'settings.leave-type.manage': 'จัดการประเภทการลา',
  'settings.leave-config.manage': 'จัดการการตั้งค่าการลา',
  'settings.holiday.manage': 'จัดการวันหยุด',
  'settings.work-schedule.manage': 'จัดการตารางงาน',
  'settings.attendance.manage': 'จัดการการตั้งค่าการมาสาย',
  'settings.payroll.manage': 'จัดการการตั้งค่าเงินเดือน (ประกันสังคม / OT / หักเงิน)',

  // ─── Team (admin/owner accounts) ─────────────────────────────────────
  'team.read': 'ดูรายการผู้ดูแล',
  'team.create': 'สร้างบัญชีผู้ดูแล',
  'team.update': 'แก้ไขบัญชีผู้ดูแล',
  'team.delete': 'ลบบัญชีผู้ดูแล',
  'team.password-reset': 'รีเซ็ตรหัสผ่านผู้ดูแล',

  // ─── Role management ─────────────────────────────────────────────────
  'role.read': 'ดูบทบาท',
  'role.manage': 'สร้าง/แก้ไข/ลบบทบาทเอง',
  'role.assign': 'มอบหมายบทบาทให้ผู้ใช้',

  // ─── Payroll ─────────────────────────────────────────────────────────
  'payroll.read': 'ดูเงินเดือน',
  'payroll.run': 'รันคำนวณเงินเดือน',
  'payroll.publish': 'เผยแพร่เงินเดือน',

  // ─── Reports ─────────────────────────────────────────────────────────
  'report.read': 'ดูรายงานสรุป',

  // ─── LIFF (employee-facing actions) ──────────────────────────────────
  'liff.check-in': 'เช็คอิน/เช็คเอาท์',
  'liff.leave-submit': 'ยื่นคำขอลา',
  'liff.advance-submit': 'ยื่นคำขอเบิก',
  'liff.profile-edit': 'แก้ไขโปรไฟล์ตนเอง',
  'liff.admin': 'ใช้งานหน้าแอดมินใน LINE (อนุมัติคำขอ/แนบสลิป)',

  // ─── Audit ──────────────────────────────────────────────────────────
  'audit.read': 'ดูประวัติการเปลี่ยนแปลง',

  // ─── Dashboard (read-only summary access) ────────────────────────────
  'dashboard.read': 'ดูแดชบอร์ดสรุป',
} as const;

export type Permission = keyof typeof PERMISSIONS;

/**
 * Returns every permission key in the catalog. Useful for the admin
 * "create custom role" UI to render all checkboxes. Superadmin doesn't
 * need this list — `canDo()` short-circuits via the isSuperadmin flag.
 */
export const ALL_PERMISSIONS: ReadonlyArray<Permission> = Object.keys(PERMISSIONS) as Permission[];

/** True if the given string is a known Permission key. Use at any
 *  trust boundary (form input, JSON parse, etc.). */
export function isPermission(value: unknown): value is Permission {
  return typeof value === 'string' && value in PERMISSIONS;
}

/**
 * Logical groupings for the admin permission-picker UI. Each group
 * gets its own section header. The grouping is presentation-only —
 * runtime checks don't care about groups.
 */
export const PERMISSION_GROUPS: ReadonlyArray<{
  key: string;
  label: string;
  permissions: ReadonlyArray<Permission>;
}> = [
  {
    key: 'employee',
    label: 'พนักงาน',
    permissions: [
      'employee.read',
      'employee.create',
      'employee.update',
      'employee.archive',
      'employee.delete',
      'employee.line-unlink',
    ],
  },
  {
    key: 'attendance',
    label: 'การลงเวลา',
    permissions: [
      'attendance.read',
      'attendance.live-board',
      'attendance.manual-create',
      'attendance.dispute-resolve',
      'attendance.void',
      'attendance.overtime.manage',
    ],
  },
  {
    key: 'leave',
    label: 'การลา',
    permissions: ['leave.read', 'leave.approve', 'leave.void', 'leave.entitlement.manage'],
  },
  {
    key: 'advance',
    label: 'การเบิก',
    permissions: ['advance.read', 'advance.approve', 'advance.void'],
  },
  {
    key: 'settings',
    label: 'ตั้งค่า',
    permissions: [
      'settings.branch.manage',
      'settings.department.manage',
      'settings.accounting-group.manage',
      'settings.leave-type.manage',
      'settings.leave-config.manage',
      'settings.holiday.manage',
      'settings.work-schedule.manage',
      'settings.attendance.manage',
      'settings.payroll.manage',
    ],
  },
  {
    key: 'team',
    label: 'ทีมผู้ดูแล',
    permissions: ['team.read', 'team.create', 'team.update', 'team.delete', 'team.password-reset'],
  },
  {
    key: 'role',
    label: 'บทบาท',
    permissions: ['role.read', 'role.manage', 'role.assign'],
  },
  {
    key: 'payroll',
    label: 'เงินเดือน',
    permissions: ['payroll.read', 'payroll.run', 'payroll.publish'],
  },
  {
    key: 'liff',
    label: 'LIFF (สำหรับพนักงาน)',
    permissions: [
      'liff.check-in',
      'liff.leave-submit',
      'liff.advance-submit',
      'liff.profile-edit',
      'liff.admin',
    ],
  },
  {
    key: 'report',
    label: 'รายงาน',
    permissions: ['report.read'],
  },
  {
    key: 'misc',
    label: 'อื่นๆ',
    permissions: ['audit.read', 'dashboard.read'],
  },
];
