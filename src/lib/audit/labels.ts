import type { AuditAction, AuditEntityType } from '@/lib/audit/log';

/** Action string → Thai description. Covers every AuditAction; unknown
 *  actions fall back to the raw key via actionLabel(). */
export const ACTION_LABELS: Record<AuditAction, string> = {
  'user.create': 'สร้างผู้ใช้',
  'user.archive': 'ระงับผู้ใช้',
  'user.delete': 'ลบผู้ใช้',
  'user.role-change': 'เปลี่ยนบทบาทผู้ใช้',
  'user.locale-change': 'เปลี่ยนภาษาผู้ใช้',
  'user.password-reset': 'รีเซ็ตรหัสผ่าน',
  'user.password-change': 'เปลี่ยนรหัสผ่าน',
  'user.admin-line-invite': 'เชิญผูก LINE แอดมิน',
  'user.admin-line-link': 'ผูก LINE แอดมิน',
  'user.admin-line-unlink': 'ยกเลิกผูก LINE แอดมิน',
  'user.account-merge': 'รวมบัญชี',
  'role.create': 'สร้างบทบาท',
  'role.update': 'แก้ไขบทบาท',
  'role.archive': 'ลบบทบาท',
  'roleAssignment.create': 'มอบหมายบทบาท',
  'roleAssignment.delete': 'ถอนบทบาท',
  'employee.create': 'เพิ่มพนักงาน',
  'employee.update': 'แก้ไขพนักงาน',
  'employee.archive': 'พ้นสภาพพนักงาน',
  'employee.delete': 'ลบพนักงานถาวร',
  'employee.rehire': 'จ้างกลับ',
  'employee.line-link': 'เชื่อม LINE พนักงาน',
  'employee.line-unlink': 'ยกเลิกเชื่อม LINE พนักงาน',
  'employee.profile.self-update': 'พนักงานแก้ไขโปรไฟล์',
  'branch.create': 'เพิ่มสาขา',
  'branch.update': 'แก้ไขสาขา',
  'branch.archive': 'ลบสาขา',
  'department.create': 'เพิ่มแผนก',
  'department.update': 'แก้ไขแผนก',
  'department.archive': 'ลบแผนก',
  'accountingGroup.create': 'เพิ่มกลุ่มบัญชี',
  'accountingGroup.update': 'แก้ไขกลุ่มบัญชี',
  'accountingGroup.archive': 'ลบกลุ่มบัญชี',
  'workSchedule.create': 'เพิ่มตารางงาน',
  'workSchedule.update': 'แก้ไขตารางงาน',
  'workSchedule.archive': 'ลบตารางงาน',
  'leaveType.create': 'เพิ่มประเภทการลา',
  'leaveType.update': 'แก้ไขประเภทการลา',
  'leaveType.archive': 'ลบประเภทการลา',
  'leaveConfig.update': 'แก้ไขการตั้งค่าการลา',
  'payrollConfig.update': 'แก้ไขการตั้งค่าเงินเดือน',
  'leaveEntitlement.update': 'ปรับสิทธิวันลา',
  'overtime.approve': 'อนุมัติ OT',
  'overtime.dismiss': 'ปฏิเสธ OT',
  'overtime.void': 'ยกเลิก OT',
  'holiday.create': 'เพิ่มวันหยุด',
  'holiday.update': 'แก้ไขวันหยุด',
  'holiday.archive': 'ลบวันหยุด',
  'attendance.checkin': 'เช็คอิน',
  'attendance.checkout': 'เช็คเอาท์',
  'attendance.late-auto': 'บันทึกมาสายอัตโนมัติ',
  'attendance.manual-create': 'สร้างการลงเวลาด้วยมือ',
  'attendance.edit': 'แก้ไขการลงเวลา',
  'attendance.dispute-approve': 'อนุมัติรายการตรวจสอบ',
  'attendance.dispute-reject': 'ปฏิเสธรายการตรวจสอบ',
  'attendance.force-checkout': 'บังคับเช็คเอาท์',
  'attendance.void': 'ยกเลิกการลงเวลา',
  'attendance.restore': 'กู้คืนการลงเวลา',
  'leave.submit': 'ส่งคำขอลา',
  'leave.admin-create': 'แอดมินสร้างคำขอลา',
  'leave.approve': 'อนุมัติคำขอลา',
  'leave.reject': 'ปฏิเสธคำขอลา',
  'leave.cancel': 'ยกเลิกคำขอลา',
  'leave.void': 'ลบคำขอลา',
  'leave.restore': 'กู้คืนคำขอลา',
  'leave.recompute': 'คำนวณวันลาใหม่',
  'leave.correct-type': 'แก้ประเภทคำขอลา',
  'advance.submit': 'ส่งคำขอเบิก',
  'advance.admin-create': 'แอดมินสร้างคำขอเบิก',
  'advance.approve': 'อนุมัติคำขอเบิก',
  'advance.reject': 'ปฏิเสธคำขอเบิก',
  'advance.mark-paid': 'ทำเครื่องหมายจ่ายแล้ว',
  'advance.cancel': 'ยกเลิกคำขอเบิก',
  'advance.void': 'ลบคำขอเบิก',
  'advance.restore': 'กู้คืนคำขอเบิก',
  'payroll.run': 'รันคำนวณเงินเดือน',
  'payroll.override': 'ปรับแก้เงินเดือน',
  'payroll.publish': 'เผยแพร่เงินเดือน',
  'payroll.unlock': 'ปลดล็อกเงินเดือน',
  'payroll.revise': 'แก้ไขเงินเดือนที่เผยแพร่',
  'payslip.download': 'ดาวน์โหลดสลิป',
  'payslip.preview': 'ดูตัวอย่างสลิป',
  'recurringDeduction.create': 'เพิ่มรายการหักประจำ',
  'recurringDeduction.edit': 'แก้ไขรายการหักประจำ',
  'recurringDeduction.end': 'สิ้นสุดรายการหักประจำ',
  'payrollAdjustment.create': 'เพิ่มรายการปรับเงินเดือน',
  'payrollAdjustment.edit': 'แก้ไขรายการปรับเงินเดือน',
  'payrollAdjustment.delete': 'ลบรายการปรับเงินเดือน',
  'penaltySettlement.create': 'หักสิทธิวันลาชดเชยค่าปรับ',
  'penaltySettlement.update': 'แก้ไขการหักสิทธิวันลาชดเชยค่าปรับ',
  'penaltySettlement.clear': 'ยกเลิกการหักสิทธิวันลาชดเชยค่าปรับ',
};

