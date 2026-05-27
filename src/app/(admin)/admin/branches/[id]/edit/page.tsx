import { notFound } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { prisma } from '@/lib/db/prisma';
import { archiveBranch, updateBranch } from '../../actions';
import { BranchForm } from '../../branch-form';

type Params = Promise<{ id: string }>;
type SearchParams = Promise<{ error?: string }>;

export default async function EditBranchPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const { id } = await params;
  const { error } = await searchParams;

  const branch = await prisma.branch.findUnique({
    where: { id },
    select: { id: true, name: true, address: true, radiusMeters: true, requireSelfie: true },
  });
  if (
    !branch ||
    (await prisma.branch.findUnique({ where: { id }, select: { archivedAt: true } }))?.archivedAt
  ) {
    notFound();
  }

  // Server Action bound to this branch's id
  const updateBound = updateBranch.bind(null, id);

  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      <BranchForm
        mode="edit"
        action={updateBound}
        initial={{
          name: branch.name,
          address: branch.address,
          radiusMeters: branch.radiusMeters,
          requireSelfie: branch.requireSelfie,
        }}
        error={error ? decodeURIComponent(error) : null}
        extraActions={
          <form action={archiveBranch.bind(null, id)}>
            <Button type="submit" variant="destructive">
              เก็บถาวร
            </Button>
          </form>
        }
      />
    </div>
  );
}
