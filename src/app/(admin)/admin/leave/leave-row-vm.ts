import 'server-only';

import type { StatusKey } from '@/components/ui/status-badge';
import { overQuotaPreview } from '@/lib/leave/approval-preview';
import {
  formatDaysHours,
  type LeaveUnit,
  type LeaveUnitConfig,
  leaveDurationLabel,
  segmentFor,
  standardDayMinutes,
} from '@/lib/leave/units';
import type { LeaveOverQuotaVM, LeaveRowVM } from './leave-review-modal';

/** Prisma select covering every field `buildLeaveRowVM` reads. */
export const LEAVE_SELECT = {
  id: true,
  employeeId: true,
  leaveTypeId: true,
  startDate: true,
  endDate: true,
  unit: true,
  startTime: true,
  endTime: true,
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
  employeeId: string;
  leaveTypeId: string;
  startDate: Date;
  endDate: Date;
  unit: LeaveUnit;
  startTime: string | null;
  endTime: string | null;
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
/**
 * Compute the over-quota preview VM for one PENDING record (null otherwise —
 * decided rows are read-only, so the 4-5 preview queries would be wasted).
 * The charge estimate mirrors `leaveDurationLabel`: per-day segment minutes ×
 * working days, falling back to the standard day when the stored times are
 * invalid. The server action (`approveLeaveRequest`) remains the real guard.
 */
export async function leaveOverQuotaVM(
  r: Pick<
    LeaveRecord,
    'status' | 'employeeId' | 'leaveTypeId' | 'unit' | 'startTime' | 'endTime' | 'startDate'
  >,
  workingDays: number,
  cfg: LeaveUnitConfig,
): Promise<LeaveOverQuotaVM | null> {
  if (r.status !== 'Pending') return null;
  const seg = segmentFor(r.unit, cfg, r.startTime, r.endTime);
  const chargedMinutes = (seg?.minutes ?? standardDayMinutes(cfg)) * workingDays;
  const p = await overQuotaPreview(
    r.employeeId,
    r.leaveTypeId,
    r.startDate.getUTCFullYear(),
    chargedMinutes,
  );
  return {
    policy: p.policy,
    remainingLabel:
      p.remaining === null ? 'ไม่จำกัด' : formatDaysHours(Math.max(0, p.remaining), cfg),
    overLabel: p.overQuotaMinutes > 0 ? formatDaysHours(p.overQuotaMinutes, cfg) : null,
    estimatedDeduction: p.estimatedDeduction,
    blocksApproval: p.policy === 'Block' && p.overQuotaMinutes > 0,
  };
}

export function buildLeaveRowVM(
  r: LeaveRecord,
  deps: {
    attachmentUrl: string | null;
    workingDays: number;
    cfg: LeaveUnitConfig;
    overQuota: LeaveOverQuotaVM | null;
  },
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
    durationLabel: leaveDurationLabel(r.unit, deps.workingDays, deps.cfg, r.startTime, r.endTime),
    submitted: formatLeaveDateTime(r.createdAt),
    reason: r.reason,
    reviewNote: r.reviewNote ?? null,
    reviewedAt: r.reviewedAt ? formatLeaveDateTime(r.reviewedAt) : null,
    attachmentUrl: deps.attachmentUrl,
    overQuota: deps.overQuota,
  };
}
