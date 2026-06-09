'use client';

/**
 * Presentational profile view — shared by the real /liff/profile page and
 * the i18n preview route, so screenshots reflect reality. Pure: all data
 * arrives as props; all chrome comes from `useTranslations('profile')` and
 * formatting from the locale-aware helpers in @/lib/i18n/format. Reads the
 * active locale from the nearest NextIntlClientProvider (request locale in
 * the real app; an explicit override in the preview).
 */

import { useLocale, useTranslations } from 'next-intl';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import type { Locale } from '@/lib/i18n/config';
import { formatDate, formatMoney } from '@/lib/i18n/format';
import type { UpdateProfileInput } from '@/lib/employee/profile-actions';
import { ProfileForm } from './profile-form';

export type ProfileViewData = {
  firstName: string;
  lastName: string;
  nickname: string | null;
  shortId: string;
  branchName: string;
  departmentName: string | null;
  salaryType: string;
  /** Decimal serialized to string at the server boundary. */
  baseSalary: string;
  /** ISO date string. */
  hiredAt: string;
};

export function ProfileView({
  employee,
  initial,
}: {
  employee: ProfileViewData;
  initial: UpdateProfileInput;
}) {
  const t = useTranslations('profile');
  const locale = useLocale() as Locale;

  const displayName =
    employee.nickname && employee.nickname.trim().length > 0
      ? employee.nickname
      : employee.firstName;
  const initials = (displayName[0] ?? '?').toUpperCase();

  return (
    <main className="mx-auto max-w-md px-4 pt-6 pb-12">
      {/* Header — identity card */}
      <Card className="mb-4">
        <CardBody className="!py-5">
          <div className="flex items-center gap-3">
            <span className="grid size-14 shrink-0 place-items-center rounded-full bg-primary-100 text-lg font-bold text-primary-700">
              {initials}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-base font-semibold text-gray-900">
                {employee.firstName} {employee.lastName}
                {employee.nickname && <span className="text-gray-500"> ({employee.nickname})</span>}
              </p>
              <p className="mt-0.5 truncate text-xs text-gray-500">
                EMP-{employee.shortId} • {employee.branchName}
                {employee.departmentName && ` · ${employee.departmentName}`}
              </p>
            </div>
          </div>
        </CardBody>
      </Card>

      {/* Edit-section — form */}
      <Card className="mb-4">
        <CardHeader>
          <CardTitle>{t('personalInfo')}</CardTitle>
        </CardHeader>
        <CardBody>
          <ProfileForm initial={initial} />
        </CardBody>
      </Card>

      {/* Read-only — employment info */}
      <Card className="mb-4">
        <CardHeader>
          <CardTitle>
            {t('jobInfo')}
            <span className="ml-2 text-xs font-normal text-gray-500">
              {t('contactAdminToEdit')}
            </span>
          </CardTitle>
        </CardHeader>
        <CardBody className="space-y-2 text-sm">
          <ReadOnlyRow label={t('readonly.branch')} value={employee.branchName} />
          <ReadOnlyRow label={t('readonly.department')} value={employee.departmentName ?? '—'} />
          <ReadOnlyRow label={t('readonly.payType')} value={t(`salaryType.${employee.salaryType}`)} />
          <ReadOnlyRow
            label={t('readonly.baseSalary')}
            value={formatMoney(employee.baseSalary, locale)}
          />
          <ReadOnlyRow
            label={t('readonly.startDate')}
            value={formatDate(new Date(employee.hiredAt), locale)}
          />
        </CardBody>
      </Card>

      <nav className="mt-6 flex justify-center gap-4 text-xs">
        <a href="/liff/check-in" className="text-gray-500 hover:text-gray-700">
          {t('backToCheckin')}
        </a>
      </nav>
    </main>
  );
}

function ReadOnlyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-xs text-gray-500">{label}</span>
      <span className="text-right text-sm text-gray-800">{value}</span>
    </div>
  );
}
