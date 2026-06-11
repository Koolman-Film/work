import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { type Column, ResponsiveTable } from '@/components/ui/responsive-table';
import { canDo } from '@/lib/auth/check-permission';
import { requireRole } from '@/lib/auth/require-role';
import { prisma } from '@/lib/db/prisma';
import { formatTHB2 } from '@/lib/format';
import { calculatePayrollAction, lockPayrollAction, publishPayrollAction } from './actions';

/**
 * /admin/payroll — monthly payroll run (รันเงินเดือนรายเดือน).
 *
 * Flow: เลือกเดือน → คำนวณ (Draft) → ตรวจตาราง → เผยแพร่ (Published, ส่ง LINE)
 * → ล็อก (Locked). The table lists every Payroll row of the month with its
 * income/deduction buckets and a company-total summary strip (requirement:
 * "ยอดสรุป เงินสุทธิทั้งหมดในแต่ละเดือน").
 *
 * Buttons render only when the current admin holds the matching permission
 * (payroll.run / payroll.publish) — the Server Actions re-enforce anyway.
 */

type SearchParams = Promise<{ m?: string; msg?: string }>;

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Current YYYY-MM in Bangkok. */
function currentMonth(): string {
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    timeZone: 'Asia/Bangkok',
  }).format(new Date());
}

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y as number, (m as number) - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

const MONTH_TH = [
  'มกราคม',
  'กุมภาพันธ์',
  'มีนาคม',
  'เมษายน',
  'พฤษภาคม',
  'มิถุนายน',
  'กรกฎาคม',
  'สิงหาคม',
  'กันยายน',
  'ตุลาคม',
  'พฤศจิกายน',
  'ธันวาคม',
] as const;

function monthLabelTh(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return `${MONTH_TH[(m as number) - 1]} ${(y as number) + 543}`;
}

const STATUS_CHIP = {
  Draft: { label: 'ฉบับร่าง', cls: 'bg-amber-100 text-amber-800' },
  Published: { label: 'เผยแพร่แล้ว', cls: 'bg-emerald-100 text-emerald-800' },
  Locked: { label: 'ล็อกแล้ว', cls: 'bg-sky-100 text-sky-800' },
} as const;

