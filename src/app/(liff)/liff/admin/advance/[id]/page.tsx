/**
 * /liff/admin/advance/[id] — mobile advance review + slip attach.
 *
 * Three states:
 *   Pending                 → approve / reject (client actions)
 *   Approved && paidAt=null → slip upload block (client)
 *   paidAt != null          → slip display + re-upload
 *
 * Balance context comes from advanceBalanceFor — the same helper the web
 * review modal's guard uses, so the numbers can never disagree.
 */

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { advanceBalanceFor } from '@/lib/advance/available';
import { isOverCap } from '@/lib/advance/balance';
import { requireLiffAdmin } from '@/lib/auth/require-liff-admin';
import { prisma } from '@/lib/db/prisma';
import { resolveStoredImageUrl } from '@/lib/storage/signed-urls';
import { AdvanceReviewActions, SlipUploadBlock } from './advance-review-actions';

type Params = Promise<{ id: string }>;

const STATUS_INFO: Record<string, { label: string; cls: string }> = {
  Pending: { label: 'รออนุมัติ', cls: 'bg-amber-100 text-amber-800' },
  Approved: { label: 'อนุมัติแล้ว', cls: 'bg-green-100 text-green-800' },
  Rejected: { label: 'ไม่อนุมัติ', cls: 'bg-red-100 text-red-800' },
  Cancelled: { label: 'ยกเลิก', cls: 'bg-gray-100 text-gray-700' },
};

