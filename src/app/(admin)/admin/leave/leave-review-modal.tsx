'use client';

import { ReviewModal } from '@/components/ui/review-modal';
import { STATUS_ICON, StatusBadge, type StatusKey } from '@/components/ui/status-badge';
import { approveLeaveRequest, rejectLeaveRequest } from '@/lib/leave/admin';
import { voidLeaveRequest } from '@/lib/leave/void';

export type LeaveRowVM = {
  id: string;
  status: 'Pending' | 'Approved' | 'Rejected' | 'Cancelled';
  statusKey: StatusKey;
  statusLabel: string;
  name: string;
  nickname: string | null;
  branch: string;
  department: string | null;
  leaveType: string;
  isPaid: boolean;
  range: string;
  workingDays: number;
  durationLabel: string;
  submitted: string;
  reason: string;
  reviewNote: string | null;
  reviewedAt: string | null;
  attachmentUrl: string | null;
};

function Badge({ row }: { row: LeaveRowVM }) {
  return (
    <StatusBadge status={row.statusKey}>
      {STATUS_ICON[row.statusKey] ?? ''} {row.statusLabel}
    </StatusBadge>
  );
}

/**
 * Review modal for a single leave request. `row === null` keeps it closed.
 * Shared by the leave inbox list and the admin calendar's day-detail panel.
 */
export function LeaveReviewModal({
  row,
  onClose,
}: {
  row: LeaveRowVM | null;
  onClose: () => void;
}) {
  const isPending = row?.status === 'Pending';
  return (
    <ReviewModal
      open={row !== null}
      onClose={onClose}
      title="ตรวจสอบคำขอลา"
      note={
        isPending
          ? { required: true, placeholder: 'เช่น: อนุมัติตามขอ / ปฏิเสธ — ไม่มีเอกสารแนบ' }
          : undefined
      }
      onApprove={
        isPending && row
          ? (n) => approveLeaveRequest({ leaveRequestId: row.id, note: n })
          : undefined
      }
      onReject={
        isPending && row
          ? (n) => rejectLeaveRequest({ leaveRequestId: row.id, note: n })
          : undefined
      }
      onVoid={row ? (reason) => voidLeaveRequest(row.id, reason) : undefined}
    >
      {row && <LeaveBody row={row} />}
    </ReviewModal>
  );
}

function LeaveBody({ row }: { row: LeaveRowVM }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Badge row={row} />
        <span className="text-sm font-medium text-ink-1">
          {row.name}
          {row.nickname && <span className="text-ink-3"> ({row.nickname})</span>}
        </span>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-lg bg-gray-50 p-4 text-sm">
        <div>
          <dt className="text-xs text-ink-4">ประเภท</dt>
          <dd className="font-medium text-ink-1">
            {row.leaveType}
            {row.isPaid ? '' : ' (ไม่จ่าย)'}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-ink-4">สังกัด</dt>
          <dd className="text-ink-2">
            {row.branch}
            {row.department ? ` • ${row.department}` : ''}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-ink-4">ช่วงวันที่</dt>
          <dd className="text-ink-2">{row.range}</dd>
        </div>
        <div>
          <dt className="text-xs text-ink-4">เวลาที่จะบันทึก</dt>
          <dd className="font-medium text-ink-1">{row.durationLabel}</dd>
        </div>
      </dl>
      {row.status === 'Pending' && row.workingDays === 0 && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
          ⚠ ไม่มีวันทำงานในช่วงที่ขอ (วันอาทิตย์/วันหยุดทั้งหมด) — การอนุมัติจะไม่สร้างรายการลงเวลา
        </p>
      )}
      <div>
        <p className="text-xs font-medium text-ink-4">เหตุผลของพนักงาน</p>
        <p className="mt-1 whitespace-pre-wrap text-sm text-ink-2">{row.reason}</p>
      </div>
      {row.attachmentUrl && (
        <div>
          <p className="text-xs font-medium text-ink-4">ไฟล์แนบ (ใบรับรองแพทย์ ฯลฯ)</p>
          <a
            href={row.attachmentUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 inline-block overflow-hidden rounded-lg border border-gray-200 transition hover:opacity-90"
          >
            {/* biome-ignore lint/performance/noImgElement: signed-URL preview */}
            <img
              src={row.attachmentUrl}
              alt="ไฟล์แนบ"
              className="block h-28 w-28 object-cover"
              loading="lazy"
            />
          </a>
        </div>
      )}
      {row.status !== 'Pending' && row.reviewNote && (
        <div className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-ink-2">
          <strong className="text-ink-1">หมายเหตุ:</strong> {row.reviewNote}
          {row.reviewedAt && <span className="ml-2 text-ink-4">({row.reviewedAt})</span>}
        </div>
      )}
    </div>
  );
}
