/**
 * /liff/advance — list of own cash-advance requests.
 */

import Link from 'next/link';
import { calculateAdvanceBalance } from '@/lib/advance/balance';
import { requireRole } from '@/lib/auth/require-role';
import { prisma } from '@/lib/db/prisma';
import { BalanceCard } from './balance-card';

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

export default async function LiffAdvanceListPage() {
  const { employee } = await requireRole(['Staff']);
  if (!employee) throw new Error('requireRole did not return Employee');

  // Fetch in parallel: the full list (UI), and the "reserved" subset
  // (balance calc). The balance subset is everything Pending OR
  // Approved-but-not-deducted — those are the rows that count against
  // available salary. See src/lib/advance/balance.ts for rationale.
  const [rows, reservedRows] = await Promise.all([
    prisma.cashAdvance.findMany({
      where: { employeeId: employee.id },
      orderBy: { requestedAt: 'desc' },
      take: 50,
      select: {
        id: true,
        amount: true,
        status: true,
        requestedAt: true,
        approvedAt: true,
        isDeducted: true,
      },
    }),
    prisma.cashAdvance.findMany({
      where: {
        employeeId: employee.id,
        OR: [{ status: 'Pending' }, { status: 'Approved', isDeducted: false }],
      },
      select: { status: true, amount: true },
    }),
  ]);

  const balance = calculateAdvanceBalance({
    baseSalary: employee.baseSalary,
    salaryType: employee.salaryType,
    // Type-cast: Prisma's AdvanceStatus enum includes Rejected/Cancelled
    // too, but our `where` clause filtered those out. The balance helper
    // only handles Pending/Approved.
    reservedAdvances: reservedRows as Array<{
      status: 'Pending' | 'Approved';
      amount: (typeof reservedRows)[number]['amount'];
    }>,
  });

  return (
    <main className="mx-auto max-w-md px-4 pt-8 pb-12">
      <header className="mb-6 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">คำขอเบิกของฉัน</h1>
          <p className="mt-0.5 text-sm text-gray-500">{rows.length} รายการ</p>
        </div>
        <Link
          href="/liff/advance/new"
          className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-primary-700"
        >
          + ขอเบิก
        </Link>
      </header>

      {/* Salary balance — the primary signal employees come here to see.
          Placed ABOVE the request list because "how much do I have left"
          is the question they're trying to answer, and the list is
          context. */}
      <div className="mb-6">
        <BalanceCard balance={balance} />
      </div>

      {rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-12 text-center">
          <p className="text-sm text-gray-500">ยังไม่มีคำขอเบิก</p>
          <Link
            href="/liff/advance/new"
            className="mt-3 inline-block text-sm font-medium text-primary-700 hover:text-primary-800"
          >
            ขอเบิกแรก →
          </Link>
        </div>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => {
            const badge = STATUS_LABEL[r.status] ?? STATUS_LABEL.Pending;
            return (
              <li key={r.id}>
                <Link
                  href={`/liff/advance/${r.id}`}
                  className="block rounded-xl border border-gray-200 bg-white p-4 shadow-sm transition hover:border-primary-200 hover:bg-primary-50/30"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-lg font-semibold tabular-nums text-gray-900">
                        {formatMoney(r.amount)}
                      </p>
                      <p className="mt-0.5 text-xs text-gray-500">
                        ส่งเมื่อ {formatDateTime(r.requestedAt)}
                      </p>
                      {r.status === 'Approved' && r.isDeducted && (
                        <p className="mt-1 text-[10px] text-gray-400">• หักจากเงินเดือนแล้ว</p>
                      )}
                    </div>
                    {badge && (
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${badge.cls}`}
                      >
                        {badge.label}
                      </span>
                    )}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      <nav className="mt-8 flex justify-center text-xs">
        <Link href="/liff/check-in" className="text-gray-500 hover:text-gray-700">
          ← กลับหน้าเช็คอิน
        </Link>
      </nav>
    </main>
  );
}
