/**
 * Thai labels for `Attendance.type`.
 *
 * Single source of truth shared by the admin records view
 * (`attendance-row-vm.ts`, which re-exports this) and the manual-entry
 * duplicate-guard message (`manual.ts`) — so an admin is never shown a raw
 * English enum name (e.g. `"Late"`) they never chose on the form.
 *
 * Deliberately NOT marked `import 'server-only'` (unlike
 * `attendance-row-vm.ts`): it's plain data with no server secrets, and
 * `manual.ts` is exercised by unit tests that import it directly (not
 * through a Server Component render), where the `server-only` guard throws
 * unconditionally outside Next's build pipeline.
 */
export const TYPE_LABELS: Record<string, { label: string; cls: string }> = {
  CheckIn: { label: 'เช็คอิน', cls: 'bg-green-100 text-green-800' },
  CheckOut: { label: 'เช็คเอาท์', cls: 'bg-blue-100 text-blue-800' },
  Late: { label: 'มาสาย', cls: 'bg-amber-100 text-amber-800' },
  EarlyLeave: { label: 'ออกก่อน', cls: 'bg-amber-100 text-amber-800' },
  Absent: { label: 'ขาดงาน', cls: 'bg-red-100 text-red-800' },
  OnLeave: { label: 'ลา', cls: 'bg-primary-100 text-primary-800' },
};
