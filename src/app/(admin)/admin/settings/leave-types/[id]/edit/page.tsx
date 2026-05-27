import { notFound } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { prisma } from '@/lib/db/prisma';
import { archiveLeaveType, updateLeaveType } from '../../actions';
import { LeaveTypeForm } from '../../leave-type-form';

type Params = Promise<{ id: string }>;
type SearchParams = Promise<{ error?: string }>;

export default async function EditLeaveTypePage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const { id } = await params;
  const { error } = await searchParams;

  const row = await prisma.leaveType.findUnique({
    where: { id },
    select: { id: true, name: true, isPaid: true, annualQuota: true, archivedAt: true },
  });
  if (!row || row.archivedAt) notFound();

  // Bind id to update action so the form can pass FormData directly.
  const update = async (formData: FormData) => {
    'use server';
    await updateLeaveType(id, formData);
  };
  const archive = async () => {
    'use server';
    await archiveLeaveType(id);
  };

  return (
    <LeaveTypeForm
      mode="edit"
      action={update}
      initial={{ name: row.name, isPaid: row.isPaid, annualQuota: row.annualQuota }}
      error={error ? decodeURIComponent(error) : null}
      extraActions={
        <form action={archive}>
          <Button type="submit" variant="destructive">
            เก็บถาวร
          </Button>
        </form>
      }
    />
  );
}
