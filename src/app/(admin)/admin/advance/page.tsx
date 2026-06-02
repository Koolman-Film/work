/**
 * /admin/advance — cash-advance request inbox.
 *
 * Same shape as /admin/leave but without the date-range / working-day
 * expansion. Default filter is Pending. Ported to the shared Sapphire
 * Editorial system (PageHeader, tab-style filter chips, StatusBadge,
 * EmptyState, Card) so it reads identically to the leave inbox.
 */

import Link from 'next/link';
import { RestoreButton, VoidDialog } from '@/components/admin/void-dialog';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { StatusBadge, type StatusKey } from '@/components/ui/status-badge';
import { restoreCashAdvance, voidCashAdvance } from '@/lib/advance/void';
import { prisma, prismaRaw } from '@/lib/db/prisma';
import { signAttendancePhotoUrls } from '@/lib/storage/signed-urls';
import { AdvanceReviewPanel } from './advance-review-panel';

type SearchParams = Promise<{ status?: string; trash?: string }>;

const STATUS_INFO: Record<string, { label: string; key: StatusKey }> = {
  Pending: { label: 'รออนุมัติ', key: 'pending' },
  Approved: { label: 'อนุมัติแล้ว', key: 'approved' },
  Rejected: { label: 'ไม่อนุมัติ', key: 'rejected' },
  Cancelled: { label: 'ยกเลิก', key: 'cancelled' },
};

const FILTER_OPTIONS = [
  { value: '', label: 'รออนุมัติ' },
  { value: 'all', label: 'ทั้งหมด' },
  { value: 'approved', label: 'อนุมัติแล้ว' },
  { value: 'rejected', label: 'ไม่อนุมัติ' },
] as const;

function formatMoney(v: unknown): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('th-TH', {
    style: 'currency',
    currency: 'THB',
    maximumFractionDigits: 2,
  }).format(n);
}

