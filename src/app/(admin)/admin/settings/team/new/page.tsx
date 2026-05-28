import { requirePermission } from '@/lib/auth/check-permission';
import { createTeamMember } from '../actions';
import { TeamCreateForm } from '../team-form';

type SearchParams = Promise<{ error?: string; email?: string }>;

export default async function NewTeamMemberPage({ searchParams }: { searchParams: SearchParams }) {
  // team.create is granted to Admin + Superadmin (Phase 3.7 relaxed
  // team management to "Admin can create/manage other Admins in the
  // same branch"). The role dropdown adapts to the actor's tier:
  //   - Superadmin can create either Admin OR Superadmin.
  //   - Admin can only create Admin (privilege-escalation guard;
  //     server-side canActOnRole in createTeamMember re-checks).
  const { tier: actorTier } = await requirePermission('team.create');
  const { error, email } = await searchParams;

  const availableRoles: ReadonlyArray<'Admin' | 'Superadmin'> =
    actorTier === 'Superadmin' ? ['Admin', 'Superadmin'] : ['Admin'];

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