export default async function PayrollRunPage({ searchParams }: { searchParams: SearchParams }) {
  const { m, msg } = await searchParams;
  const month = m && MONTH_RE.test(m) ? m : currentMonth();

  const { user } = await requireRole(['Admin', 'Superadmin']);
  const [mayRun, mayPublish] = await Promise.all([
    canDo(user, 'payroll.run'),
    canDo(user, 'payroll.publish'),
  ]);

  const rows = await prisma.payroll.findMany({
    where: { month },
    orderBy: { employee: { firstName: 'asc' } },
    include: {
      employee: { select: { firstName: true, lastName: true, nickname: true } },
    },
  });

  const activeEmployees = await prisma.employee.count({ where: { status: { not: 'Archived' } } });

  const sum = (pick: (r: (typeof rows)[number]) => number) =>
    rows.reduce((acc, r) => acc + pick(r), 0);
  const totals = {
    incomeBase: sum((r) => r.incomeBase.toNumber()),
    incomeOther: sum((r) => r.incomeOther.toNumber()),
    deductSso: sum((r) => r.deductSso.toNumber()),
    deductions: sum(
      (r) =>
        r.deductAdvance.toNumber() +
        r.deductAttendance.toNumber() +
        r.deductLeave.toNumber() +
        r.deductDebt.toNumber() +
        r.deductOther.toNumber(),
    ),
    netPay: sum((r) => r.netPay.toNumber()),
  };

  const statusCounts = {
    Draft: rows.filter((r) => r.status === 'Draft').length,
    Published: rows.filter((r) => r.status === 'Published').length,
    Locked: rows.filter((r) => r.status === 'Locked').length,
  };

  const columns: Column<(typeof rows)[number]>[] = [
    {
      key: 'employee',
      header: 'พนักงาน',
      cell: (r) => (
        <span className="font-medium text-ink-1">
          {r.employee.firstName} {r.employee.lastName}
          {r.employee.nickname ? ` (${r.employee.nickname})` : ''}
        </span>
      ),
    },
    {
      key: 'base',
      header: 'ฐานเงินเดือน',
      cell: (r) => (
        <span className="font-mono text-ink-2">{formatTHB2(r.incomeBase.toNumber())}</span>
      ),
    },
    {
      key: 'incomeOther',
      header: 'เงินเพิ่ม',
      cell: (r) =>
        r.incomeOther.isZero() ? (
          <span className="text-xs text-ink-4">—</span>
        ) : (
          <span className="font-mono text-emerald-700">
            +{formatTHB2(r.incomeOther.toNumber())}
          </span>
        ),
    },
    {
      key: 'sso',
      header: 'ประกันสังคม',
      cell: (r) =>
        r.deductSso.isZero() ? (
          <span className="text-xs text-ink-4">—</span>
        ) : (
          <span className="font-mono text-ink-2">-{formatTHB2(r.deductSso.toNumber())}</span>
        ),
    },
    {
      key: 'otherDeducts',
      header: 'รายการหักอื่น',
      cell: (r) => {
        const v =
          r.deductAdvance.toNumber() +
          r.deductAttendance.toNumber() +
          r.deductLeave.toNumber() +
          r.deductDebt.toNumber() +
          r.deductOther.toNumber();
        return v === 0 ? (
          <span className="text-xs text-ink-4">—</span>
        ) : (
          <span className="font-mono text-red-700">-{formatTHB2(v)}</span>
        );
      },
    },
    {
      key: 'net',
      header: 'สุทธิ',
      cell: (r) => (
        <span className="font-mono font-semibold text-ink-1">
          {formatTHB2(r.netPay.toNumber())}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'สถานะ',
      cell: (r) => {
        const chip = STATUS_CHIP[r.status];
        return (
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${chip.cls}`}>
            {chip.label}
          </span>
        );
      },
    },
  ];

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader
        breadcrumb="การเงิน"
        title="เงินเดือน"
        subtitle="คำนวณ ตรวจสอบ และเผยแพร่สลิปเงินเดือนรายเดือน"
        actions={
          <Link href="/admin/payroll/adjustments">
            <Button variant="secondary">เงินเพิ่ม / เงินลด</Button>
          </Link>
        }
      />

      {/* Month navigator */}
      <div className="mb-4 flex items-center gap-3">
        <Link
          href={`/admin/payroll?m=${shiftMonth(month, -1)}`}
          className="grid size-8 place-items-center rounded-lg border border-gray-200 text-ink-2 hover:bg-gray-50"
          aria-label="เดือนก่อนหน้า"
        >
          ‹
        </Link>
        <span className="min-w-40 text-center font-display text-base font-bold text-ink-1">
          {monthLabelTh(month)}
        </span>
        <Link
          href={`/admin/payroll?m=${shiftMonth(month, 1)}`}
          className="grid size-8 place-items-center rounded-lg border border-gray-200 text-ink-2 hover:bg-gray-50"
          aria-label="เดือนถัดไป"
        >
          ›
        </Link>
      </div>

      {msg && (
        <div
          role="status"
          className="mb-4 rounded-lg bg-primary-50 px-4 py-3 text-sm text-primary-800"
        >
          {decodeURIComponent(msg)}
        </div>
      )}

      {/* Summary strip — company totals for the month */}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {[
          { label: 'ฐานเงินเดือนรวม', value: totals.incomeBase, accent: 'text-ink-1' },
          { label: 'เงินเพิ่มรวม', value: totals.incomeOther, accent: 'text-emerald-700' },
          { label: 'ประกันสังคมรวม', value: totals.deductSso, accent: 'text-ink-2' },
          { label: 'รายการหักรวม', value: totals.deductions, accent: 'text-red-700' },
          { label: 'เงินสุทธิรวม', value: totals.netPay, accent: 'text-primary-700' },
        ].map((card) => (
          <div key={card.label} className="rounded-xl border border-gray-200 bg-white px-4 py-3">
            <p className="text-xs text-ink-3">{card.label}</p>
            <p className={`mt-1 font-mono text-lg font-semibold ${card.accent}`}>
              {formatTHB2(card.value)}
            </p>
          </div>
        ))}
      </div>

      {/* Run actions */}
      <div className="mb-6 flex flex-wrap items-center gap-3">
        {mayRun && (
          <form action={calculatePayrollAction}>
            <input type="hidden" name="month" value={month} />
            <Button type="submit" variant="secondary">
              {rows.length > 0 ? 'คำนวณใหม่ (ฉบับร่าง)' : 'คำนวณเงินเดือน'}
            </Button>
          </form>
        )}
        {mayPublish && statusCounts.Draft > 0 && (
          <form action={publishPayrollAction}>
            <input type="hidden" name="month" value={month} />
            <Button type="submit">เผยแพร่สลิป + แจ้งเตือน LINE ({statusCounts.Draft} คน)</Button>
          </form>
        )}
        {mayPublish && statusCounts.Published > 0 && (
          <form action={lockPayrollAction}>
            <input type="hidden" name="month" value={month} />
            <Button type="submit" variant="secondary">
              ล็อกงวด ({statusCounts.Published} คน)
            </Button>
          </form>
        )}
        <p className="text-xs text-ink-3">
          พนักงานทั้งหมด {activeEmployees} คน · คำนวณแล้ว {rows.length} คน
          {statusCounts.Published > 0 ? ` · เผยแพร่แล้ว ${statusCounts.Published}` : ''}
          {statusCounts.Locked > 0 ? ` · ล็อกแล้ว ${statusCounts.Locked}` : ''}
        </p>
      </div>

      <ResponsiveTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        empty={
          <div className="surface">
            <EmptyState
              title={`ยังไม่ได้คำนวณเงินเดือนเดือน ${monthLabelTh(month)}`}
              action={
                mayRun ? (
                  <form action={calculatePayrollAction}>
                    <input type="hidden" name="month" value={month} />
                    <Button variant="secondary">คำนวณเงินเดือน</Button>
                  </form>
                ) : undefined
              }
            />
          </div>
        }
      />
    </div>
  );
}
