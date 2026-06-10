/**
 * Reports layout — permission gate (report.read) + shared PageHeader +
 * the ลงเวลา / วันลา / เบิกเงิน tab strip. Pages render only their own
 * period picker + table.
 */

import { PageHeader } from '@/components/ui/page-header';
import { requirePermission } from '@/lib/auth/check-permission';
import { ReportTabs } from './tabs';

export default async function ReportsLayout({ children }: { children: React.ReactNode }) {
  await requirePermission('report.read');
  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader
        breadcrumb="รายงาน"
        title="รายงาน"
        subtitle="สรุปการลงเวลา วันลา และการเบิกเงิน — เลือกเดือนหรือกำหนดช่วงเอง"
      />
      <ReportTabs />
      {children}
    </div>
  );
}
