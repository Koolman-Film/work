import { createBranch } from '../actions';
import { BranchForm } from '../branch-form';

type SearchParams = Promise<{ error?: string }>;

export default async function NewBranchPage({ searchParams }: { searchParams: SearchParams }) {
  const { error } = await searchParams;

  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      <BranchForm
        mode="create"
        action={createBranch}
        error={error ? decodeURIComponent(error) : null}
      />
    </div>
  );
}
