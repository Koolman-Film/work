import { redirect } from 'next/navigation';

/**
 * /admin/settings → first entity. Cross-entity navigation is the sticky
 * settings sub-nav provided by the layout.
 */
export default function SettingsIndexPage() {
  redirect('/admin/settings/branches');
}
