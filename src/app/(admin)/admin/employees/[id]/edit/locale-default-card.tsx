import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { LOCALE_LABELS, LOCALES, type Locale } from '@/lib/i18n/config';
import { setEmployeeDefaultLocale } from './locale-actions';

/**
 * Admin "default language" card. Sets the linked User.locale. The select
 * shows the employee's CURRENT effective locale (which may be the worker's
 * own choice) — admins see reality, and saving re-overrides it. Blank =
 * "no default; detect on next visit".
 */
export function LocaleDefaultCard({
  employeeId,
  currentLocale,
}: {
  employeeId: string;
  currentLocale: Locale | null;
}) {
  const action = setEmployeeDefaultLocale.bind(null, employeeId);
  return (
    <Card>
      <CardHeader>
        <CardTitle>ภาษาเริ่มต้น (Default language)</CardTitle>
      </CardHeader>
      <CardBody>
        <p className="mb-3 text-sm text-ink-3">
          ตั้งภาษาที่พนักงานจะเห็นใน LIFF พนักงานยังเปลี่ยนเองได้ และการแก้ที่นี่จะมีผลในการเข้าใช้งานครั้งถัดไป
        </p>
        <form action={action} className="flex items-end gap-3">
          <div className="flex-1">
            <label htmlFor="default-locale" className="sr-only">
              Default language
            </label>
            <select
              id="default-locale"
              name="locale"
              defaultValue={currentLocale ?? ''}
              className="block w-full max-w-xs rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/30"
            >
              <option value="">— ตรวจจับอัตโนมัติ —</option>
              {LOCALES.map((code) => (
                <option key={code} value={code}>
                  {LOCALE_LABELS[code]}
                </option>
              ))}
            </select>
          </div>
          <Button type="submit">บันทึก</Button>
        </form>
      </CardBody>
    </Card>
  );
}
