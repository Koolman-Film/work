import { getTranslations } from 'next-intl/server';
import { Button } from '@/components/ui/button';
import { grantAdminAccess } from '../../actions';

export async function AdminAccessSection({
  employeeId,
  isAlreadyAdmin,
}: {
  employeeId: string;
  isAlreadyAdmin: boolean;
}) {
  const t = await getTranslations('adminAccess');
  const action = grantAdminAccess.bind(null, employeeId);
  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <h2 className="text-sm font-semibold text-gray-900">{t('title')}</h2>
      <p className="mt-1 text-xs text-gray-500">{t('description')}</p>
      {isAlreadyAdmin ? (
        <p className="mt-3 text-xs text-gray-500">{t('alreadyAdmin')}</p>
      ) : (
        <form action={action} className="mt-3">
          <Button type="submit" variant="secondary">{t('grant')}</Button>
        </form>
      )}
    </section>
  );
}
