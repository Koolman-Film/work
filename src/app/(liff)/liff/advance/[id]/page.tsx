/**
 * /liff/advance/[id] — detail view of own cash-advance request.
 *
 * Same shape as /liff/leave/[id]: read-only data block + cancel button
 * if Pending. CashAdvance lacks reviewNote so post-decision feedback is
 * limited — the audit log is the source of truth for the "why."
 */

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireRole } from '@/lib/auth/require-role';
import { prisma } from '@/lib/db/prisma';
import { resolveStoredImageUrl } from '@/lib/storage/signed-urls';
import { AdvanceDetailActions } from './advance-detail-actions';

type Params = Promise<{ id: string }>;

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  Pending: { label: 'รออนุมัติ', cls: 'bg-amber-100 text-amber-800' },
  Approved: { label: 'อนุมัติแล้ว', cls: 'bg-green-100 text-green-800' },
  Rejected: { label: 'ไม่อนุมัติ', cls: 'bg-red-100 text-red-800' },
  Cancelled: { label: 'ยกเลิก', cls: 'bg-gray-100 text-gray-700' },
};

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
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default async function AdvanceDetailPage({ params }: { params: Params }) {
  const { id } = await params;
  const { employee } = await requireRole(['Staff']);
  if (!employee) throw new Error('requireRole did not return Employee');

  const row = await prisma.cashAdvance.findUnique({
    where: { id },
    select: {
      id: true,
      employeeId: true,
      amount: true,
      status: true,
      requestedAt: true,
      approvedAt: true,
      receiptUrl: true,
      isDeducted: true,
    },
  });
  if (!row) notFound();
  if (row.employeeId !== employee.id) notFound();

  // receiptUrl may be a Storage path (post-W4-late) or a legacy URL.
  // resolveStoredImageUrl returns a fresh signed URL in the first case,
  // pass-through in the second.
  const resolvedReceiptUrl = await resolveStoredImageUrl(row.receiptUrl);

  const badge = STATUS_LABEL[row.status] ?? STATUS_LABEL.Pending;

  return (
    <main className="mx-auto max-w-md px-4 pt-8 pb-12">
      <header className="mb-6">
        <Link href="/liff/advance" className="text-sm text-gray-500 hover:text-gray-700">
          ← กลับ
        </Link>
        <div className="mt-3 flex items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold text-gray-900">รายละเอียดคำขอเบิก</h1>
          {badge && (
            <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${badge.cls}`}>
              {badge.label}
            </span>
          )}
        </div>
      </header>

      <section className="rounded-2xl border border-gray-200 bg-white p-6 text-center shadow-sm">
        <p className="text-xs text-gray-500">จำนวนเงิน</p>
        <p className="mt-2 text-3xl font-bold tabular-nums text-gray-900">
          {formatMoney(row.amount)}
        </p>
      </section>

      <section className="mt-4 space-y-1 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <DataRow label="ส่งเมื่อ">{formatDateTime(row.requestedAt)}</DataRow>
        {row.approvedAt && <DataRow label="ตัดสินใจเมื่อ">{formatDateTime(row.approvedAt)}</DataRow>}
        {row.status === 'Approved' && (
          <DataRow label="หักจากเงินเดือน">
            {row.isDeducted ? (
              <span className="text-gray-700">หักแล้ว</span>
            ) : (
              <span className="text-amber-700">ยังไม่หัก — งวดถัดไป</span>
            )}
          </DataRow>
        )}
      </section>

      {resolvedReceiptUrl && (
        <section className="mt-4 rounded-2xl border border-gray-200 bg-gray-50 p-6">
          <h2 className="text-xs font-medium uppercase tracking-wide text-gray-500">ใบเสร็จ</h2>
          <a
            href={resolvedReceiptUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 block overflow-hidden rounded-lg border border-gray-200 transition hover:opacity-90"
          >
            {/* biome-ignore lint/performance/noImgElement: signed-URL preview can't use next/image (short TTL + external storage origin) */}
            <img
              src={resolvedReceiptUrl}
              alt="ใบเสร็จ"
              className="block h-auto w-full"
              loading="lazy"
            />
          </a>
          <a
            href={resolvedReceiptUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-block text-xs text-primary-700 underline hover:text-primary-800"
          >
            เปิดเต็มขนาด →
          </a>
        </section>
      )}

      {row.status === 'Pending' && (
        <section className="mt-6">
          <AdvanceDetailActions cashAdvanceId={row.id} />
        </section>
      )}
    </main>
  );
}

function DataRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between py-2 first:pt-0 last:pb-0">
      <span className="text-xs text-gray-500">{label}</span>
      <span className="text-right text-sm font-medium text-gray-900">{children}</span>
    </div>
  );
}
