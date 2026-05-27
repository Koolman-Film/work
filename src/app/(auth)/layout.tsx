/**
 * Layout for all auth screens — login, password reset, update-password.
 *
 * Styling matches docs/v1/screens/auth.md + mockup 01-login.html:
 *   - Page bg = subtle gradient from primary-50 to white
 *   - 56px primary-600 logo square (KM initials) above the card
 *   - Card has brand-glow shadow (colored shadow tinted with primary alpha)
 *
 * Deliberately minimal chrome — no nav, no sidebar — we don't want
 * logged-out users seeing affordances that hint at protected content.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh place-items-center bg-gradient-to-br from-primary-50 to-white px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center">
          <div className="grid size-14 place-items-center rounded-2xl bg-primary-600 shadow-brand">
            <span className="text-lg font-bold text-white">KM</span>
          </div>
          <h1 className="mt-4 text-xl font-semibold text-gray-900">Koolman HR</h1>
          <p className="mt-0.5 text-sm text-gray-500">ระบบ HR ภายใน</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-8 shadow-brand">
          {children}
        </div>
        <p className="mt-6 text-center text-xs text-gray-400">Powered by Koolman HR</p>
      </div>
    </div>
  );
}
