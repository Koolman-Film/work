import { PageHeader } from '@/components/ui/page-header';
import { requireRole } from '@/lib/auth/require-role';
import { BackfillPanel } from './backfill-panel';

/**
 * One-off maintenance tool — undo the pre-2026-07-23 bug where a "มาสาย"
 * (Late) row was measured from the scheduled start even on a day the
 * employee had an approved (morning) leave, recording ~3h of bogus lateness.
 * See src/lib/attendance/backfill-leave-late.ts for the full writeup.
 *
 * Superadmin-only (requireRole, not a permission grant): this is a rare
 * one-shot recompute across every employee/date, not a routine action any
 * Admin should reach for — a stricter gate than the payroll team's everyday
 * tools (e.g. /admin/tools/recompute-leave) is intentional here.
 */
export default async function BackfillLeaveLatePage() {
  await requireRole(['Superadmin']);

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader
        breadcrumb="เครื่องมือ"
        title="แก้ไขมาสายที่ทับซ้อนกับใบลา"
        subtitle="ลบ/ลดรายการ “มาสาย” ที่เกิดจากบั๊ก — วัดสายจาก 09:00 ทั้งที่พนักงานลาช่วงเช้าอนุมัติแล้ว"
      />

      <div className="mb-5 space-y-2 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <p>
          <strong>กด “ดูตัวอย่าง” ก่อนเสมอ</strong> แล้วตรวจรายการให้ครบก่อนกด “ยืนยันแก้ไข”
        </p>
        <ul className="list-disc space-y-0.5 pl-5 text-xs">
          <li>แก้เฉพาะทิศทางลดสายเท่านั้น — จะไม่มีทางเพิ่มนาทีสายให้ใคร</li>
          <li>ใบลาที่อยู่ในรอบเงินเดือนที่จ่ายแล้ว (Published/Locked) จะถูกข้าม ไม่แตะ</li>
          <li>การลบเป็น soft-delete (มี audit log) — กู้คืนได้จากประวัติ ไม่ใช่ลบถาวร</li>
        </ul>
      </div>

      <BackfillPanel />
    </div>
  );
}
