'use client';

import { usePathname } from 'next/navigation';

/**
 * Replays the page entrance animation on every route change.
 *
 * The obvious implementation — `template.tsx`, which Next documents as
 * re-instantiating per navigation — does NOT work here, and it fails silently:
 * the animation plays on first load and never again, so a casual click-through
 * looks correct. Measured on Next 16 (probe in the commit message): navigating
 * /admin → /admin/employees left the template's div as the *same* DOM node with
 * its `enter-rise` animation still parked at currentTime 320ms, i.e. finished.
 * A template placed at a route-group level is only re-keyed when its own
 * segment changes, and `(admin)` never does.
 *
 * Keying a div on the pathname does not depend on that behaviour: React drops
 * the old node and mounts a new one whenever the key changes, and a fresh node
 * restarts the CSS animation. `children` arrives as a prop, so the server
 * components inside are unaffected by this client boundary.
 *
 * The key is the full pathname, so `/admin/employees/1` → `/admin/employees/2`
 * re-announces itself. Query-string changes (filters, pagination) do not touch
 * the pathname and therefore stay silent, which is deliberate.
 *
 * Design: docs/superpowers/specs/2026-07-31-page-fade-in-design.md
 */
export function PageFade({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div key={pathname} className="u-enter-page">
      {children}
    </div>
  );
}
