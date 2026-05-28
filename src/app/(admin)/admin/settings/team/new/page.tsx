import { requirePermission } from '@/lib/auth/check-permission';
import { createTeamMember } from '../actions';
import { TeamCreateForm } from '../team-form';

type SearchParams = Promise<{ error?: string; email?: string }>;

export default async function NewTeamMemberPage({ searchParams }: { searchParams: SearchParams }) {
  // team.create is held only by Superadmin (via isSuperadmin shortcut).
  // Phase 3.5 design decision: Admin can READ the team list but cannot
  // create/edit other team members — they have to escalate to a
  // Superadmin. The actor returned here is always a Superadmin.
  const { user: actor } = await requirePermission('team.create');
  const { error, email } = await searchParams;

  // Both options are available because only Superadmin reaches this
  // point; the filter is retained as defensive future-proofing in case
  // we ever grant team.create to a non-Superadmin role.
  const availableRoles: ReadonlyArray<'Admin' | 'Superadmin'> =
    actor.role === 'Superadmin' ? ['Admin', 'Superadmin'] : ['Admin'];

  return (
    <div className="max-w-2xl">
      <TeamCreateForm
        action={createTeamMember}
        error={error ? decodeURIComponent(error) : null}
        email={email ? decodeURIComponent(email) : null}
        availableRoles={availableRoles}
      />
    </div>
  );
}
