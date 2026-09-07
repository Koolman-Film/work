import { loadReportFilterOptions } from '@/app/(admin)/admin/reports/_load-filter-options';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { getPermittedBranches } from '@/lib/auth/branch-scope';
import { requirePermission } from '@/lib/auth/check-permission';
import { prisma } from '@/lib/db/prisma';
import { AccountingFilters } from '../../accounting/accounting-filters';
import { MappingForm } from './mapping-form';

type SearchParams = Promise<{ branchId?: string }>;

export default async function AccountMappingPage({ searchParams }: { searchParams: SearchParams }) {
  const { user } = await requirePermission('accounting.map');
  const permitted = await getPermittedBranches(user, 'accounting.map');
  const sp = await searchParams;

  const { branches } = await loadReportFilterOptions(permitted);
  const branchId = sp.branchId && branches.some((b) => b.id === sp.branchId) ? sp.branchId : '';

  const rows = branchId
    ? await prisma.accountMapping.findMany({
        where: { branchId },
        select: { lineKind: true, accountCode: true, accountName: true },
      })
    : [];
  const initial = Object.fromEntries(
    rows.map((r) => [r.lineKind, { accountCode: r.accountCode, accountName: r.accountName }]),
  );

  return (
    <div className="p-4">
      <PageHeader
        breadcrumb="ตั้งค่า"
        title="ผังบัญชีเงินเดือน"
        subtitle="ผูกรายการเงินเดือนแต่ละประเภทเข้ากับรหัสบัญชีของสาขา — ใช้ตอนส่งออกบัญชีเงินเดือน"
      />

      {/* Branch-scoped because the branches are separate registered companies
          and therefore keep separate charts of accounts. */}
      <AccountingFilters
        initial={{ m: '', branchId }}
        branches={branches}
        monthless
        action="/admin/settings/account-mapping"
      />

      {!branchId ? (
        <div className="surface mt-4">
          <EmptyState title="เลือกสาขาเพื่อตั้งค่าผังบัญชี" hint="แต่ละสาขาเป็นนิติบุคคลแยกกัน จึงมีผังบัญชีของตัวเอง" />
        </div>
      ) : (
        <MappingForm branchId={branchId} initial={initial} />
      )}
    </div>
  );
}
