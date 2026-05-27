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
    <div className="max-w-2xl">
      <AccountingGroupForm
        mode="create"
        action={createAccountingGroup}
        error={error ? decodeURIComponent(error) : null}
      />
    </div>
  );
}
