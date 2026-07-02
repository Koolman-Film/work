import { PageHeader } from '@/components/ui/page-header';
import { loadEmployeeOptions } from '../_employee-options';
import { loadReasonSuggestions } from '../_reason-options';
import { createAdjustment } from '../actions';
import { AdjustmentForm } from '../adjustment-form';

type SearchParams = Promise<{ error?: string }>;

export default async function NewAdjustmentPage({ searchParams }: { searchParams: SearchParams }) {
  const { error } = await searchParams;
  const [employees, reasonSuggestions] = await Promise.all([
    loadEmployeeOptions(),
    loadReasonSuggestions(),
  ]);
  const currentMonth = new Date()
    .toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' })
    .slice(0, 7);

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader breadcrumb="เงินเดือน · เงินเพิ่ม/เงินลด" title="เพิ่มรายการ" />
      <div>
        <AdjustmentForm
          mode="create"
          action={createAdjustment}
          employees={employees}
          currentMonth={currentMonth}
          reasonSuggestions={reasonSuggestions}
          error={error ? decodeURIComponent(error) : null}
        />
      </div>
    </div>
  );
}
