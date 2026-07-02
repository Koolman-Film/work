import { PageHeader } from '@/components/ui/page-header';
import { createHoliday } from '../actions';
import { HolidayForm } from '../holiday-form';

type SearchParams = Promise<{ error?: string }>;

export default async function NewHolidayPage({ searchParams }: { searchParams: SearchParams }) {
  const { error } = await searchParams;

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader breadcrumb="ตั้งค่า · วันหยุด" title="เพิ่มวันหยุด" />
      <div>
        <HolidayForm
          mode="create"
          action={createHoliday}
          error={error ? decodeURIComponent(error) : null}
        />
      </div>
    </div>
  );
}
