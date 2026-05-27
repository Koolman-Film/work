import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { loadEmployeeFormOptions } from '../_load-options';
import { createEmployee } from '../actions';
import { EmployeeForm } from '../employee-form';

type SearchParams = Promise<{ error?: string }>;

export default async function NewEmployeePage({ searchParams }: { searchParams: SearchParams }) {
  const { error } = await searchParams;
  const options = await loadEmployeeFormOptions();

  // Can't create employees without at least one branch
  if (options.branches.length === 0) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-8">
        <Card>
          <CardBody className="space-y-3 text-center">
            <h2 className="text-lg font-semibold text-gray-900">ยังไม่มีสาขา</h2>
            <p className="text-sm text-gray-500">ต้องเพิ่มสาขาอย่างน้อย 1 แห่งก่อน จึงจะสร้างพนักงานได้</p>
            <Link href="/admin/branches/new" className="inline-block">
              <Button>ไปที่หน้าเพิ่มสาขา</Button>
            </Link>
          </CardBody>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <h1 className="mb-6 text-2xl font-semibold text-gray-900">เพิ่มพนักงาน</h1>
      <EmployeeForm
        mode="create"
        action={createEmployee}
        options={options}
        error={error ? decodeURIComponent(error) : null}
      />
    </div>
  );
}
