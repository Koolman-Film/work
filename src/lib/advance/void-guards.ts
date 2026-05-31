/**
 * Pure voidability guard for CashAdvance. Kept separate from the server
 * action (void.ts) so the business rule is unit-testable without a DB or a
 * request context.
 *
 * Rules:
 *   - An already-voided advance can't be voided again.
 *   - An advance already consumed by a published payroll (isDeducted=true)
 *     can't be voided — the money already came out of net pay. The admin must
 *     reverse/correct the payroll first. Mirrors deleteEmployee's "refuse with
 *     a reason, point at the right tool" philosophy.
 */
export type VoidGuardResult =
  | { ok: true }
  | { ok: false; code: 'already-deducted' | 'already-voided'; message: string };

export function assertAdvanceVoidable(a: {
  isDeducted: boolean;
  deletedAt: Date | null;
}): VoidGuardResult {
  if (a.deletedAt) {
    return { ok: false, code: 'already-voided', message: 'รายการนี้ถูกลบไปแล้ว' };
  }
  if (a.isDeducted) {
    return {
      ok: false,
      code: 'already-deducted',
      message: 'ไม่สามารถลบได้ — คำขอนี้ถูกหักในรอบเงินเดือนแล้ว กรุณายกเลิกรอบเงินเดือนก่อน',
    };
  }
  return { ok: true };
}
