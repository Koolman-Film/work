import { PageHeader } from '@/components/ui/page-header';
import { createLeaveType } from '../actions';
import { LeaveTypeForm } from '../leave-type-form';

type SearchParams = Promise<{ error?: string }>;

export default async function NewLeaveTypePage({ searchParams }: { searchParams: SearchParams }) {
  const { error } = await searchParams;

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader breadcrumb="ตั้งค่า · ประเภทการลา" title="เพิ่มประเภทการลา" />
      <div className="max-w-2xl">
        <LeaveTypeForm
          mode="create"
          action={createLeaveType}
          error={error ? decodeURIComponent(error) : null}
        />
      </div>
    </div>
  );
}
