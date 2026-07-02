import { notFound } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { prisma } from '@/lib/db/prisma';
import { resolveStoredImageUrl } from '@/lib/storage/signed-urls';
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
    select: {
      id: true,
      name: true,
      address: true,
      latitude: true,
      longitude: true,
      radiusMeters: true,
      requireSelfie: true,
      requireGps: true,
      requireCheckOut: true,
      archivedAt: true,
      nameEn: true,
      payslipNameEn: true,
      payslipNameNative: true,
      payslipLogoKey: true,
    },
  });
  if (!branch || branch.archivedAt) notFound();

  const payslipLogoUrl = await resolveStoredImageUrl(branch.payslipLogoKey);

  // Server Action bound to this branch's id
  const updateBound = updateBranch.bind(null, id);

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader breadcrumb="ตั้งค่า · สาขา" title="แก้ไขสาขา" />
      <div className="max-w-2xl">
        <BranchForm
          mode="edit"
          action={updateBound}
          initial={{
            id: branch.id,
            name: branch.name,
            address: branch.address,
            latitude: branch.latitude ? Number(branch.latitude) : null,
            longitude: branch.longitude ? Number(branch.longitude) : null,
            radiusMeters: branch.radiusMeters,
            requireSelfie: branch.requireSelfie,
            requireGps: branch.requireGps,
            requireCheckOut: branch.requireCheckOut,
            nameEn: branch.nameEn,
            payslipNameEn: branch.payslipNameEn,
            payslipNameNative: branch.payslipNameNative,
            payslipLogoKey: branch.payslipLogoKey,
            payslipLogoUrl,
          }}
          error={error ? decodeURIComponent(error) : null}
          extraActions={
            <form action={archiveBranch.bind(null, id)}>
              <Button type="submit" variant="destructive">
                ลบถาวร
              </Button>
            </form>
          }
        />
      </div>
    </div>
  );
}
