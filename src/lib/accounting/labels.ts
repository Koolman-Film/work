import type { JournalLineKind } from '@prisma/client';

/** Thai labels for the journal line kinds. Shared by the preview table, the
 *  mapping screen and the "not mapped yet" error, so the three cannot describe
 *  the same account differently. */
export const JOURNAL_LINE_LABEL: Record<JournalLineKind, string> = {
  SalaryExpense: 'เงินเดือน',
  AllowanceExpense: 'ค่าครองชีพ / เบี้ยเลี้ยง',
  OtherIncomeExpense: 'เงินเพิ่มอื่น',
  SsoEmployerExpense: 'เงินสมทบประกันสังคม – นายจ้าง',
  SsoPayable: 'ประกันสังคมค้างจ่าย',
  AdvanceRecovery: 'หักคืนเงินเบิกล่วงหน้า',
  AttendancePenalty: 'หักค่าปรับการลงเวลา',
  LeaveDeduction: 'หักวันลาเกินสิทธิ',
  DebtRecovery: 'หักชำระหนี้อื่น',
  OtherDeduction: 'เงินหักอื่น',
  NetPayable: 'เงินเดือนค้างจ่าย (ยอดสุทธิ)',
};

/** Debit kinds first, matching posting order on the preview and the sheet. */
export const JOURNAL_LINE_ORDER: JournalLineKind[] = [
  'SalaryExpense',
  'AllowanceExpense',
  'OtherIncomeExpense',
  'SsoEmployerExpense',
  'SsoPayable',
  'AdvanceRecovery',
  'AttendancePenalty',
  'LeaveDeduction',
  'DebtRecovery',
  'OtherDeduction',
  'NetPayable',
];
