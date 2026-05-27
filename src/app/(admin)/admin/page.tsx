/**
 * Admin dashboard.
 *
 * Layout matches docs/v1/screens/admin.md:120-156 spec — pending-work
 * orientation, not a settings browser. Today the leave/advance/payroll
 * counts are 0 because those modules arrive in W3/W4; we still render
 * the cards as skeletons so the layout is in place + the customer sees
 * where the action items will appear.
 */

import { Calendar, Coins, TrendingDown, Users } from 'lucide-react';
import Link from 'next/link';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { requireRole } from '@/lib/auth/require-role';
import { prisma } from '@/lib/db/prisma';

export default async function AdminHomePage() {
  await requireRole(['Admin']);

  const [employeeCount] = await Promise.all([
    prisma.employee.count({ where: { archivedAt: null } }),
  ]);

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">ภาพรวม</h1>
        <p className="mt-1 text-sm text-gray-500">คำขอ การลงเวลา และเงินเดือน — ดูทั้งหมดในที่เดียว</p>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <KpiCard
          label="คำขอลา รออนุมัติ"
          value={0}
          Icon={Calendar}
          href="/admin/leave"
          disabled
          hint="เร็วๆ นี้"
        />
        <KpiCard
          label="คำขอเบิก รออนุมัติ"
          value={0}
          Icon={Coins}
          href="/admin/advance"
          disabled
          hint="เร็วๆ นี้"
        />
        <KpiCard
          label="ยอดหักเดือนนี้"
          value="฿ 0"
          Icon={TrendingDown}
          href="/admin/payroll"
          disabled
          hint="เร็วๆ นี้"
        />
        <KpiCard label="พนักงานทั้งหมด" value={employeeCount} Icon={Users} href="/admin/employees" />
      </div>

      {/* Alert banner — Phase 1 status */}
      <div className="mt-6 rounded-lg border border-primary-200 bg-primary-50 px-4 py-3 text-sm text-primary-800">
        <p className="font-medium">Phase 1 — Foundation พร้อมใช้งาน</p>
        <p className="mt-0.5 text-primary-700">
          เพิ่มพนักงานและตั้งค่าสาขา / แผนกได้แล้ว — ระบบลา / เบิก / เช็คอิน LIFF จะมาในขั้นถัดไป
        </p>
      </div>

      {/* Two-column action panels */}
      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>คำขอที่รอดำเนินการ</CardTitle>
          </CardHeader>
          <CardBody>
            <EmptyState icon={Calendar} text="ยังไม่มีคำขอ" hint="คำขอลาและคำขอเบิกจะมาในขั้นถัดไป (W4)" />
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>ใครลาวันนี้</CardTitle>
          </CardHeader>
          <CardBody>
            <EmptyState icon={Users} text="ยังไม่มีพนักงานลา" hint="ดูภาพรวมการลาประจำวันที่นี่" />
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

// ─── KPI card ──────────────────────────────────────────────────────────────

type KpiCardProps = {
  label: string;
  value: number | string;
  Icon: React.ComponentType<{ size?: number; className?: string }>;
  href: string;
  disabled?: boolean;
  hint?: string;
};

function KpiCard({ label, value, Icon, href, disabled, hint }: KpiCardProps) {
  const content = (
    <>
      <div className="flex items-start justify-between">
        <Icon size={20} className={disabled ? 'text-gray-300' : 'text-primary-500'} />
        {hint && (
          <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-500">
            {hint}
          </span>
        )}
      </div>
      <p
        className={`mt-3 text-xs font-medium uppercase tracking-wider ${disabled ? 'text-gray-400' : 'text-gray-500'}`}
      >
        {label}
      </p>
      <p
        className={`mt-1 text-2xl font-semibold tabular-nums ${disabled ? 'text-gray-300' : 'text-gray-900'}`}
      >
        {value}
      </p>
    </>
  );

  if (disabled) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">{content}</div>
    );
  }
  return (
    <Link
      href={href}
      className="block rounded-lg border border-gray-200 bg-white p-4 shadow-sm transition hover:border-primary-300 hover:shadow-brand"
    >
      {content}
    </Link>
  );
}

// ─── Empty state ───────────────────────────────────────────────────────────

function EmptyState({
  icon: Icon,
  text,
  hint,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  text: string;
  hint: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-8 text-center">
      <Icon size={28} className="text-gray-300" />
      <p className="mt-2 text-sm font-medium text-gray-600">{text}</p>
      <p className="mt-1 text-xs text-gray-400">{hint}</p>
    </div>
  );
}
