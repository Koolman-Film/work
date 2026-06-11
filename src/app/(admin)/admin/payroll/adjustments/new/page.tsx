import { PageHeader } from '@/components/ui/page-header';
import { loadEmployeeOptions } from '../_employee-options';
import { createAdjustment } from '../actions';
import { AdjustmentForm } from '../adjustment-form';

type SearchParams = Promise<{ error?: string }>;

export default async function NewAdjustmentPage({ searchParams }: { searchParams: SearchParams }) {
  const { error } = await searchParams;
  const employees = await loadEmployeeOptions();

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader breadcrumb="เงินเดือน · เงินเพิ่ม/เงินลด" title="เพิ่มรายการ" />
      <div className="max-w-2xl">
        <AdjustmentForm
          mode="create"
          action={createAdjustment}
          employees={employees}
          error={error ? decodeURIComponent(error) : null}
        />
      </div>
    </div>
  );
}
