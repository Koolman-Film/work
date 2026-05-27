/**
 * Layout for all auth screens — login, password reset, update-password.
 *
 * Deliberately minimal: just a centered card on a neutral background.
 * No navigation, no sidebar — we don't want logged-out users
 * navigating into a half-rendered shell that hints at protected content.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh place-items-center bg-gray-50 px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold text-primary-700">Koolman HR</h1>
          <p className="mt-1 text-sm text-gray-500">ระบบ HR ภายใน</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-8 shadow-sm">{children}</div>
      </div>
    </div>
  );
}
