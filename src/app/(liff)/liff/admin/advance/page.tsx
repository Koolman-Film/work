/**
 * /liff/admin/advance — mobile advance inbox for paired admins.
 *
 * Two filters:
 *   default          → Pending requests (need approve/reject)
 *   ?filter=awaiting-slip → Approved but paidAt=null (need money transfer + slip)
 */

import Link from 'next/link';
import { requireLiffAdmin } from '@/lib/auth/require-liff-admin';
import { prisma } from '@/lib/db/prisma';

type SearchParams = Promise<{ filter?: string }>;

function formatBkk(d: Date): string {
  return d.toLocaleString('th-TH', {
    timeZone: 'Asia/Bangkok',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default async function LiffAdminAdvanceListPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  await requireLiffAdmin();
  const { filter } = await searchParams;
  const awaitingSlip = filter === 'awaiting-slip';

  const rows = await prisma.cashAdvance.findMany({
    where: awaitingSlip
      ? { status: 'Approved', paidAt: null, deletedAt: null }
      : { status: 'Pending', deletedAt: null },
    orderBy: { requestedAt: 'desc' },
    take: 100,
    select: {
      id: true,
      amount: true,
      requestedAt: true,
      employee: { select: { firstName: true, lastName: true, nickname: true } },
    },
  });

  return (
    <main className="px-4 pt-4 pb-12">
      <h1 className="mb-4 text-2xl font-semibold text-gray-900">คำขอเบิก</h1>

      <div className="mb-4 flex gap-2">
        <FilterPill href="/liff/admin/advance" active={!awaitingSlip}>
          รออนุมัติ
        </FilterPill>
        <FilterPill href="/liff/admin/advance?filter=awaiting-slip" active={awaitingSlip}>
          รอแนบสลิป
        </FilterPill>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-12 text-center">
          <p className="text-sm text-gray-500">
            {awaitingSlip ? 'ไม่มีรายการรอแนบสลิป 🎉' : 'ไม่มีคำขอรออนุมัติ 🎉'}
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => {
            const name = `${r.employee.firstName} ${r.employee.lastName}`.trim();
            return (
              <li key={r.id}>
                <Link
                  href={`/liff/admin/advance/${r.id}`}
                  className="block rounded-xl border border-gray-200 bg-white p-4 shadow-sm transition hover:border-primary-200 hover:bg-primary-50/30"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900">
                        {name}
                        {r.employee.nickname && (
                          <span className="text-gray-500"> ({r.employee.nickname})</span>
                        )}
                      </p>
                      <p className="mt-0.5 text-lg font-semibold tabular-nums text-gray-900">
                        ฿{Number(r.amount).toLocaleString('th-TH')}
                      </p>
                      <p className="mt-0.5 text-[10px] text-gray-400">
                        ส่งเมื่อ {formatBkk(r.requestedAt)}
                      </p>
                    </div>
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                        awaitingSlip ? 'bg-blue-100 text-blue-800' : 'bg-amber-100 text-amber-800'
                      }`}
                    >
                      {awaitingSlip ? 'รอแนบสลิป' : 'รออนุมัติ'}
                    </span>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}

function FilterPill({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={
        active
          ? 'rounded-full bg-primary-50 px-3 py-1.5 text-xs font-semibold text-primary-700 ring-1 ring-primary-200'
          : 'rounded-full px-3 py-1.5 text-xs font-semibold text-gray-500 hover:bg-gray-100 hover:text-gray-700'
      }
    >
      {children}
    </Link>
  );
}
