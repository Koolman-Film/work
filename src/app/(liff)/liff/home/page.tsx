/**
 * /liff/home — capability-aware launcher for users who are an employee, an
 * admin, or BOTH. Renders an employee button group when the resolved User has
 * an Employee record, and an admin group when they hold liff.admin. The root
 * router (src/app/page.tsx) sends admin-employees here; pure workers/admins
 * keep their existing landing pages.
 */

import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { canDo } from '@/lib/auth/check-permission';
import { requireRole } from '@/lib/auth/require-role';
import { prisma } from '@/lib/db/prisma';

const tileCls =
  'flex flex-col items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-2 py-4 text-center text-sm font-medium text-gray-700 shadow-sm transition hover:border-primary-200 hover:text-primary-700';

export default async function LiffHomePage() {
  const { user, employee } = await requireRole(['Staff', 'Admin', 'Superadmin']);
  const hasEmployee = !!employee;
  const isAdmin = await canDo(user, 'liff.admin');
  if (!hasEmployee && !isAdmin) notFound();

  const t = await getTranslations('liffHome');
  const name = employee?.firstName ?? '';

  const pending = isAdmin
    ? await prisma.leaveRequest
        .count({ where: { status: 'Pending', deletedAt: null } })
        .then(async (lv) => lv + (await prisma.cashAdvance.count({ where: { status: 'Pending', deletedAt: null } })))
    : 0;

  return (
    <main className="mx-auto max-w-md space-y-6 px-4 pt-8 pb-12">
      <h1 className="text-2xl font-semibold text-gray-900">{t('greeting', { name })}</h1>

      {hasEmployee && (
        <section>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-emerald-700">
            {t('employeeGroup')}
          </p>
          <div className="grid grid-cols-3 gap-2.5">
            <a href="/liff/check-in" className={tileCls}>{t('checkIn')}</a>
            <a href="/liff/leave" className={tileCls}>{t('leave')}</a>
            <a href="/liff/advance" className={tileCls}>{t('advance')}</a>
          </div>
        </section>
      )}

      {isAdmin && (
        <section>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-violet-700">
            {t('adminGroup')}
          </p>
          <div className="grid grid-cols-3 gap-2.5">
            <a href="/liff/admin/inbox" className={`${tileCls} relative`}>
              {pending > 0 && (
                <span className="absolute right-2 top-2 rounded-full bg-red-600 px-1.5 py-0.5 text-[10px] font-medium text-white">
                  {pending}
                </span>
              )}
              {t('approvals')}
            </a>
            <a href="/admin" className={tileCls}>{t('dashboard')}</a>
            <a href="/admin/reports" className={tileCls}>{t('reports')}</a>
          </div>
        </section>
      )}
    </main>
  );
}
