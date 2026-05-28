/**
 * /liff/leave/[id] — detail view of own leave request.
 *
 * Server-renders the read-only data and embeds a Client cancel button
 * if status is Pending. Admin-only fields (reviewedBy, reviewNote) are
 * surfaced verbatim because the employee deserves to see why their
 * request was rejected.
 *
 * Access control: only the request owner can view their own request.
 * Admins viewing leave requests use /admin/leave (W4c).
 */

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireRole } from '@/lib/auth/require-role';
import { prisma } from '@/lib/db/prisma';
import { resolveStoredImageUrl } from '@/lib/storage/signed-urls';
import { LeaveDetailActions } from './leave-detail-actions';

type Params = Promise<{ id: string }>;

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  Pending: { label: 'รออนุมัติ', cls: 'bg-amber-100 text-amber-800' },
  Approved: { label: 'อนุมัติแล้ว', cls: 'bg-green-100 text-green-800' },
  Rejected: { label: 'ไม่อนุมัติ', cls: 'bg-red-100 text-red-800' },
  Cancelled: { label: 'ยกเลิก', cls: 'bg-gray-100 text-gray-700' },
};

function formatDate(d: Date): string {
  return d.toLocaleDateString('th-TH', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
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

export default async function LeaveDetailPage({ params }: { params: Params }) {
  const { id } = await params;
  const { employee } = await requireRole(['Staff']);
  if (!employee) throw new Error('requireRole did not return Employee');

  const row = await prisma.leaveRequest.findUnique({
    where: { id },
    select: {
      id: true,
      employeeId: true,
      leaveType: { select: { name: true, isPaid: true } },
      startDate: true,
      endDate: true,
      reason: true,
      status: true,
      reviewNote: true,
      reviewedAt: true,
      createdAt: true,
      attachmentUrl: true,
    },
  });

  if (!row) notFound();
  if (row.employeeId !== employee.id) notFound(); // not your request

  // attachmentUrl may be a Storage path or a legacy URL; resolve at
  // view-time so signed URLs always reflect a fresh TTL.
  const resolvedAttachmentUrl = await resolveStoredImageUrl(row.attachmentUrl);

  const badge = STATUS_LABEL[row.status] ?? STATUS_LABEL.Pending;

  return (
    <main className="mx-auto max-w-md px-4 pt-8 pb-12">
      <header className="mb-6">
        <Link href="/liff/leave" className="text-sm text-gray-500 hover:text-gray-700">
          ← กลับ
        </Link>
        <div className="mt-3 flex items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold text-gray-900">รายละเอียดคำขอลา</h1>
          {badge && (
            <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${badge.cls}`}>
              {badge.label}
            </span>
          )}
        </div>
      </header>

      <section className="space-y-1 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <DataRow label="ประเภท">
          {row.leaveType.name}
          {!row.leaveType.isPaid && <span className="ml-2 text-xs text-gray-500">(ไม่จ่ายเงิน)</span>}
        </DataRow>
        <DataRow label="ตั้งแต่">{formatDate(row.startDate)}</DataRow>
        <DataRow label="ถึง">{formatDate(row.endDate)}</DataRow>
        <DataRow label="ส่งเมื่อ">{formatDateTime(row.createdAt)}</DataRow>
      </section>

      <section className="mt-4 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="text-xs font-medium uppercase tracking-wide text-gray-500">เหตุผล</h2>
        <p className="mt-2 whitespace-pre-wrap text-sm text-gray-800">{row.reason}</p>
      </section>

      {resolvedAttachmentUrl && (
        <section className="mt-4 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="text-xs font-medium uppercase tracking-wide text-gray-500">ไฟล์แนบ</h2>
          <a
            href={resolvedAttachmentUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 block overflow-hidden rounded-lg border border-gray-200 transition hover:opacity-90"
          >
            {/* biome-ignore lint/performance/noImgElement: signed-URL preview can't use next/image */}
            <img
              src={resolvedAttachmentUrl}
              alt="ไฟล์แนบ"
              className="block h-auto w-full"
              loading="lazy"
            />
          </a>
        </section>
      )}

      {/* Admin review feedback, if any. */}
      {row.reviewNote && (
        <section className="mt-4 rounded-2xl border border-gray-200 bg-gray-50 p-6">
          <h2 className="text-xs font-medium uppercase tracking-wide text-gray-500">
            หมายเหตุจากแอดมิน
          </h2>
          <p className="mt-2 whitespace-pre-wrap text-sm text-gray-800">{row.reviewNote}</p>
          {row.reviewedAt && (
            <p className="mt-2 text-xs text-gray-400">{formatDateTime(row.reviewedAt)}</p>
          )}
        </section>
      )}

      {/* Cancel button — only when Pending. */}
      {row.status === 'Pending' && (
        <section className="mt-6">
          <LeaveDetailActions leaveRequestId={row.id} />
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
