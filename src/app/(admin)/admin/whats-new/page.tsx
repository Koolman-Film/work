import { WhatsNewPage } from '@/components/admin/product-updates/whats-new-page';
import { requireAdminArea } from '@/lib/auth/admin-area';
import { historyFor } from '@/lib/product-updates/history';

/**
 * Release notes for everyone admitted to the admin area — no permission beyond
 * admission, because every admin needs to know what changed. Content, header
 * and seen-state all render client-side in the reader's locale, the same
 * locale the pop-up uses, so the page can never mix two languages.
 *
 * The backfilled history (server-only, ~500 KB of copy) is handed down from
 * here so it never enters the bundle every other admin page loads.
 */
// The admin layout pins the locale to th ((admin)/layout.tsx), so only Thai
// is ever rendered here; send only that.
const ADMIN_LOCALE = 'th';

export default async function WhatsNewRoute() {
  await requireAdminArea();
  return (
    <div className="p-4">
      <WhatsNewPage history={historyFor(ADMIN_LOCALE)} />
    </div>
  );
}
