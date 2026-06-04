import { PageHeader } from '@/components/ui/page-header';
import { createWorkSchedule } from '../actions';
import { WorkScheduleForm } from '../work-schedule-form';

type SearchParams = Promise<{ error?: string }>;

export default async function NewWorkSchedulePage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { error } = await searchParams;

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader breadcrumb="ตั้งค่า · ตารางงาน" title="เพิ่มตารางงาน" />
      <div className="max-w-2xl">
        <WorkScheduleForm
          mode="create"
          action={createWorkSchedule}
          error={error ? decodeURIComponent(error) : null}
        />
      </div>
    </div>
  );
}
