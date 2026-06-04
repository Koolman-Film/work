import { PageHeader } from '@/components/ui/page-header';
import { AccountingGroupForm } from '../accounting-group-form';
import { createAccountingGroup } from '../actions';

type SearchParams = Promise<{ error?: string }>;

export default async function NewAccountingGroupPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { error } = await searchParams;
  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader breadcrumb="ตั้งค่า · กลุ่มบัญชี" title="เพิ่มกลุ่มบัญชี" />
      <div className="max-w-2xl">
        <AccountingGroupForm
          mode="create"
          action={createAccountingGroup}
          error={error ? decodeURIComponent(error) : null}
        />
      </div>
    </div>
  );
}
