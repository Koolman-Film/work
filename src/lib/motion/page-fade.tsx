'use client';

import { usePathname } from 'next/navigation';

/**
 * Replays the page entrance animation on route changes.
 *
 * The obvious implementation — `template.tsx`, which Next documents as
 * re-instantiating per navigation — does NOT work here, and it fails silently:
 * the animation plays on first load and never again, so a casual click-through
 * looks correct. Measured on Next 16: navigating /admin → /admin/employees left
 * the template's div as the *same* DOM node with its `enter-rise` animation
 * still parked at currentTime 320ms, i.e. finished. A template placed at a
 * route-group level is only re-keyed when its own segment changes, and
 * `(admin)` never does.
 *
 * Keying a div on the pathname does not depend on that behaviour: React drops
 * the old node and mounts a new one whenever the key changes, and a fresh node
 * restarts the CSS animation. `children` arrives as a prop, so the server
 * components inside are unaffected by this client boundary.
 *
 * Design: docs/superpowers/specs/2026-07-31-page-fade-in-design.md
 */

/**
 * Sections whose *layout* renders chrome of its own — a sticky sub-nav that
 * should hold still while you move between its tabs.
 *
 * Only these two qualify. `attendance` and `payroll` look like they belong
 * here, but their layouts are pass-throughs: those tab strips are rendered by
 * the pages themselves, so they are content and should fade with it.
 *
 * Every entry must pair with a `<SectionFade>` inside that section's layout,
 * or its pages stop animating altogether — tests/e2e/page-fade.spec.ts holds
 * that pairing for /admin/settings.
 */
const SECTIONS_WITH_OWN_CHROME = ['/admin/reports', '/admin/settings'] as const;

function areaKey(pathname: string): string {
  const section = SECTIONS_WITH_OWN_CHROME.find(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
  // Collapsing to the section prefix is the whole trick: the key is unchanged
  // across that section's tabs, so this node — and the sub-nav inside it —
  // survives the navigation untouched.
  return section ?? pathname;
}

/**
 * Area wrapper, used once per route-group layout.
 *
 * Fades on every navigation except between tabs of a section that owns its
 * chrome; those are handled one level down by `SectionFade`.
 */
export function PageFade({ children }: { children: React.ReactNode }) {
  const key = areaKey(usePathname());

  return (
    <div key={key} className="u-enter-page">
      {children}
    </div>
  );
}

/**
 * Inner wrapper for a section listed in `SECTIONS_WITH_OWN_CHROME`. Wraps only
 * that layout's `{children}`, so the sub-nav beside it stays put.
 *
 * Keyed on the full pathname, so `/admin/settings/branches` →
 * `/admin/settings/departments` re-announces itself. Query-string changes
 * (filters, pagination) leave the pathname alone and stay silent, which is
 * deliberate.
 */
export function SectionFade({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div key={pathname} className="u-enter-page">
      {children}
    </div>
  );
}
