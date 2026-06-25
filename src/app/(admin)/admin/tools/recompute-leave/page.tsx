import { PageHeader } from '@/components/ui/page-header';
import { requirePermission } from '@/lib/auth/check-permission';
import { RecomputePanel } from './recompute-panel';

/**
 * Maintenance tool — recompute leave charged-minutes + over-quota deductions so
 * the frozen snapshot matches the current entitlement. Gated on payroll.publish
 * (it changes deduction amounts). Run "Preview" first and review the diff.
 */
export default async function RecomputeLeavePage() {
  await requirePermission('payroll.publish');

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader
        breadcrumb="เครื่องมือ"
        title="คำนวณการหักวันลาใหม่"
        subtitle="ปรับ “ใช้ไป / เกินสิทธิ / หักเงิน” ของใบลาที่อนุมัติแล้ว ให้ตรงกับสิทธิวันลาปัจจุบัน"
      />

      <div className="mb-5 max-w-3xl space-y-2 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <p>
          <strong>กด “ดูตัวอย่าง” ก่อนเสมอ</strong> แล้วตรวจรายการให้ครบ — โดยเฉพาะรายการที่
          <strong> หักเงินเพิ่มขึ้น (สีแดง)</strong>
        </p>
        <ul className="list-disc space-y-0.5 pl-5 text-xs">
          <li>
            เครื่องมือนี้ใช้ <strong>สิทธิวันลาปัจจุบัน</strong> — ถ้ายังตั้งค่าสิทธิ/ปรับปรุงไม่ถูก ให้แก้ที่หน้าพนักงานก่อน
          </li>
          <li>ใบลาที่อยู่ในรอบเงินเดือนที่จ่ายแล้วจะถูกข้าม (ไม่แก้)</li>
          <li>หลังยืนยัน ให้กด “คำนวณใหม่” ในหน้าเงินเดือนเพื่อให้ยอดอัปเดต</li>
        </ul>
      </div>

      <RecomputePanel />
    </div>
  );
}
