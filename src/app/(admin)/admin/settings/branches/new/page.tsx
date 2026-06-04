import { PageHeader } from '@/components/ui/page-header';
import { createBranch } from '../actions';
import { BranchForm } from '../branch-form';

type SearchParams = Promise<{ error?: string }>;

export default async function NewBranchPage({ searchParams }: { searchParams: SearchParams }) {
  const { error } = await searchParams;

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader breadcrumb="ตั้งค่า · สาขา" title="เพิ่มสาขา" />
      <div className="max-w-2xl">
        <BranchForm
          mode="create"
          action={createBranch}
          error={error ? decodeURIComponent(error) : null}
        />
      </div>
    </div>
  );
}