function formatDateTime(d: Date): string {
  return d.toLocaleString('th-TH', {
    timeZone: 'Asia/Bangkok',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default async function AdminAdvanceInboxPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { status, trash } = await searchParams;
  const isTrash = trash === '1';

  const where = (() => {
    if (status === 'all') return {};
    if (status === 'approved') return { status: 'Approved' as const };
    if (status === 'rejected') return { status: 'Rejected' as const };
    return { status: 'Pending' as const };
  })();

  const advanceSelect = {
    id: true,
    amount: true,
    status: true,
    requestedAt: true,
    approvedAt: true,
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
      },
    },
  } as const;

  const rows = isTrash
    ? await prismaRaw.cashAdvance.findMany({
        where: { deletedAt: { not: null } },
        orderBy: { deletedAt: 'desc' },
        take: 100,
        select: advanceSelect,
      })
    : await prisma.cashAdvance.findMany({
        where,
        orderBy: { requestedAt: 'desc' },
        take: 100,
        select: advanceSelect,
      });

  // Batch-sign any receipt storage keys in one round-trip. Old rows
  // (or any admin-pasted Drive URLs from before A2) get pass-through.
  const receiptKeys = rows
    .map((r) => r.receiptUrl)
    .filter((v): v is string => !!v && v.length > 0 && !/^https?:\/\//i.test(v));
  const signedReceiptUrls = await signAttendancePhotoUrls(receiptKeys);

  /** Resolve a stored receipt value to its displayable URL — handles
   *  both Storage paths (signed) and legacy URLs (pass-through). */
  function resolveReceipt(value: string | null): string | null {
    if (!value) return null;
    if (/^https?:\/\//i.test(value)) return value;
    return signedReceiptUrls.get(value) ?? null;
  }

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader
        breadcrumb="คำขอเบิก"
        title="คำขอเบิก"
        subtitle="ตรวจสอบและอนุมัติคำขอเบิกเงินล่วงหน้า — อนุมัติแล้วระบบจะบันทึกผู้อนุมัติและเวลาโดยอัตโนมัติ"
      />

      {/* Filter chips + trash toggle */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {FILTER_OPTIONS.map((opt) => {
          const active = !isTrash && ((opt.value === '' && !status) || opt.value === status);
          return (
            <Link
              key={opt.value || 'pending'}
              href={opt.value ? `/admin/advance?status=${opt.value}` : '/admin/advance'}
              className={
                active
                  ? 'rounded-lg bg-primary-50 px-3 py-1.5 text-xs font-semibold text-primary-700 ring-1 ring-primary-200'
                  : 'rounded-lg px-3 py-1.5 text-xs font-semibold text-ink-4 hover:bg-gray-50 hover:text-ink-2'
              }
            >
              {opt.label}
            </Link>
          );
        })}
        <span className="mx-1 h-4 w-px bg-gray-200" aria-hidden="true" />
        <Link
          href="/admin/advance?trash=1"
          className={
            isTrash
              ? 'rounded-lg bg-primary-50 px-3 py-1.5 text-xs font-semibold text-primary-700 ring-1 ring-primary-200'
              : 'rounded-lg px-3 py-1.5 text-xs font-semibold text-ink-4 hover:bg-gray-50 hover:text-ink-2'
          }
        >
          🗑️ ถังขยะ
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            ทั้งหมด <span className="tabular-nums text-ink-3">({rows.length})</span>
          </CardTitle>
        </CardHeader>
        <CardBody className="!p-0">
          {rows.length === 0 ? (
            <EmptyState
              title={
                isTrash
                  ? 'ถังขยะว่าง'
                  : !status || status === 'pending'
                    ? 'ไม่มีคำขอเบิกที่รออนุมัติ ✨'
                    : 'ไม่มีรายการในตัวกรองนี้'
              }
              hint={isTrash ? 'ไม่มีคำขอเบิกที่ถูกลบ' : undefined}
            />
          ) : (
            <ul className="divide-y divide-gray-100">
              {rows.map((r) => {
                const info = STATUS_INFO[r.status] ?? {
                  label: r.status,
                  key: 'neutral' as StatusKey,
                };
                return (
                  <li key={r.id} className="px-5 py-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <StatusBadge status={info.key}>{info.label}</StatusBadge>
                          <p className="truncate text-sm font-medium text-ink-1">
                            {r.employee.firstName} {r.employee.lastName}
                            {r.employee.nickname && (
                              <span className="text-ink-3"> ({r.employee.nickname})</span>
                            )}
                          </p>
                        </div>
                        <p className="mt-1 text-xs text-ink-3">
                          {r.employee.branch.name}
                          {r.employee.department ? ` • ${r.employee.department.name}` : ''}
                        </p>
                        <p className="mt-0.5 text-[10px] text-ink-4">
                          ส่งเมื่อ {formatDateTime(r.requestedAt)}
                          {r.approvedAt && ` • ตัดสินใจเมื่อ ${formatDateTime(r.approvedAt)}`}
                        </p>
                      </div>
                      <div className="text-left sm:text-right">
                        <p className="display text-2xl font-semibold tabular-nums text-ink-1">
                          {formatMoney(r.amount)}
                        </p>
                      </div>
                    </div>

                    {isTrash ? (
                      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-gray-50 px-3 py-2 text-xs text-ink-3">
                        <span>
                          {r.deleteReason && (
                            <>
                              <strong className="text-ink-1">เหตุผลที่ลบ:</strong> {r.deleteReason}
                            </>
                          )}
                          {r.deletedAt && (
                            <span className="ml-2 text-ink-4">({formatDateTime(r.deletedAt)})</span>
                          )}
                        </span>
                        <RestoreButton
                          action={async () => {
                            'use server';
                            return restoreCashAdvance(r.id);
                          }}
                        />
                      </div>
                    ) : (
                      <>
                        {r.status === 'Pending' && (
                          <AdvanceReviewPanel
                            cashAdvanceId={r.id}
                            amountDisplay={formatMoney(r.amount)}
                          />
                        )}
                        {r.status === 'Approved' && resolveReceipt(r.receiptUrl) && (
                          <a
                            href={resolveReceipt(r.receiptUrl) ?? '#'}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-3 inline-block text-xs font-medium text-primary-700 underline hover:text-primary-800"
                          >
                            ดูใบเสร็จ →
                          </a>
                        )}
                        <div className="mt-2 flex justify-end">
                          <VoidDialog
                            triggerLabel="ลบ"
                            title="ลบคำขอเบิก"
                            description="คำขอนี้จะถูกย้ายไปถังขยะ และกู้คืนได้ภายหลัง"
                            action={async (reason) => {
                              'use server';
                              return voidCashAdvance(r.id, reason);
                            }}
                          />
                        </div>
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
