import { notFound } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { prisma } from '@/lib/db/prisma';
import { archiveWorkSchedule, updateWorkSchedule } from '../../actions';
import { WorkScheduleForm } from '../../work-schedule-form';

type Params = Promise<{ id: string }>;
type SearchParams = Promise<{ error?: string }>;

const EMPTY_DAY = { enabled: false, startTime: '', endTime: '' };

export default async function EditWorkSchedulePage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const { id } = await params;
  const { error } = await searchParams;

  const schedule = await prisma.workSchedule.findUnique({
    where: { id },
    include: { days: true },
  });
  if (!schedule || schedule.archivedAt) notFound();

  // Build a 7-slot array indexed by dayOfWeek. Missing days = closed.
  // The form expects this exact shape (one Initial per weekday).
  const daysByDow = new Map(schedule.days.map((d) => [d.dayOfWeek, d]));
  const days = Array.from({ length: 7 }, (_, dow) => {
    const found = daysByDow.get(dow);
    return found
      ? { enabled: true, startTime: found.startTime, endTime: found.endTime }
      : EMPTY_DAY;
  });

  const updateBound = updateWorkSchedule.bind(null, id);

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader breadcrumb="ตั้งค่า · ตารางงาน" title="แก้ไขตารางงาน" />
      <div>
        <WorkScheduleForm
          mode="edit"
          action={updateBound}
          initial={{
            name: schedule.name,
            lateToleranceMin: schedule.lateToleranceMin,
            days,
          }}
          error={error ? decodeURIComponent(error) : null}
          extraActions={
            <form action={archiveWorkSchedule.bind(null, id)}>
              <Button type="submit" variant="destructive">
                ลบถาวร
              </Button>
            </form>
          }
        />
      </div>
    </div>
  );
}