function formatBkk(d: Date): string {
  return d.toLocaleString('th-TH', {
    timeZone: 'Asia/Bangkok',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function baht(n: number): string {
  return `฿${n.toLocaleString('th-TH')}`;
}

export default async function LiffAdminAdvanceDetailPage({ params }: { params: Params }) {
  const { id } = await params;
  await requireLiffAdmin();

  const row = await prisma.cashAdvance.findUnique({
    where: { id },
    select: {
      id: true,
      employeeId: true,
      amount: true,
      status: true,
      requestedAt: true,
      approvedAt: true,
      paidAt: true,
      receiptUrl: true,
      isDeducted: true,
      deletedAt: true,
      employee: { select: { firstName: true, lastName: true, nickname: true } },
    },
  });
  if (!row || row.deletedAt) notFound();

  // Exclude this advance from "reserved" when it's still Pending — same as
  // the web approval guard (it shouldn't count against itself).
  const balance = await advanceBalanceFor(
    row.employeeId,
    row.status === 'Pending' ? row.id : undefined,
  );
  const amount = Number(row.amount);
  const overCap = row.status === 'Pending' && isOverCap(amount, balance.available);

  const info = STATUS_INFO[row.status] ?? { label: row.status, cls: 'bg-gray-100 text-gray-700' };
  const name = `${row.employee.firstName} ${row.employee.lastName}`.trim();

  // receiptUrl: storage key → signed URL (renderable <img>); legacy
  // http(s) URL → passthrough, rendered as a plain link (no hotlinking).
  const receiptIsExternal = !!row.receiptUrl && /^https?:\/\//i.test(row.receiptUrl);
  const resolvedReceiptUrl = await resolveStoredImageUrl(row.receiptUrl);

  const awaitingSlip = row.status === 'Approved' && row.paidAt === null;
  const paid = row.paidAt !== null;

  return (
    <main className="px-4 pt-4 pb-12">
      <header className="mb-4">
        <Link
          href={
            awaitingSlip || paid
              ? '/liff/admin/advance?filter=awaiting-slip'
              : '/liff/admin/advance'
          }
          className="text-sm text-gray-500 hover:text-gray-700"
        >
          ← กลับไปรายการคำขอเบิก
        </Link>
        <div className="mt-3 flex items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold text-gray-900">คำขอเบิก</h1>
          <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${info.cls}`}>
            {paid ? 'โอนเงินแล้ว' : info.label}
          </span>
        </div>
      </header>

      <section className="rounded-xl border border-gray-200 bg-white p-4 text-center shadow-sm">
        <p className="text-sm font-medium text-gray-900">
          {name}
          {row.employee.nickname && (
            <span className="text-gray-500"> ({row.employee.nickname})</span>
          )}
        </p>
        <p className="mt-2 text-3xl font-bold tabular-nums text-gray-900">{baht(amount)}</p>
        <p className="mt-1 text-xs text-gray-500">ส่งเมื่อ {formatBkk(row.requestedAt)}</p>
        {row.approvedAt && (
          <p className="mt-0.5 text-xs text-gray-500">อนุมัติเมื่อ {formatBkk(row.approvedAt)}</p>
        )}
        {row.paidAt && (
          <p className="mt-0.5 text-xs text-green-700">โอนเงินเมื่อ {formatBkk(row.paidAt)}</p>
        )}
      </section>

      <section className="mt-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <h2 className="text-xs font-medium uppercase tracking-wide text-gray-500">
          วงเงินของพนักงาน
        </h2>
        <dl className="mt-2 space-y-2 text-sm">
          {balance.kind === 'monthly' ? (
            <BalanceRow label="เงินเดือน">{baht(balance.baseSalary)}</BalanceRow>
          ) : (
            <BalanceRow label="รายได้งวดนี้">
              {balance.earnings === null ? '—' : baht(balance.earnings)}
            </BalanceRow>
          )}
          <BalanceRow label="ยอดจองไว้ (รอ/อนุมัติยังไม่หัก)">{baht(balance.reserved)}</BalanceRow>
          <BalanceRow label="คงเหลือเบิกได้">
            {balance.available === null ? (
              '—'
            ) : (
              <span className={balance.available < 0 ? 'text-red-600' : 'text-gray-900'}>
                {baht(balance.available)}
              </span>
            )}
          </BalanceRow>
        </dl>
        {overCap && (
          <p className="mt-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-800">
            ⚠️ จำนวนที่ขอเกินวงเงินคงเหลือ — อนุมัติได้แต่ควรตรวจสอบก่อน
          </p>
        )}
      </section>

      {row.status === 'Pending' && <AdvanceReviewActions cashAdvanceId={row.id} />}

      {awaitingSlip && (
        <SlipUploadBlock cashAdvanceId={row.id} heading="แนบสลิปการโอนเงิน" buttonLabel="แนบสลิป" />
      )}

      {paid && (
        <>
          <section className="mt-3 rounded-xl border border-gray-200 bg-gray-50 p-4">
            <h2 className="text-xs font-medium uppercase tracking-wide text-gray-500">สลิปการโอน</h2>
            {receiptIsExternal && resolvedReceiptUrl ? (
              // Legacy web path stored an external URL — link, don't hotlink.
              <a
                href={resolvedReceiptUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 block text-sm font-medium text-primary-700 underline"
              >
                เปิดดูสลิป (ลิงก์ภายนอก)
              </a>
            ) : resolvedReceiptUrl ? (
              <a
                href={resolvedReceiptUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 block overflow-hidden rounded-lg border border-gray-200 transition hover:opacity-90"
              >
                {/* biome-ignore lint/performance/noImgElement: signed URL, short TTL — next/image can't optimize it */}
                <img src={resolvedReceiptUrl} alt="สลิปการโอน" className="w-full" />
              </a>
            ) : (
              <p className="mt-2 text-sm text-gray-500">ไม่พบไฟล์สลิป</p>
            )}
          </section>
          <SlipUploadBlock cashAdvanceId={row.id} heading="แนบสลิปใหม่" buttonLabel="แนบสลิปใหม่" />
        </>
      )}
    </main>
  );
}

function BalanceRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="shrink-0 text-xs text-gray-500">{label}</dt>
      <dd className="text-right tabular-nums text-gray-900">{children}</dd>
    </div>
  );
}
