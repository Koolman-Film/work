import { createDepartment } from '../actions';
import { DepartmentForm } from '../department-form';

type SearchParams = Promise<{ error?: string }>;

export default async function NewDepartmentPage({ searchParams }: { searchParams: SearchParams }) {
  const { error } = await searchParams;
  return (
    <div className="max-w-2xl">
      <DepartmentForm
        mode="create"
        action={createDepartment}
        error={error ? decodeURIComponent(error) : null}
      />
    </div>
  );
}
