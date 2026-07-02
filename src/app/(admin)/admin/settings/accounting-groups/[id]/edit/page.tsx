import { notFound } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
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
    <div className="px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader breadcrumb="ตั้งค่า · กลุ่มบัญชี" title="แก้ไขกลุ่มบัญชี" />
      <div>
        <AccountingGroupForm
          mode="edit"
          action={updateAccountingGroup.bind(null, id)}
          initial={{ name: row.name, peakCode: row.peakCode, description: row.description }}
          error={error ? decodeURIComponent(error) : null}
          extraActions={
            <form action={archiveAccountingGroup.bind(null, id)}>
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
