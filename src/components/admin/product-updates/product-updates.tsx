'use client';

import { useLocale } from 'next-intl';
import { useEffect, useRef } from 'react';
import type { Locale } from '@/lib/i18n/config';
import { UPDATES } from '@/lib/product-updates/registry';
import { runTour } from '@/lib/product-updates/run-tour';
import { nextAnnounce, tourById } from '@/lib/product-updates/selectors';
import { useProductUpdates } from '@/lib/product-updates/store';
import { TOURS } from '@/lib/product-updates/tours';
import { AnnouncementModal } from './announcement-modal';
import { WhatsNewPanel } from './whats-new-panel';

/** Marker id (kept in the seen-set) recording that the first-run welcome
 *  tour has already auto-started, so it fires exactly once per browser. */
const FIRST_RUN_KEY = 'first-run.welcome';

/**
 * Single client mount for the product-updates system (admin layout). Owns:
 *   - store hydration from localStorage,
 *   - first-run auto-start of the welcome tour (once),
 *   - running the active tour via driver.js,
 *   - rendering the announcement modal + what's-new panel.
 */
export function ProductUpdates({ initialSeen }: { initialSeen: string[] }) {
  const locale = useLocale() as Locale;
  const hydrate = useProductUpdates((s) => s.hydrate);
  const hydrated = useProductUpdates((s) => s.hydrated);
  const seen = useProductUpdates((s) => s.seen);
  const markSeen = useProductUpdates((s) => s.markSeen);
  const activeTourId = useProductUpdates((s) => s.activeTourId);
  const startTour = useProductUpdates((s) => s.startTour);
  const endTour = useProductUpdates((s) => s.endTour);

  // Hydrate the seen-set once on mount from the server-loaded value the
  // admin layout passed down (User.productUpdatesSeen). No flash: the value
  // is present on the first client render.
  useEffect(() => {
    hydrate(initialSeen);
  }, [hydrate, initialSeen]);

  // First-run: auto-start the welcome tour exactly once per browser — but
  // only when nothing is already interrupting. If an announcement modal is
  // pending (e.g. the welcome item itself), that modal is the better first
  // surface and offers "Take the tour"; we don't stack a driver overlay on
  // top of it. A user who dismisses the greeting still gets the tour once on
  // a later visit (FIRST_RUN_KEY not yet set, no pending announcement).
  const firstRunChecked = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: seen read once at hydrate edge
  useEffect(() => {
    if (!hydrated || firstRunChecked.current) return;
    firstRunChecked.current = true;
    if (!seen.has(FIRST_RUN_KEY) && nextAnnounce(UPDATES, seen) === null) {
      markSeen(FIRST_RUN_KEY);
      startTour('welcome');
    }
  }, [hydrated, markSeen, startTour]);

  // Run whichever tour is active; clean up on change/unmount.
  useEffect(() => {
    if (!activeTourId) return;
    const tour = tourById(TOURS, activeTourId);
    if (!tour) {
      endTour();
      return;
    }
    const cleanup = runTour(tour, locale, endTour);
    return cleanup;
  }, [activeTourId, locale, endTour]);

  return (
    <>
      <AnnouncementModal />
      <WhatsNewPanel />
    </>
  );
}
