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
    <div className="max-w-2xl">
      <WorkScheduleForm
        mode="create"
        action={createWorkSchedule}
        error={error ? decodeURIComponent(error) : null}
      />
    </div>
  );
}
