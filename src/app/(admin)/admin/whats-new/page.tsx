import { WhatsNewPage } from '@/components/admin/product-updates/whats-new-page';
import { requireAdminArea } from '@/lib/auth/admin-area';

/**
 * Release notes for everyone admitted to the admin area — no permission beyond
 * admission, because every admin needs to know what changed. Content, header
 * and seen-state all render client-side in the reader's locale, the same
 * locale the pop-up uses, so the page can never mix two languages.
 */
export default async function WhatsNewRoute() {
  await requireAdminArea();
  return (
    <div className="p-4">
      <WhatsNewPage />
    </div>
  );
}
