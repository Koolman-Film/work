import { redirect } from 'next/navigation';

/**
 * /admin/settings index — redirects to the first tab.
 *
 * Could render an overview dashboard in the future (counts per section,
 * recent edits, etc.) — for V1 the redirect keeps the URL canonical
 * without forcing the user through an interstitial.
 */
export default function SettingsIndexPage() {
  redirect('/admin/settings/branches');
}
