/**
 * /admin/advance — cash-advance request inbox.
 *
 * Same shape as /admin/leave: Pending-by-default with status filter chips +
 * a trash view. Each row is a button opening the shared ReviewModal — the
 * pending modal offers an optional receipt upload + a money-confirm approve,
 * plus reject and void; decided rows are read-only (with a receipt link).
 */

import type { Prisma } from '@prisma/client';
import Link from 'next/link';
import { RestoreButton } from '@/components/admin/void-dialog';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { ListSearch } from '@/components/ui/list-search';
import { PageHeader } from '@/components/ui/page-header';
import { Pagination } from '@/components/ui/pagination';
import { StatusBadge, type StatusKey } from '@/components/ui/status-badge';
import { restoreCashAdvance } from '@/lib/advance/void';
import { requirePermission } from '@/lib/auth/check-permission';
import { prisma, prismaRaw } from '@/lib/db/prisma';
import { buildPageMeta, pageArgs, parsePageParam } from '@/lib/pagination';
import { signAttendancePhotoUrls } from '@/lib/storage/signed-urls';
import { AdvanceInbox, type AdvanceRowVM } from './advance-inbox';
import {
  ADVANCE_SELECT,
  ADVANCE_STATUS_INFO,
  advanceGuardVM,
  buildAdvanceRowVM,
  formatAdvanceDateTime,
  formatAdvanceMoney,
} from './advance-row-vm';

type SearchParams = Promise<{ status?: string; trash?: string; q?: string; page?: string }>;

const FILTER_OPTIONS = [
  { value: '', label: 'รออนุมัติ' },
  { value: 'all', label: 'ทั้งหมด' },
  { value: 'approved', label: 'อนุมัติแล้ว' },
  { value: 'rejected', label: 'ไม่อนุมัติ' },
] as const;

