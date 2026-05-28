import { notFound } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { prisma } from '@/lib/db/prisma';
import { archiveDepartment, updateDepartment } from '../../actions';
import { DepartmentForm } from '../../department-form';

type Params = Promise<{ id: string }>;
type SearchParams = Promise<{ error?: string }>;

export default async function EditDepartmentPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const { id } = await params;
  const { error } = await searchParams;

  const row = await prisma.department.findUnique({
    where: { id },
    select: { id: true, name: true, description: true, archivedAt: true },
  });
  if (!row || row.archivedAt) notFound();

  return (
    <div className="max-w-2xl">
      <DepartmentForm
        mode="edit"
        action={updateDepartment.bind(null, id)}
        initial={{ name: row.name, description: row.description }}
        error={error ? decodeURIComponent(error) : null}
        extraActions={
          <form action={archiveDepartment.bind(null, id)}>
            <Button type="submit" variant="destructive">
              ลบถาวร
            </Button>
          </form>
        }
      />
    </div>
  );
}
