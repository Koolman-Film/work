import { notFound } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { prisma } from '@/lib/db/prisma';
import { AccountingGroupForm } from '../../accounting-group-form';
import { archiveAccountingGroup, updateAccountingGroup } from '../../actions';

type Params = Promise<{ id: string }>;
type SearchParams = Promise<{ error?: string }>;

export default async function EditAccountingGroupPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const { id } = await params;
  const { error } = await searchParams;

  const row = await prisma.accountingGroup.findUnique({
    where: { id },
    select: { id: true, name: true, peakCode: true, description: true, archivedAt: true },
  });
  if (!row || row.archivedAt) notFound();

  return (
    <div className="max-w-2xl">
      <AccountingGroupForm
        mode="edit"
        action={updateAccountingGroup.bind(null, id)}
        initial={{ name: row.name, peakCode: row.peakCode, description: row.description }}
        error={error ? decodeURIComponent(error) : null}
        extraActions={
          <form action={archiveAccountingGroup.bind(null, id)}>
            <Button type="submit" variant="destructive">
              เก็บถาวร
            </Button>
          </form>
        }
      />
    </div>
  );
}
