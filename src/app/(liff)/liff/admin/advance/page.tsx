/**
 * /liff/admin/advance — "รอแนบสลิป": approved advances awaiting the
 * money transfer + slip attach (status=Approved, paidAt=null).
 *
 * Single-purpose by design: PENDING advances are NOT listed here — the
 * inbox (/liff/admin/inbox) owns everything that needs a decision. A
 * previous version duplicated a รออนุมัติ filter here, which put two
 * identically-labeled controls on screen with the shell tabs.
 *
 * The page title is the active shell tab (see admin-tabs.tsx) — no h1.
 */

import Link from 'next/link';
import { getPermittedBranches, viaEmployeeBranchScope } from '@/lib/auth/branch-scope';
import { requireLiffAdmin } from '@/lib/auth/require-liff-admin';
import { prisma } from '@/lib/db/prisma';

function formatBkk(d: Date): string {
  return d.toLocaleString('th-TH', {
    timeZone: 'Asia/Bangkok',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default async function LiffAdminAwaitingSlipPage() {
  const { user } = await requireLiffAdmin();
  const permitted = await getPermittedBranches(user, 'advance.read');

  const rows = await prisma.cashAdvance.findMany({
    where: {
      status: 'Approved',
      paidAt: null,
      deletedAt: null,
      ...viaEmployeeBranchScope(permitted),
    },
    orderBy: { approvedAt: 'desc' },
    take: 100,
    select: {
      id: true,
      amount: true,
      approvedAt: true,
      employee: { select: { firstName: true, lastName: true, nickname: true } },
    },
  });

  return (
    <main className="px-4 pt-4 pb-12">
      <p className="mb-4 text-sm text-gray-500">อนุมัติแล้ว — โอนเงินแล้วแตะรายการเพื่อแนบสลิป</p>

      {rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-12 text-center">
          <p className="text-sm text-gray-500">ไม่มีรายการรอแนบสลิป 🎉</p>
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
                      {r.approvedAt && (
                        <p className="mt-0.5 text-[10px] text-gray-400">
                          อนุมัติเมื่อ {formatBkk(r.approvedAt)}
                        </p>
                      )}
                    </div>
                    <span className="shrink-0 rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-800">
                      รอแนบสลิป
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
