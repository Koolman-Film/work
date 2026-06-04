/**
 * Settings layout — thin pass-through. Each settings page owns its own
 * padding + PageHeader (with a breadcrumb back to the /admin/settings hub),
 * matching the leave/advance/attendance pages.
 */
export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
