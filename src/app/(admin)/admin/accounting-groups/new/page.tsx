import { AccountingGroupForm } from '../accounting-group-form';
import { createAccountingGroup } from '../actions';

type SearchParams = Promise<{ error?: string }>;

export default async function NewAccountingGroupPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { error } = await searchParams;
  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      <AccountingGroupForm
        mode="create"
        action={createAccountingGroup}
        error={error ? decodeURIComponent(error) : null}
      />
    </div>
  );
}
