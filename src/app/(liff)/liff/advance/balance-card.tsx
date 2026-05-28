/**
 * Salary balance card for /liff/advance.
 *
 * Two layouts: Monthly (the common case — cap + reserved + available)
 * and rate-based (Daily / Hourly — rate + reserved only, no "available"
 * because we don't know the period yet).
 *
 * Server Component — pure presentational, takes the precomputed
 * AdvanceBalance object. Calculation lives in lib/advance/balance.ts.
 */

import type { AdvanceBalance } from '@/lib/advance/balance';

function formatMoney(n: number): string {
  return new Intl.NumberFormat('th-TH', {
    style: 'currency',
    currency: 'THB',
    maximumFractionDigits: 2,
  }).format(n);
}

type Props = {
  balance: AdvanceBalance;
};

export function BalanceCard({ balance }: Props) {
  if (balance.kind === 'monthly') {
    // Progress bar — visual cue for "how much used vs. how much left".
    // Capped at 100% so an overdrawn account doesn't render off-screen.
    const usedPct = Math.min(
      100,
      Math.max(0, (balance.reserved / Math.max(balance.baseSalary, 1)) * 100),
    );

    return (
      <section
        className={[
          'rounded-2xl border bg-white p-5 shadow-sm',
          balance.overdrawn ? 'border-red-300' : 'border-gray-200',
        ].join(' ')}
      >
        <p className="text-xs font-medium uppercase tracking-wider text-gray-500">
          ยอดเงินเดือนที่เบิกได้
        </p>

        <p
          className={[
            'mt-2 text-3xl font-semibold tabular-nums',
            balance.overdrawn ? 'text-red-700' : 'text-gray-900',
          ].join(' ')}
        >
          {formatMoney(balance.available)}
        </p>
        <p className="mt-0.5 text-xs text-gray-500">
          จากเงินเดือนพื้นฐาน <span className="tabular-nums">{formatMoney(balance.baseSalary)}</span>
        </p>

        {/* Progress bar — semantic ARIA: the OUTER container is the
            progressbar (carries aria-* state), the inner fill is just
            the visual indicator. */}
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(usedPct)}
          aria-label={`เบิกไปแล้ว ${usedPct.toFixed(0)}% ของเงินเดือน`}
          className="mt-4 h-1.5 overflow-hidden rounded-full bg-gray-100"
        >
          <div
            className={[
              'h-full rounded-full transition-all',
              balance.overdrawn ? 'bg-red-500' : usedPct > 80 ? 'bg-amber-500' : 'bg-primary-500',
            ].join(' ')}
            style={{ width: `${usedPct}%` }}
          />
        </div>

        {/* Breakdown */}
        <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-xs text-gray-500">รออนุมัติ</dt>
            <dd className="mt-0.5 font-medium tabular-nums text-amber-700">
              {formatMoney(balance.pending)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-gray-500">อนุมัติแล้ว (รอหัก)</dt>
            <dd className="mt-0.5 font-medium tabular-nums text-green-700">
              {formatMoney(balance.approvedNotDeducted)}
            </dd>
          </div>
        </dl>

        {balance.overdrawn && (
          <p role="alert" className="mt-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">
            ⚠️ เบิกเกินเงินเดือน — งวดหน้าหักครบและอาจติดลบ ติดต่อแอดมินหากมีคำถาม
          </p>
        )}

        <p className="mt-3 text-[11px] text-gray-400">ยอดที่อนุมัติแล้วจะถูกหักจากเงินเดือนงวดถัดไปอัตโนมัติ</p>
      </section>
    );
  }

  // Daily / Hourly: show the rate + reserved, but no "available" — see
  // balance.ts for the reasoning.
  const rateLabel = balance.salaryType === 'Daily' ? 'ต่อวัน' : 'ต่อชั่วโมง';
  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wider text-gray-500">อัตราเงินเดือนของคุณ</p>
      <p className="mt-2 text-3xl font-semibold tabular-nums text-gray-900">
        {formatMoney(balance.ratePerPeriod)}
        <span className="ml-1 text-sm font-normal text-gray-500">{rateLabel}</span>
      </p>
      <p className="mt-1 text-xs text-gray-500">
        ยอดที่เบิกได้ขึ้นกับวัน/ชั่วโมงที่ทำงานในงวดนี้ — สอบถามแอดมินเพื่อยอดที่แน่นอน
      </p>

      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-xs text-gray-500">รออนุมัติ</dt>
          <dd className="mt-0.5 font-medium tabular-nums text-amber-700">
            {formatMoney(balance.pending)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-gray-500">อนุมัติแล้ว (รอหัก)</dt>
          <dd className="mt-0.5 font-medium tabular-nums text-green-700">
            {formatMoney(balance.approvedNotDeducted)}
          </dd>
        </div>
      </dl>
    </section>
  );
}
