import 'server-only';

import type { StatusKey } from '@/components/ui/status-badge';
import { advanceBalanceFor } from '@/lib/advance/available';
import { isOverCap } from '@/lib/advance/balance';
import { isAwaitingPayment } from '@/lib/advance/payment-state';
import type { AdvanceGuardVM, AdvanceRowVM } from './advance-review-modal';

/** Prisma select covering every field `buildAdvanceRowVM` reads. */
export const ADVANCE_SELECT = {
  id: true,
  employeeId: true,
  amount: true,
  status: true,
  requestedAt: true,
  approvedAt: true,
  paidAt: true,
  receiptUrl: true,
  deletedAt: true,
  deleteReason: true,
  employee: {
    select: {
      firstName: true,
      lastName: true,
      nickname: true,
      branch: { select: { name: true } },
      department: { select: { name: true } },
      bankAccountNumber: true,
      bankAccountName: true,
      bank: { select: { nameTh: true, shortName: true } },
    },
  },
} as const;

/** Status → Thai label + badge key. Exported so the trash list reuses it. */
export const ADVANCE_STATUS_INFO: Record<string, { label: string; key: StatusKey }> = {
  Pending: { label: 'รออนุมัติ', key: 'pending' },
  Approved: { label: 'อนุมัติแล้ว', key: 'approved' },
  Rejected: { label: 'ไม่อนุมัติ', key: 'rejected' },
  Cancelled: { label: 'ยกเลิก', key: 'cancelled' },
};

export function formatAdvanceMoney(v: unknown): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('th-TH', {
    style: 'currency',
    currency: 'THB',
    maximumFractionDigits: 2,
  }).format(n);
}

export function formatAdvanceDateTime(d: Date): string {
  return d.toLocaleString('th-TH', {
    timeZone: 'Asia/Bangkok',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Shape required by buildAdvanceRowVM. Omits deletedAt/deleteReason — those are
 * trash-view fields accessed directly on the raw Prisma result, not by the builder.
 */
export type AdvanceRecord = {
  id: string;
  employeeId: string;
  amount: unknown; // Prisma.Decimal
  status: 'Pending' | 'Approved' | 'Rejected' | 'Cancelled';
  requestedAt: Date;
  approvedAt: Date | null;
  paidAt: Date | null;
  receiptUrl: string | null;
  employee: {
    firstName: string;
    lastName: string;
    nickname: string | null;
    branch: { name: string };
    department: { name: string } | null;
    bankAccountNumber: string | null;
    bankAccountName: string | null;
    bank: { nameTh: string; shortName: string | null } | null;
  };
};

/**
 * "Can this Pending advance be approved within the salary cap?" — the
 * number the review modal shows and the approveDisabled gate. Mirrors
 * leaveOverQuotaVM: computed server-side per Pending row (one Pending per
 * employee is enforced by a unique index, so this is ≈ one call per
 * employee with a live request). Non-Pending rows get null.
 *
 * Pass the advance's own id as excludeAdvanceId so the request being
 * decided doesn't count against itself.
 */
export async function advanceGuardVM(
  r: Pick<AdvanceRecord, 'id' | 'status' | 'employeeId' | 'amount'>,
): Promise<AdvanceGuardVM | null> {
  if (r.status !== 'Pending') return null;
  const balance = await advanceBalanceFor(r.employeeId, r.id);
  return {
    available: balance.available,
    overCap: isOverCap(Number(r.amount), balance.available),
  };
}

/**
 * Build the client-facing review VM for one cash-advance record.
 * Caller supplies the resolved receipt URL (page batches signing; the
 * single-record action signs one) and the cap guard (null for decided rows).
 */
export function buildAdvanceRowVM(
  r: AdvanceRecord,
  deps: { receiptUrl: string | null; advanceGuard: AdvanceGuardVM | null; canSeePayout: boolean },
): AdvanceRowVM {
  const info = ADVANCE_STATUS_INFO[r.status] ?? { label: r.status, key: 'neutral' as StatusKey };
  // "Approved" is two user-facing states, per the customer's two-step payment
  // request: อนุมัติ → รอจ่ายเงิน, then จ่ายเงินแล้ว. The predicate lives in
  // payment-state.ts so the label below and the modal's primary button read the
  // SAME decision — the inbox and the modal cannot disagree about the step.
  const awaitingPayment = isAwaitingPayment(r);
  const paid = r.status === 'Approved' && !awaitingPayment;
  const statusLabel = r.status === 'Approved' ? (paid ? 'จ่ายเงินแล้ว' : 'รอจ่ายเงิน') : info.label;
  return {
    id: r.id,
    status: r.status,
    statusKey: info.key,
    statusLabel,
    awaitingPayment,
    name: `${r.employee.firstName} ${r.employee.lastName}`,
    nickname: r.employee.nickname,
    branch: r.employee.branch.name,
    department: r.employee.department?.name ?? null,
    amount: formatAdvanceMoney(r.amount),
    submitted: formatAdvanceDateTime(r.requestedAt),
    decidedAt: r.approvedAt ? formatAdvanceDateTime(r.approvedAt) : null,
    receiptUrl: deps.receiptUrl,
    advanceGuard: deps.advanceGuard,
    bankName: r.employee.bank?.nameTh ?? r.employee.bank?.shortName ?? null,
    bankAccountNumber: r.employee.bankAccountNumber,
    bankAccountName: r.employee.bankAccountName,
    canSeePayout: deps.canSeePayout,
  };
}