export default async function AdminAdvanceInboxPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  await requirePermission('advance.read');
  const { status, trash, q: qRaw, page: pageRaw } = await searchParams;
  const isTrash = trash === '1';
  const q = qRaw?.trim() ?? '';
  const requestedPage = parsePageParam(pageRaw);

  // Status filter → base where; an employee-name search (q) narrows on top.
  const where: Prisma.CashAdvanceWhereInput = (() => {
    if (status === 'all') return {};
    if (status === 'approved') return { status: 'Approved' };
    if (status === 'rejected') return { status: 'Rejected' };
    return { status: 'Pending' };
  })();
  if (q) {
    where.employee = {
      OR: [
        { firstName: { contains: q, mode: 'insensitive' } },
        { lastName: { contains: q, mode: 'insensitive' } },
        { nickname: { contains: q, mode: 'insensitive' } },
      ],
    };
  }

  const trashWhere = { deletedAt: { not: null } } as const;
  const { skip, take } = pageArgs(requestedPage);

  // Page of rows + matching total go through the same client: trash uses
  // prismaRaw (sees soft-deleted), the live inbox uses soft-delete-filtered
  // prisma. count mirrors findMany's where exactly.
  const [rows, total] = await Promise.all([
    isTrash
      ? prismaRaw.cashAdvance.findMany({
          where: trashWhere,
          orderBy: { deletedAt: 'desc' },
          skip,
          take,
          select: ADVANCE_SELECT,
        })
      : prisma.cashAdvance.findMany({
          where,
          orderBy: { requestedAt: 'desc' },
          skip,
          take,
          select: ADVANCE_SELECT,
        }),
    isTrash
      ? prismaRaw.cashAdvance.count({ where: trashWhere })
      : prisma.cashAdvance.count({ where }),
  ]);

  const meta = buildPageMeta(total, requestedPage);

  // List URL preserving active status + search; resets page unless given.
  function listHref(overrides: { status?: string; page?: number }): string {
    const params = new URLSearchParams();
    if (isTrash) {
      // Trash is its own view (no status/search chips); only paging applies.
      params.set('trash', '1');
    } else {
      const nextStatus = overrides.status !== undefined ? overrides.status : status;
      if (nextStatus) params.set('status', nextStatus);
      if (q) params.set('q', q);
    }
    if (overrides.page && overrides.page > 1) params.set('page', String(overrides.page));
    const qs = params.toString();
    return qs ? `/admin/advance?${qs}` : '/admin/advance';
  }

  const receiptKeys = rows
    .map((r) => r.receiptUrl)
    .filter((v): v is string => !!v && v.length > 0 && !/^https?:\/\//i.test(v));
  const signedReceiptUrls = await signAttendancePhotoUrls(receiptKeys);
  function resolveReceipt(value: string | null): string | null {
    if (!value) return null;
    if (/^https?:\/\//i.test(value)) return value;
    return signedReceiptUrls.get(value) ?? null;
  }

  // advanceGuardVM only does work for Pending rows (decided rows → null), and
  // one-Pending-per-employee is index-enforced, so this is ≈ one balance read
  // per employee with a live request — fine for a 100-row page.
  const vm: AdvanceRowVM[] = isTrash
    ? []
    : await Promise.all(
        rows.map(async (r) =>
          buildAdvanceRowVM(r, {
            receiptUrl: resolveReceipt(r.receiptUrl),
            advanceGuard: await advanceGuardVM(r),
          }),
        ),
      );

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader
        breadcrumb="คำขอเบิก"
        title="คำขอเบิก"
        subtitle="ตรวจสอบและอนุมัติคำขอเบิกเงินล่วงหน้า — อนุมัติแล้วระบบจะบันทึกผู้อนุมัติและเวลาโดยอัตโนมัติ"
      />

      {/* Name search — narrows the current status view (live inbox only). */}
      {!isTrash && (
        <div className="mb-3">
          <ListSearch
            basePath="/admin/advance"
            defaultValue={q}
            placeholder="ค้นหาชื่อพนักงาน"
            keep={{ status }}
          />
        </div>
      )}

      {/* Filter chips + trash toggle */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {FILTER_OPTIONS.map((opt) => {
          const active = !isTrash && ((opt.value === '' && !status) || opt.value === status);
          return (
            <Link
              key={opt.value || 'pending'}
              href={listHref({ status: opt.value })}
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
        {/* Record an advance on behalf of an employee who can't use LIFF
            (e.g. broken phone). Creates a Pending request to approve here. */}
        <Link
          href="/admin/advance/new"
          className="ml-auto rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-primary-700"
        >
          + บันทึกการเบิก (แทนพนักงาน)
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            ทั้งหมด <span className="tabular-nums text-ink-3">({meta.total})</span>
          </CardTitle>
        </CardHeader>
        <CardBody className="!p-0">
          {rows.length === 0 ? (
            <EmptyState
              title={
                isTrash
                  ? 'ถังขยะว่าง'
                  : q
                    ? 'ไม่พบรายการที่ตรงกับการค้นหา'
                    : !status || status === 'pending'
                      ? 'ไม่มีคำขอเบิกที่รออนุมัติ ✨'
                      : 'ไม่มีรายการในตัวกรองนี้'
              }
              hint={isTrash ? 'ไม่มีคำขอเบิกที่ถูกลบ' : undefined}
            />
          ) : isTrash ? (
            <ul className="divide-y divide-gray-100">
              {rows.map((r) => {
                const info = ADVANCE_STATUS_INFO[r.status] ?? {
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
                          ส่งเมื่อ {formatAdvanceDateTime(r.requestedAt)}
                        </p>
                      </div>
                      <div className="text-left sm:text-right">
                        <p className="display text-2xl font-semibold tabular-nums text-ink-1">
                          {formatAdvanceMoney(r.amount)}
                        </p>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-gray-50 px-3 py-2 text-xs text-ink-3">
                      <span>
                        {r.deleteReason && (
                          <>
                            <strong className="text-ink-1">เหตุผลที่ลบ:</strong> {r.deleteReason}
                          </>
                        )}
                        {r.deletedAt && (
                          <span className="ml-2 text-ink-4">
                            ({formatAdvanceDateTime(r.deletedAt)})
                          </span>
                        )}
                      </span>
                      <RestoreButton
                        action={async () => {
                          'use server';
                          return restoreCashAdvance(r.id);
                        }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <AdvanceInbox rows={vm} />
          )}
        </CardBody>
      </Card>

      <Pagination meta={meta} makeHref={(p) => listHref({ page: p })} className="mt-4" />
    </div>
  );
}
