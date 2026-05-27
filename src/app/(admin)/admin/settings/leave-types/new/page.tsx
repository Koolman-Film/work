import { createLeaveType } from '../actions';
import { LeaveTypeForm } from '../leave-type-form';

type SearchParams = Promise<{ error?: string }>;

export default async function NewLeaveTypePage({ searchParams }: { searchParams: SearchParams }) {
  const { error } = await searchParams;

  return (
    <LeaveTypeForm
      mode="create"
      action={createLeaveType}
      error={error ? decodeURIComponent(error) : null}
    />
  );
}
