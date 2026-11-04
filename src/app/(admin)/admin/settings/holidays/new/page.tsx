import { PageHeader } from '@/components/ui/page-header';
import { prisma } from '@/lib/db/prisma';
import { createHoliday } from '../actions';
import { HolidayForm } from '../holiday-form';

type SearchParams = Promise<{ error?: string }>;

export default async function NewHolidayPage({ searchParams }: { searchParams: SearchParams }) {
  const { error } = await searchParams;
  const branches = await prisma.branch.findMany({
    where: { archivedAt: null },
    orderBy: { name: 'asc' },
    select: { id: true, name: true },
  });

  return (
    <div className="p-4">
      <PageHeader breadcrumb="ตั้งค่า · วันหยุด" title="เพิ่มวันหยุด" />
      <div>
        <HolidayForm
          mode="create"
          branches={branches}
          action={createHoliday}
          error={error ? decodeURIComponent(error) : null}
        />
      </div>
    </div>
  );
}
