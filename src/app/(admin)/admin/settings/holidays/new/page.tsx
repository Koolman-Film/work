import { createHoliday } from '../actions';
import { HolidayForm } from '../holiday-form';

type SearchParams = Promise<{ error?: string }>;

export default async function NewHolidayPage({ searchParams }: { searchParams: SearchParams }) {
  const { error } = await searchParams;

  return (
    <HolidayForm
      mode="create"
      action={createHoliday}
      error={error ? decodeURIComponent(error) : null}
    />
  );
}
