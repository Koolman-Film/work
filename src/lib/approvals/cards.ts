import { formatTHB2, formatThaiDate } from '@/lib/format';
import { haversineMeters } from '@/lib/geo/distance';

type EmployeeShape = {
  firstName: string;
  lastName: string;
  nickname: string | null;
  branchId: string;
  branch: { name: string };
  department: { name: string } | null;
};

export type LeaveCardInput = {
  id: string;
  createdAt: Date;
  startDate: Date;
  endDate: Date;
  leaveType: { name: string };
  employee: EmployeeShape;
};

export type AdvanceCardInput = {
  id: string;
  amount: number | { toString(): string };
  requestedAt: Date;
  employee: EmployeeShape;
};

export type DisputedCardInput = {
  id: string;
  clockInAt: Date;
  checkInLat: number | { toString(): string } | null;
  checkInLng: number | { toString(): string } | null;
  disputeReason: string | null;
  checkInBranch: { latitude: number | { toString(): string }; longitude: number | { toString(): string } };
  employee: EmployeeShape;
};

type CardBase = {
  id: string;
  employeeName: string;
  nickname: string | null;
  branch: string;
  branchId: string;
  department: string | null;
  submittedAt: Date;
};

export type ApprovalCard =
  | (CardBase & { type: 'leave'; leaveType: string; range: string })
  | (CardBase & { type: 'advance'; amount: string })
  | (CardBase & { type: 'disputed'; clockInLabel: string; distanceMeters: number | null; reason: string });

export type ApprovalFilters = { type?: string; branchId?: string; q?: string };

function base(e: EmployeeShape, id: string, submittedAt: Date): CardBase {
  return {
    id,
    employeeName: `${e.firstName} ${e.lastName}`,
    nickname: e.nickname,
    branch: e.branch.name,
    branchId: e.branchId,
    department: e.department?.name ?? null,
    submittedAt,
  };
}

const num = (v: number | { toString(): string }): number =>
  typeof v === 'number' ? v : Number(v.toString());

export function mapLeaveCard(r: LeaveCardInput): ApprovalCard {
  const range =
    r.startDate.getTime() === r.endDate.getTime()
      ? formatThaiDate(r.startDate)
      : `${formatThaiDate(r.startDate)} – ${formatThaiDate(r.endDate)}`;
  return { ...base(r.employee, r.id, r.createdAt), type: 'leave', leaveType: r.leaveType.name, range };
}

export function mapAdvanceCard(r: AdvanceCardInput): ApprovalCard {
  return { ...base(r.employee, r.id, r.requestedAt), type: 'advance', amount: formatTHB2(num(r.amount)) };
}

export function mapDisputedCard(r: DisputedCardInput): ApprovalCard {
  const distanceMeters =
    r.checkInLat !== null && r.checkInLng !== null
      ? haversineMeters(
          num(r.checkInLat),
          num(r.checkInLng),
          num(r.checkInBranch.latitude),
          num(r.checkInBranch.longitude),
        )
      : null;
  const clockInLabel = r.clockInAt.toLocaleTimeString('th-TH', {
    timeZone: 'Asia/Bangkok',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return {
    ...base(r.employee, r.id, r.clockInAt),
    type: 'disputed',
    clockInLabel,
    distanceMeters,
    reason: r.disputeReason ?? 'ไม่ระบุ',
  };
}

function clean(v: string | undefined): string | undefined {
  const t = v?.trim();
  return t ? t : undefined;
}

export function filterApprovalCards(cards: ApprovalCard[], f: ApprovalFilters): ApprovalCard[] {
  const type = clean(f.type);
  const branchId = clean(f.branchId);
  const q = clean(f.q)?.toLowerCase();
  return cards.filter((c) => {
    if (type && c.type !== type) return false;
    if (branchId && c.branchId !== branchId) return false;
    if (q) {
      const hay = `${c.employeeName} ${c.nickname ?? ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

export function sortApprovalCardsDesc(cards: ApprovalCard[]): ApprovalCard[] {
  return [...cards].sort((a, b) => b.submittedAt.getTime() - a.submittedAt.getTime());
}
