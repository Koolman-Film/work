/**
 * /liff/admin/inbox — mobile pending-work inbox for paired admins.
 *
 * Three sections (same pending where-clauses as the admin web inboxes):
 *   - คำขอลา      → /liff/admin/leave/[id]
 *   - คำขอเบิก    → /liff/admin/advance/[id]
 *   - ลงเวลารอตรวจสอบ → admin web disputed page (no LIFF detail in v1)
 *
 * Thai-only literals — admin-facing, matches the untranslated admin panel.
 */

import Link from 'next/link';
import { permittedBranchesFromAssignments, viaEmployeeBranchScope } from '@/lib/auth/branch-scope';
import { getUserAssignments } from '@/lib/auth/check-permission';
import { requireLiffAdmin } from '@/lib/auth/require-liff-admin';
import { prisma } from '@/lib/db/prisma';

function formatBkk(d: Date): string {
  return d.toLocaleString('th-TH', {
    timeZone: 'Asia/Bangkok',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatBkkDate(d: Date): string {
  return d.toLocaleDateString('th-TH', {
    timeZone: 'Asia/Bangkok',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function fullName(e: { firstName: string; lastName: string; nickname: string | null }): string {
  const name = `${e.firstName} ${e.lastName}`.trim();
  return e.nickname ? `${name} (${e.nickname})` : name;
}

const EMPLOYEE_NAME_SELECT = {
  select: { firstName: true, lastName: true, nickname: true },
} as const;

export default async function LiffAdminInboxPage() {
  const { user } = await requireLiffAdmin();
  const assignments = await getUserAssignments(user.id);
  const leaveScope = viaEmployeeBranchScope(
    permittedBranchesFromAssignments(assignments, 'leave.read'),
  );
  const advScope = viaEmployeeBranchScope(
    permittedBranchesFromAssignments(assignments, 'advance.read'),
  );
  const attScope = viaEmployeeBranchScope(
    permittedBranchesFromAssignments(assignments, 'attendance.read'),
  );

  // `deletedAt: null` is explicit defence-in-depth on top of the
  // soft-delete client extension (matches the LIFF advance list page).
  const [leaves, advances, disputes] = await Promise.all([
    prisma.leaveRequest.findMany({
      where: { status: 'Pending', deletedAt: null, ...leaveScope },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        startDate: true,
        endDate: true,
        createdAt: true,
        leaveType: { select: { name: true } },
        employee: EMPLOYEE_NAME_SELECT,
      },
    }),
    prisma.cashAdvance.findMany({
      where: { status: 'Pending', deletedAt: null, ...advScope },
      orderBy: { requestedAt: 'desc' },
      take: 50,
      select: {
        id: true,
        amount: true,
        requestedAt: true,
        employee: EMPLOYEE_NAME_SELECT,
      },
    }),
    prisma.attendance.findMany({
      where: { type: 'CheckIn', checkInStatus: { in: ['Disputed'] }, deletedAt: null, ...attScope },
      orderBy: { clockInAt: 'desc' },
      take: 50,
      select: {
        id: true,
        clockInAt: true,
        employee: EMPLOYEE_NAME_SELECT,
      },
    }),
  ]);

  const empty = leaves.length === 0 && advances.length === 0 && disputes.length === 0;

  return (
    <main className="px-4 pt-4 pb-12">
      {empty ? (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-12 text-center">
          <p className="text-sm text-gray-500">ไม่มีงานค้าง 🎉</p>
        </div>
      ) : (
        <div className="space-y-6">
          <Section title="คำขอลา" count={leaves.length}>
            {leaves.map((r) => (
              <ItemCard key={r.id} href={`/liff/admin/leave/${r.id}`}>
                <p className="text-sm font-medium text-gray-900">{fullName(r.employee)}</p>
                <p className="mt-0.5 text-xs text-gray-500">
                  {r.leaveType.name} • {formatBkkDate(r.startDate)}
                  {r.endDate.getTime() !== r.startDate.getTime()
                    ? ` – ${formatBkkDate(r.endDate)}`
                    : ''}
                </p>
                <p className="mt-0.5 text-[10px] text-gray-400">ส่งเมื่อ {formatBkk(r.createdAt)}</p>
              </ItemCard>
            ))}
          </Section>

          <Section title="คำขอเบิก" count={advances.length}>
            {advances.map((r) => (
              <ItemCard key={r.id} href={`/liff/admin/advance/${r.id}`}>
                <p className="text-sm font-medium text-gray-900">{fullName(r.employee)}</p>
                <p className="mt-0.5 text-lg font-semibold tabular-nums text-gray-900">
                  ฿{Number(r.amount).toLocaleString('th-TH')}
                </p>
                <p className="mt-0.5 text-[10px] text-gray-400">ส่งเมื่อ {formatBkk(r.requestedAt)}</p>
              </ItemCard>
            ))}
          </Section>

          <Section title="ลงเวลารอตรวจสอบ" count={disputes.length}>
            {disputes.map((r) => (
              // v1: no LIFF dispute detail — link to the admin web page.
              <ItemCard key={r.id} href="/admin/attendance/disputed">
                <p className="text-sm font-medium text-gray-900">{fullName(r.employee)}</p>
                <p className="mt-0.5 text-xs text-gray-500">
                  {r.clockInAt ? `เช็คอิน ${formatBkk(r.clockInAt)}` : 'ไม่มีเวลาเช็คอิน'}
                </p>
                <p className="mt-0.5 text-[10px] text-gray-400">เปิดดูในหน้าเว็บแอดมิน</p>
              </ItemCard>
            ))}
          </Section>
        </div>
      )}
    </main>
  );
}

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  if (count === 0) return null;
  return (
    <section>
      <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-gray-700">
        {title}
        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800">
          {count}
        </span>
      </h2>
      <ul className="space-y-2">{children}</ul>
    </section>
  );
}

function ItemCard({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <li>
      <Link
        href={href}
        className="block rounded-xl border border-gray-200 bg-white p-4 shadow-sm transition hover:border-primary-200 hover:bg-primary-50/30"
      >
        {children}
      </Link>
    </li>
  );
}
