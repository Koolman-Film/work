import { requireRole } from '@/lib/auth/require-role';
import { createTeamMember } from '../actions';
import { TeamCreateForm } from '../team-form';

type SearchParams = Promise<{ error?: string; email?: string }>;

export default async function NewTeamMemberPage({ searchParams }: { searchParams: SearchParams }) {
  // Permission filtering: Admin actor can only create Admins; Owner
  // can create either. The server re-checks; this trims the role dropdown
  // so admins don't see a useless "Owner" option that would 403 them.
  const { user: actor } = await requireRole(['Admin', 'Superadmin']);
  const { error, email } = await searchParams;

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
