/**
 * /liff/admin/inbox — mobile pending-work inbox for paired admins.
 *
 * Three sections (same pending where-clauses as the admin web inboxes):
 *   - Leave requests      → /liff/admin/leave/[id]
 *   - Advance requests    → /liff/admin/advance/[id]
 *   - Check-ins to review → /liff/admin/dispute/[id]
 *
 * Localized via the `liffAdmin` namespace — the shared LIFF language switcher
 * applies to these admin screens too. Dates use the active locale so month
 * names follow the chosen language.
 */

import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';
import { permittedBranchesFromAssignments, viaEmployeeBranchScope } from '@/lib/auth/branch-scope';
import { getUserAssignments } from '@/lib/auth/check-permission';
import { requireLiffAdmin } from '@/lib/auth/require-liff-admin';
import { prisma } from '@/lib/db/prisma';
import type { Locale } from '@/lib/i18n/config';

function formatBkk(d: Date, locale: Locale): string {
  return d.toLocaleString(locale, {
    timeZone: 'Asia/Bangkok',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatBkkDate(d: Date, locale: Locale): string {
  return d.toLocaleDateString(locale, {
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

  const [t, locale] = await Promise.all([
    getTranslations('liffAdmin.inbox'),
    getLocale() as Promise<Locale>,
  ]);

  return (
    <main className="px-4 pt-4 pb-12">
      {empty ? (
        <div className="rounded-2xl border border-dashed border-line-strong bg-surface p-12 text-center">
          <p className="text-sm text-gray-500">{t('empty')}</p>
        </div>
      ) : (
        <div className="space-y-6">
          <Section title={t('leaveRequests')} count={leaves.length}>
            {leaves.map((r) => (
              <ItemCard key={r.id} href={`/liff/admin/leave/${r.id}`}>
                <p className="text-sm font-medium text-gray-900">{fullName(r.employee)}</p>
                <p className="mt-0.5 text-xs text-gray-500">
                  {r.leaveType.name} • {formatBkkDate(r.startDate, locale)}
                  {r.endDate.getTime() !== r.startDate.getTime()
                    ? ` – ${formatBkkDate(r.endDate, locale)}`
                    : ''}
                </p>
                <p className="mt-0.5 text-[10px] text-gray-400">
                  {t('submittedAt', { datetime: formatBkk(r.createdAt, locale) })}
                </p>
              </ItemCard>
            ))}
          </Section>

          <Section title={t('advanceRequests')} count={advances.length}>
            {advances.map((r) => (
              <ItemCard key={r.id} href={`/liff/admin/advance/${r.id}`}>
                <p className="text-sm font-medium text-gray-900">{fullName(r.employee)}</p>
                <p className="mt-0.5 text-lg font-semibold tabular-nums text-gray-900">
                  ฿{Number(r.amount).toLocaleString('th-TH')}
                </p>
                <p className="mt-0.5 text-[10px] text-gray-400">
                  {t('submittedAt', { datetime: formatBkk(r.requestedAt, locale) })}
                </p>
              </ItemCard>
            ))}
          </Section>

          <Section title={t('disputedCheckins')} count={disputes.length}>
            {disputes.map((r) => (
              <ItemCard key={r.id} href={`/liff/admin/dispute/${r.id}`}>
                <p className="text-sm font-medium text-gray-900">{fullName(r.employee)}</p>
                <p className="mt-0.5 text-xs text-gray-500">
                  {r.clockInAt
                    ? t('checkedInAt', { datetime: formatBkk(r.clockInAt, locale) })
                    : t('noCheckinTime')}
                </p>
                <p className="mt-0.5 text-[10px] text-gray-400">{t('tapToReview')}</p>
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
        className="block rounded-xl border border-line bg-surface p-4 shadow-sm transition hover:border-primary-200 hover:bg-primary-50/30"
      >
        {children}
      </Link>
    </li>
  );
}
