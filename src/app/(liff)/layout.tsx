/**
 * LIFF route group layout — minimal chrome for the LINE in-app browser.
 *
 * Differences from the admin/owner shells:
 *   - No sidebar, no topbar, no breadcrumbs. LINE's own header bar is
 *     already on screen; we draw inside the remaining 100vh-minus-header.
 *   - `min-h-dvh` (not `min-h-screen`) so mobile address bars / nav bars
 *     don't introduce vh-jank.
 *   - Subtle gray background (#f9fafb) — high contrast with white cards
 *     so check-in CTAs pop on small screens with bright outdoor light.
 *
 * Note: we deliberately do NOT call `requireRole(['Staff'])` here.
 * The /liff/pair route is the entry point where the User row gets *bound*
 * to LINE — at that moment the user has a Supabase session but no
 * matching User row yet. requireRole runs per-page on the protected
 * sub-routes (/liff/check-in, /liff/history, etc.) once the bind is done.
 */

import { LanguageSwitcher } from '@/components/liff/language-switcher';
import { LiffLocaleGate } from '@/components/liff/liff-locale-gate';

export default function LiffLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-gray-50">
      {/* Slim utility bar instead of a floating button: several LIFF pages
          already put their own action buttons in the top-right corner, so a
          fixed overlay would collide. In-flow keeps it collision-free. */}
      <div className="mx-auto flex max-w-md justify-end px-4 pt-3">
        <LanguageSwitcher />
      </div>
      {children}
      <LiffLocaleGate />
    </div>
  );
}
