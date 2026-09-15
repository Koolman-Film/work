import { Download, Settings2 } from 'lucide-react';
import Link from 'next/link';
import { loadReportFilterOptions } from '@/app/(admin)/admin/reports/_load-filter-options';
import { ActionLink } from '@/components/ui/action-link';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { ScrollArea } from '@/components/ui/scroll-area';
import { JOURNAL_LINE_LABEL } from '@/lib/accounting/labels';
import { loadPayrollJournal } from '@/lib/accounting/load-payroll-journal';
import { getPermittedBranches } from '@/lib/auth/branch-scope';
import { canDo, requirePermission } from '@/lib/auth/check-permission';
import { monthLabelTh } from '@/lib/format';
import { AccountingFilters } from './accounting-filters';

type SearchParams = Promise<{ m?: string; branchId?: string }>;

const baht = (satang: number) =>
  (satang / 100).toLocaleString('th-TH', { minimumFractionDigits: 2 });

export default async function AccountingPage({ searchParams }: { searchParams: SearchParams }) {
  const { user } = await requirePermission('accounting.read');
  const permitted = await getPermittedBranches(user, 'accounting.read');
  const sp = await searchParams;

  const { branches } = await loadReportFilterOptions(permitted);
  const month = /^\d{4}-\d{2}$/.test(sp.m ?? '')
    ? (sp.m as string)
    : new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' }).slice(0, 7);
  const branchId = sp.branchId && branches.some((b) => b.id === sp.branchId) ? sp.branchId : '';

  const result = branchId ? await loadPayrollJournal(month, branchId) : null;
  const canMap = await canDo(user, 'accounting.map');

  return (
    <div className="p-4">
      <PageHeader
        breadcrumb="บัญชี"
        title="ส่งออกบัญชีเงินเดือน"
        subtitle="สรุปรายการบัญชีของเงินเดือนที่ประกาศแล้ว เพื่อนำเข้าโปรแกรมบัญชี"
        actions={
          canMap ? (
            <ActionLink href="/admin/settings/account-mapping" label="ตั้งค่าผังบัญชี" icon={Settings2} />
          ) : null
        }
      />

      <AccountingFilters initial={{ m: month, branchId }} branches={branches} />

      {!branchId && (
        <div className="surface mt-4">
          <EmptyState title="เลือกสาขาเพื่อดูรายการบัญชี" hint="แต่ละสาขามีผังบัญชีของตัวเอง" />
        </div>
      )}

      {result?.ok === false && (
        <div
          role="status"
          className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
        >
          {result.reason === 'no-payrolls' && (
            <p>
              ไม่มีเงินเดือนที่ประกาศแล้วในเดือน {monthLabelTh(month)} — รายการบัญชีจะสร้างจากรอบที่
              <span className="font-medium"> ประกาศแล้ว </span>เท่านั้น
            </p>
          )}
          {result.reason === 'unmapped' && (
            <>
              <p className="font-medium">ยังไม่ได้ผูกผังบัญชีของรายการต่อไปนี้</p>
              <p className="mt-1">
                {result.kinds
                  .map((k) => JOURNAL_LINE_LABEL[k as keyof typeof JOURNAL_LINE_LABEL] ?? k)
                  .join(', ')}
              </p>
              {canMap && (
                <p className="mt-2">
                  <Link href="/admin/settings/account-mapping" className="underline">
                    ไปตั้งค่าผังบัญชี
                  </Link>
                </p>
              )}
            </>
          )}
          {/* Not a formatting problem: payroll's own numbers do not reconcile.
              Emitting a file here would push the discrepancy into the books. */}
          {result.reason === 'unbalanced' && (
            <p>
              เดบิตและเครดิตไม่เท่ากัน ต่างกัน {baht(Math.abs(result.differenceSatang))} บาท —
              กรุณาตรวจสอบการคำนวณเงินเดือนก่อน ระบบจะไม่สร้างไฟล์ที่ไม่สมดุล
            </p>
          )}
          {result.reason === 'no-branch' && <p>ไม่พบสาขา</p>}
        </div>
      )}

      {result?.ok && (
        <>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-ink-3">
              {monthLabelTh(month)} · {result.entry.branchName} · จากเงินเดือน{' '}
              <span className="font-medium text-ink-1">{result.payrollCount}</span> รายการ
            </p>
            <ActionLink
              href={`/admin/accounting/export?m=${month}&branchId=${branchId}`}
              label="ดาวน์โหลด XLSX"
              icon={Download}
            />
          </div>

          <ScrollArea className="mt-2 rounded-xl border border-line bg-surface">
            <table className="w-full text-sm md:min-w-[48rem]">
              <thead className="bg-surface-muted/60 text-left font-display text-xs font-semibold text-ink-3">
                <tr>
                  <th className="px-4 py-3">รายการ</th>
                  <th className="px-4 py-3">รหัสบัญชี</th>
                  <th className="px-4 py-3">ชื่อบัญชี</th>
                  <th className="px-4 py-3 text-right">เดบิต</th>
                  <th className="px-4 py-3 text-right">เครดิต</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-color)]">
                {result.entry.lines.map((l) => (
                  <tr key={l.kind}>
                    <td className="px-4 py-2.5 text-ink-2">{JOURNAL_LINE_LABEL[l.kind]}</td>
                    <td className="tabular px-4 py-2.5 text-ink-1">{l.accountCode}</td>
                    <td className="px-4 py-2.5 text-ink-3">{l.accountName ?? '—'}</td>
                    <td className="tabular px-4 py-2.5 text-right text-ink-1">
                      {l.amount > 0 ? baht(l.amount) : ''}
                    </td>
                    <td className="tabular px-4 py-2.5 text-right text-ink-1">
                      {l.amount < 0 ? baht(-l.amount) : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-[var(--border-color)] font-medium">
                  <td className="px-4 py-2.5 text-ink-2" colSpan={3}>
                    รวม
                  </td>
                  <td className="tabular px-4 py-2.5 text-right text-ink-1">
                    {baht(result.entry.totalDebit)}
                  </td>
                  <td className="tabular px-4 py-2.5 text-right text-ink-1">
                    {baht(result.entry.totalCredit)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </ScrollArea>
        </>
      )}
    </div>
  );
}
