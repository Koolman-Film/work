'use client';

/**
 * driver.js wrapper. Translates our Tour model into driver steps, resolves
 * each step's data-tour anchor at start time, and drops steps whose anchor is
 * missing (e.g. an element on a page you're not on). If no steps resolve, the
 * tour is a no-op with a console warning.
 */

import { driver } from 'driver.js';
import 'driver.js/dist/driver.css';
import type { Locale } from '@/lib/i18n/config';
import { pickText } from './selectors';
import type { Tour } from './types';
import { UI } from './ui-text';

export function runTour(tour: Tour, locale: Locale, onDone: () => void): () => void {
  const steps = tour.steps
    .filter((s) => document.querySelector(`[data-tour="${s.anchor}"]`) !== null)
    .map((s) => ({
      element: `[data-tour="${s.anchor}"]`,
      popover: {
        title: pickText(s.title, locale),
        description: pickText(s.body, locale),
        side: s.side ?? 'bottom',
      },
    }));

  if (steps.length === 0) {
    console.warn(`[product-updates] tour "${tour.id}" had no resolvable anchors; skipping`);
    onDone();
    return () => {};
  }

  const d = driver({
    showProgress: true,
    allowClose: true,
    // driver.js ships English chrome ("Next", "Previous", "Done", "1 of 3").
    // The admin UI is pinned to Thai and the LIFF honours User.locale, so
    // untranslated buttons were the only English left in a Thai tour.
    nextBtnText: pickText(UI.tourNext, locale),
    prevBtnText: pickText(UI.tourPrev, locale),
    doneBtnText: pickText(UI.tourDone, locale),
    progressText: pickText(UI.tourProgress, locale),
    steps,
    onDestroyed: () => onDone(),
  });
  d.drive();

  return () => d.destroy();
}
