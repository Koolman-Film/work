'use client';

import Link from 'next/link';
import { ReviewModal } from '@/components/ui/review-modal';
import { approveDisputed, rejectDisputed } from '@/lib/attendance/admin-review';
import type { DisputedReviewVM } from './disputed-review';

export function DisputedReviewModalLite({
  row,
  onClose,
}: {
  row: DisputedReviewVM | null;
  onClose: () => void;
}) {
  return (
    <ReviewModal
      open={row !== null}
      onClose={onClose}
      title="ตรวจสอบการลงเวลา"
      note={{ required: true, placeholder: 'เช่น: อยู่นอกพื้นที่แต่มีเหตุจำเป็น — อนุมัติ' }}
      onApprove={row ? (n) => approveDisputed({ attendanceId: row.id, note: n }) : undefined}
      onReject={row ? (n) => rejectDisputed({ attendanceId: row.id, note: n }) : undefined}
    >
      {row && (
        <div className="space-y-2 text-sm">
          <div className="font-medium text-ink-1">
            {row.name}
            {row.nickname && <span className="text-ink-3"> ({row.nickname})</span>}
          </div>
          <div className="text-ink-3">สาขา: {row.branch}</div>
          <div className="text-ink-3">เวลาเข้างาน: {row.clockInLabel}</div>
          <div className="text-ink-3">
            ระยะห่างจากสาขา: {row.distanceMeters === null ? '—' : `${row.distanceMeters} ม.`}
          </div>
          <div className="text-ink-3">เหตุผลระบบ: {row.reason}</div>
          {row.selfieUrl && (
            // biome-ignore lint/performance/noImgElement: signed-URL preview
            <img src={row.selfieUrl} alt="selfie" className="mt-2 max-h-48 rounded-lg" />
          )}
          <Link
            href="/admin/attendance/disputed"
            className="inline-block pt-1 text-primary-700 hover:text-primary-800"
          >
            ดูแผนที่ / ดูรายละเอียดเต็ม →
          </Link>
        </div>
      )}
    </ReviewModal>
  );
}