/** Entity type → Thai noun. */
export const ENTITY_TYPE_LABELS: Record<AuditEntityType, string> = {
  User: 'ผู้ใช้',
  Employee: 'พนักงาน',
  Branch: 'สาขา',
  RoleDefinition: 'บทบาท',
  UserRoleAssignment: 'การมอบบทบาท',
  Department: 'แผนก',
  AccountingGroup: 'กลุ่มบัญชี',
  WorkSchedule: 'ตารางงาน',
  LeaveType: 'ประเภทการลา',
  LeaveConfig: 'ตั้งค่าการลา',
  PayrollConfig: 'ตั้งค่าเงินเดือน',
  LeaveEntitlement: 'สิทธิวันลา',
  OvertimeEntry: 'OT',
  Holiday: 'วันหยุด',
  Attendance: 'การลงเวลา',
  LeaveRequest: 'คำขอลา',
  CashAdvance: 'คำขอเบิก',
  Payroll: 'เงินเดือน',
  PayrollAdjustment: 'ปรับเงินเดือน',
  RecurringDeduction: 'หักประจำ',
  AttendancePenaltySettlement: 'การหักสิทธิวันลาชดเชยค่าปรับ',
};

/** Actions that move money, change access, or destroy data — badged in the UI. */
export const SENSITIVE_ACTIONS: ReadonlySet<string> = new Set<AuditAction>([
  'user.role-change',
  'user.delete',
  'user.archive',
  'user.account-merge',
  'user.password-reset',
  'role.create',
  'role.update',
  'role.archive',
  'roleAssignment.create',
  'roleAssignment.delete',
  'employee.delete',
  'employee.archive',
  'payroll.publish',
  'payroll.revise',
  'payroll.unlock',
  'payrollConfig.update',
]);

/** Friendly Thai labels for common before/after diff fields. */
export const FIELD_LABELS: Record<string, string> = {
  baseSalary: 'เงินเดือนฐาน',
  salaryType: 'ประเภทเงินเดือน',
  status: 'สถานะ',
  branchId: 'สาขา',
  departmentId: 'แผนก',
  firstName: 'ชื่อ',
  lastName: 'นามสกุล',
  nickname: 'ชื่อเล่น',
  permissions: 'สิทธิ์',
  roleId: 'บทบาท',
  archivedAt: 'วันที่พ้นสภาพ',
};

export function actionLabel(action: string): string {
  return ACTION_LABELS[action as AuditAction] ?? action;
}

export function entityLabel(entityType: string): string {
  return ENTITY_TYPE_LABELS[entityType as AuditEntityType] ?? entityType;
}

export function isSensitive(action: string): boolean {
  return SENSITIVE_ACTIONS.has(action);
}

export function fieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? field;
}
