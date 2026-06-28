import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { getPermittedBranches } from '@/lib/auth/branch-scope';
import { requirePermission } from '@/lib/auth/check-permission';
import { loadEmployeeFormOptions } from '../_load-options';
import { createEmployee } from '../actions';
import { EmployeeForm } from '../employee-form';

type SearchParams = Promise<{ error?: string }>;

export default async function NewEmployeePage({ searchParams }: { searchParams: SearchParams }) {
  const { user } = await requirePermission('employee.create');
  const { error } = await searchParams;
  const options = await loadEmployeeFormOptions();

  // Scoped admins may only place employees in their permitted branches.
  // Filter picker so they can't even select an out-of-scope branch.
  const permitted = await getPermittedBranches(user, 'employee.create');
  if (permitted !== 'all') {
    options.branches = options.branches.filter((b) => permitted.includes(b.id));
  }

  // Can't create employees without at least one branch (runs AFTER filtering
  // so a scoped admin with zero permitted branches sees the no-branches message).
  if (options.branches.length === 0) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-6 sm:px-6">
        <Card>
          <CardBody className="space-y-3 text-center">
            <h2 className="h-page text-lg text-ink-1">ยังไม่มีสาขา</h2>
            <p className="text-sm text-ink-3">ต้องเพิ่มสาขาอย่างน้อย 1 แห่งก่อน จึงจะสร้างพนักงานได้</p>
            <Link href="/admin/settings/branches/new" className="inline-block">
              <Button>ไปที่หน้าเพิ่มสาขา</Button>
            </Link>
          </CardBody>
        </Card>
      </div>
    );
  }

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader breadcrumb="พนักงาน" title="เพิ่มพนักงาน" />
      <EmployeeForm
        mode="create"
        action={createEmployee}
        options={options}
        error={error ? decodeURIComponent(error) : null}
      />
    </div>
  );
}
