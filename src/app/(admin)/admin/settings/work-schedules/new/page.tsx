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
    <div className="p-4">
      <PageHeader breadcrumb="ตั้งค่า · ตารางงาน" title="เพิ่มตารางงาน" />
      <div>
        <WorkScheduleForm
          mode="create"
          action={createWorkSchedule}
          error={error ? decodeURIComponent(error) : null}
        />
      </div>
    </div>
  );
}
