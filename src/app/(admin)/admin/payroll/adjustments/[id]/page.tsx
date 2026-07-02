import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/ui/page-header';
import { prisma } from '@/lib/db/prisma';
import { formatTHB2 } from '@/lib/format';
import { loadEmployeeOptions } from '../_employee-options';
import { loadReasonSuggestions } from '../_reason-options';
import { updateAdjustment } from '../actions';
import { AdjustmentForm } from '../adjustment-form';
import { frequencyOf } from '../adjustment-schema';
import { DeleteAdjustmentButton } from '../delete-adjustment-button';

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

  const [row, employees, reasonSuggestions] = await Promise.all([
    prisma.payrollAdjustment.findUnique({ where: { id } }),
    loadEmployeeOptions(),
    loadReasonSuggestions(),
  ]);
  if (!row || row.deletedAt) notFound();

  const currentMonth = new Date()
    .toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' })
    .slice(0, 7);

  const update = async (formData: FormData) => {
    'use server';
    await updateAdjustment(id, formData);
  };

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader breadcrumb="เงินเดือน · เงินเพิ่ม/เงินลด" title="แก้ไขรายการ" />
      <div>
        <AdjustmentForm
          mode="edit"
          action={update}
          employees={employees}
          currentMonth={currentMonth}
          reasonSuggestions={reasonSuggestions}
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
            <DeleteAdjustmentButton
              id={row.id}
              summary={`${row.kind === 'Income' ? 'เงินเพิ่ม' : 'เงินลด'} "${row.reason}" ${formatTHB2(row.amount.toNumber())}`}
            />
          }
        />
      </div>
    </div>
  );
}
