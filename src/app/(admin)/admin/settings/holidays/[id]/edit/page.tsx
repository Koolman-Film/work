import { notFound } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { prisma } from '@/lib/db/prisma';
import { archiveHoliday, updateHoliday } from '../../actions';
import { HolidayForm } from '../../holiday-form';

type Params = Promise<{ id: string }>;
type SearchParams = Promise<{ error?: string }>;

export default async function EditHolidayPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const { id } = await params;
  const { error } = await searchParams;

  const row = await prisma.holiday.findUnique({
    where: { id },
    select: { id: true, date: true, name: true, isSubstitute: true, archivedAt: true },
  });
  if (!row || row.archivedAt) notFound();

  // Bind id to update action so the form can pass FormData directly.
  const update = async (formData: FormData) => {
    'use server';
    await updateHoliday(id, formData);
  };
  const archive = async () => {
    'use server';
    await archiveHoliday(id);
  };

  return (
    <HolidayForm
      mode="edit"
      action={update}
      initial={{
        // Pre-format as YYYY-MM-DD so the date input doesn't re-shift the
        // calendar day across timezones.
        date: row.date.toISOString().slice(0, 10),
        name: row.name,
        isSubstitute: row.isSubstitute,
      }}
      error={error ? decodeURIComponent(error) : null}
      extraActions={
        <form action={archive}>
          <Button type="submit" variant="destructive">
            ลบถาวร
          </Button>
        </form>
      }
    />
  );
}
