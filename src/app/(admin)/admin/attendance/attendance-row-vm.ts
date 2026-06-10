import 'server-only';

import type { Prisma } from '@prisma/client';
import { haversineMeters } from '@/lib/attendance/haversine';

/**
 * Server-side view-model for one row of the /admin/attendance records table
 * and its detail modal. Mirrors the advance-row-vm pattern: the page fetches
 * with RECORD_SELECT, signs selfie URLs in batch, then builds a fully
 * serializable VM (preformatted Thai strings, plain numbers) for the client.
 */

export const TYPE_LABELS: Record<string, { label: string; cls: string }> = {
  CheckIn: { label: 'เช็คอิน', cls: 'bg-green-100 text-green-800' },
  CheckOut: { label: 'เช็คเอาท์', cls: 'bg-blue-100 text-blue-800' },
  Late: { label: 'มาสาย', cls: 'bg-amber-100 text-amber-800' },
  EarlyLeave: { label: 'ออกก่อน', cls: 'bg-amber-100 text-amber-800' },
  Absent: { label: 'ขาดงาน', cls: 'bg-red-100 text-red-800' },
  OnLeave: { label: 'ลา', cls: 'bg-primary-100 text-primary-800' },
};

export const SOURCE_LABELS: Record<string, string> = {
  Liff: 'LINE',
  Excel: 'Excel',
  Manual: 'คีย์มือ',
  Both: 'Liff+Excel',
};

const CHECKIN_STATUS_LABELS: Record<string, string> = {
  Confirmed: 'ผ่านการตรวจ',
  Disputed: 'รอตรวจสอบ',
  Rejected: 'ไม่อนุมัติ',
};

/** Prisma select covering every field `buildAttendanceRowVM` reads. */
export const RECORD_SELECT = {
  id: true,
  date: true,
  type: true,
  source: true,
  durationMinutes: true,
  clockInAt: true,
  clockOutAt: true,
  checkInLat: true,
  checkInLng: true,
  checkInSelfieUrl: true,
  checkInStatus: true,
  disputeReason: true,
  isOverridden: true,
  overrideNote: true,
  deductAmount: true,
  createdAt: true,
  deletedAt: true,
  deleteReason: true,
  employee: {
    select: {
      firstName: true,
      lastName: true,
      nickname: true,
      branch: { select: { name: true } },
      department: { select: { name: true } },
    },
  },
  checkInBranch: {
    select: { name: true, latitude: true, longitude: true, radiusMeters: true },
  },
} as const;

export type AttendanceRecord = Prisma.AttendanceGetPayload<{ select: typeof RECORD_SELECT }>;

export type AttendanceRowVM = {
  id: string;
  /** Raw enum value — drives conditional sections (e.g. evidence for CheckIn). */
  type: string;
  typeLabel: string;
  typeCls: string;
  isDisputed: boolean;
  checkInStatusLabel: string | null;
  dateLabel: string;
  name: string;
  nickname: string | null;
  branchDeptLabel: string;
  /** "08:01 – 17:05" for CheckIn/CheckOut rows, null otherwise. */
  timeLabel: string | null;
  clockInLabel: string | null;
  clockOutLabel: string | null;
  durationLabel: string;
  sourceLabel: string;
  checkInBranchName: string | null;
  disputeReason: string | null;
  overrideNote: string | null;
  deductLabel: string | null;
  createdAtLabel: string;
  // Check-in evidence (selfie pre-signed by the page, geofence vs position)
  selfieUrl: string | null;
  empLat: number | null;
  empLng: number | null;
  geofence: { name: string; lat: number; lng: number; radiusMeters: number } | null;
  distanceMeters: number | null;
  // Trash view
  deletedAtLabel: string | null;
  deleteReason: string | null;
};

function formatDate(d: Date): string {
  return d.toLocaleDateString('th-TH', { timeZone: 'UTC', day: 'numeric', month: 'short' });
}

function formatTime(d: Date | null): string {
  if (!d) return '—';
  return d.toLocaleTimeString('th-TH', {
    timeZone: 'Asia/Bangkok',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatBkkDateTime(d: Date): string {
  return d.toLocaleString('th-TH', {
    timeZone: 'Asia/Bangkok',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDuration(min: number | null): string {
  if (min == null) return '—';
  if (min < 60) return `${min} นาที`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h} ชม.` : `${h} ชม. ${m} นาที`;
}

function formatMoney(v: unknown): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('th-TH', {
    style: 'currency',
    currency: 'THB',
    maximumFractionDigits: 2,
  }).format(n);
}

/**
 * Build the client-facing VM for one attendance record. Caller supplies the
 * resolved selfie URL (the page batch-signs all keys in one Storage call).
 */
export function buildAttendanceRowVM(
  r: AttendanceRecord,
  deps: { selfieUrl: string | null },
): AttendanceRowVM {
  const typeInfo = TYPE_LABELS[r.type] ?? { label: r.type, cls: 'bg-gray-100 text-gray-700' };
  const isClock = r.type === 'CheckIn' || r.type === 'CheckOut';

  const empLat = r.checkInLat != null ? Number(r.checkInLat) : null;
  const empLng = r.checkInLng != null ? Number(r.checkInLng) : null;
  const geofence =
    r.checkInBranch?.latitude != null && r.checkInBranch.longitude != null
      ? {
          name: r.checkInBranch.name,
          lat: Number(r.checkInBranch.latitude),
          lng: Number(r.checkInBranch.longitude),
          radiusMeters: r.checkInBranch.radiusMeters,
        }
      : null;
  const distanceMeters =
    empLat != null && empLng != null && geofence
      ? Math.round(haversineMeters(empLat, empLng, geofence.lat, geofence.lng))
      : null;

  return {
    id: r.id,
    type: r.type,
    typeLabel: typeInfo.label,
    typeCls: typeInfo.cls,
    isDisputed: r.checkInStatus === 'Disputed',
    checkInStatusLabel: r.checkInStatus ? (CHECKIN_STATUS_LABELS[r.checkInStatus] ?? null) : null,
    dateLabel: formatDate(r.date),
    name: `${r.employee.firstName} ${r.employee.lastName}`,
    nickname: r.employee.nickname,
    branchDeptLabel: `${r.employee.branch.name}${r.employee.department ? ` • ${r.employee.department.name}` : ''}`,
    timeLabel: isClock
      ? `${formatTime(r.clockInAt)}${r.clockOutAt ? ` – ${formatTime(r.clockOutAt)}` : ''}`
      : null,
    clockInLabel: r.clockInAt ? formatTime(r.clockInAt) : null,
    clockOutLabel: r.clockOutAt ? formatTime(r.clockOutAt) : null,
    durationLabel: formatDuration(r.durationMinutes),
    sourceLabel: SOURCE_LABELS[r.source] ?? r.source,
    checkInBranchName: r.checkInBranch?.name ?? null,
    disputeReason: r.disputeReason,
    overrideNote: r.isOverridden ? (r.overrideNote ?? '') : null,
    deductLabel: r.deductAmount != null ? formatMoney(r.deductAmount) : null,
    createdAtLabel: formatBkkDateTime(r.createdAt),
    selfieUrl: deps.selfieUrl,
    empLat,
    empLng,
    geofence,
    distanceMeters,
    deletedAtLabel: r.deletedAt ? formatBkkDateTime(r.deletedAt) : null,
    deleteReason: r.deleteReason,
  };
}
