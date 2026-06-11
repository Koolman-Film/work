import { notFound } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { prisma } from '@/lib/db/prisma';
import { loadEmployeeOptions } from '../_employee-options';
import { deleteAdjustment, updateAdjustment } from '../actions';
import { AdjustmentForm } from '../adjustment-form';
import { frequencyOf } from '../adjustment-schema';

type Params = Promise<{ id: string }>;
type SearchParams = Promise<{ error?: string }>;

export default async function EditAdjustmentPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const { id } = await params;
  const { error } = await searchParams;

  const [row, employees] = await Promise.all([
    prisma.payrollAdjustment.findUnique({ where: { id } }),
    loadEmployeeOptions(),
  ]);
  if (!row || row.deletedAt) notFound();

  const currentMonth = new Date()
    .toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' })
    .slice(0, 7);

  const update = async (formData: FormData) => {
    'use server';
    await updateAdjustment(id, formData);
  };
  const remove = async () => {
    'use server';
    await deleteAdjustment(id);
  };

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader breadcrumb="เงินเดือน · เงินเพิ่ม/เงินลด" title="แก้ไขรายการ" />
      <div className="max-w-2xl">
        <AdjustmentForm
          mode="edit"
          action={update}
          employees={employees}
          currentMonth={currentMonth}
          initial={{
            employeeId: row.employeeId,
            kind: row.kind,
            reason: row.reason,
            amount: row.amount.toString(),
            frequency: frequencyOf(row.startMonth, row.endMonth),
            startMonth: row.startMonth,
            endMonth: row.endMonth ?? '',
            note: row.note ?? '',
          }}
          error={error ? decodeURIComponent(error) : null}
          extraActions={
            <form action={remove}>
              <Button type="submit" variant="destructive">
                ลบรายการ
              </Button>
            </form>
          }
        />
      </div>
    </div>
  );
}
