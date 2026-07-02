import { notFound } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { prisma } from '@/lib/db/prisma';
import { asNameByLocale } from '@/lib/leave/localized-name';
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
    select: {
      id: true,
      name: true,
      nameByLocale: true,
      isPaid: true,
      annualQuota: true,
      overQuotaPolicy: true,
      archivedAt: true,
      allowFullDay: true,
      allowHalfDay: true,
      allowHourly: true,
    },
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
    <div className="px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader breadcrumb="ตั้งค่า · ประเภทการลา" title="แก้ไขประเภทการลา" />
      <div>
        <LeaveTypeForm
          mode="edit"
          action={update}
          initial={{
            name: row.name,
            nameByLocale: asNameByLocale(row.nameByLocale),
            isPaid: row.isPaid,
            annualQuota: row.annualQuota,
            overQuotaPolicy: row.overQuotaPolicy,
            allowFullDay: row.allowFullDay,
            allowHalfDay: row.allowHalfDay,
            allowHourly: row.allowHourly,
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
      </div>
    </div>
  );
}
