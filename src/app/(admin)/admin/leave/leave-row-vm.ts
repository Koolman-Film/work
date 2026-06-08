import 'server-only';

import type { StatusKey } from '@/components/ui/status-badge';
import type { LeaveRowVM } from './leave-review-modal';

/** Prisma select covering every field `buildLeaveRowVM` reads. */
export const LEAVE_SELECT = {
  id: true,
  startDate: true,
  endDate: true,
  reason: true,
  status: true,
  reviewNote: true,
  reviewedAt: true,
  createdAt: true,
  attachmentUrl: true,
  deletedAt: true,
  deleteReason: true,
  leaveType: { select: { name: true, isPaid: true } },
  employee: {
    select: {
      firstName: true,
      lastName: true,
      nickname: true,
      branch: { select: { name: true } },
      department: { select: { name: true } },
    },
  },
} as const;

/** Status → Thai label + badge key. Exported so the trash list reuses it. */
export const LEAVE_STATUS_INFO: Record<string, { label: string; key: StatusKey }> = {
  Pending: { label: 'รออนุมัติ', key: 'pending' },
  Approved: { label: 'อนุมัติแล้ว', key: 'approved' },
  Rejected: { label: 'ไม่อนุมัติ', key: 'rejected' },
  Cancelled: { label: 'ยกเลิก', key: 'cancelled' },
};

export function formatLeaveRange(start: Date, end: Date): string {
  const opts: Intl.DateTimeFormatOptions = {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  };
  const same =
    start.getUTCFullYear() === end.getUTCFullYear() &&
    start.getUTCMonth() === end.getUTCMonth() &&
    start.getUTCDate() === end.getUTCDate();
  if (same) return start.toLocaleDateString('th-TH', opts);
  return `${start.toLocaleDateString('th-TH', { ...opts, year: undefined })} – ${end.toLocaleDateString(
    'th-TH',
    opts,
  )}`;
}

export function formatLeaveDateTime(d: Date): string {
  return d.toLocaleString('th-TH', {
    timeZone: 'Asia/Bangkok',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Shape returned by a Prisma findMany/findUnique using LEAVE_SELECT. */
export type LeaveRecord = {
  id: string;
  startDate: Date;
  endDate: Date;
  reason: string;
  status: 'Pending' | 'Approved' | 'Rejected' | 'Cancelled';
  reviewNote: string | null;
  reviewedAt: Date | null;
  createdAt: Date;
  attachmentUrl: string | null;
  leaveType: { name: string; isPaid: boolean };
  employee: {
    firstName: string;
    lastName: string;
    nickname: string | null;
    branch: { name: string };
    department: { name: string } | null;
  };
};

/**
 * Build the client-facing review VM for one leave record.
 * Callers supply the resolved attachment URL + working-day count so this stays
 * synchronous and free of storage/db imports (the page batches signing; the
 * single-record action signs one).
 */
export function buildLeaveRowVM(
  r: LeaveRecord,
  deps: { attachmentUrl: string | null; workingDays: number },
): LeaveRowVM {
  const info = LEAVE_STATUS_INFO[r.status] ?? { label: r.status, key: 'neutral' as StatusKey };
  return {
    id: r.id,
    status: r.status,
    statusKey: info.key,
    statusLabel: info.label,
    name: `${r.employee.firstName} ${r.employee.lastName}`,
    nickname: r.employee.nickname,
    branch: r.employee.branch.name,
    department: r.employee.department?.name ?? null,
    leaveType: r.leaveType.name,
    isPaid: r.leaveType.isPaid,
    range: formatLeaveRange(r.startDate, r.endDate),
    workingDays: deps.workingDays,
    submitted: formatLeaveDateTime(r.createdAt),
    reason: r.reason,
    reviewNote: r.reviewNote ?? null,
    reviewedAt: r.reviewedAt ? formatLeaveDateTime(r.reviewedAt) : null,
    attachmentUrl: deps.attachmentUrl,
  };
}
