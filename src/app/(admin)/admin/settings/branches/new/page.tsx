import { createBranch } from '../actions';
import { BranchForm } from '../branch-form';

type SearchParams = Promise<{ error?: string }>;

export default async function NewBranchPage({ searchParams }: { searchParams: SearchParams }) {
  const { error } = await searchParams;

  return (
    <div className="max-w-2xl">
      <BranchForm
        mode="create"
        action={createBranch}
        error={error ? decodeURIComponent(error) : null}
      />
    </div>
  );
}
