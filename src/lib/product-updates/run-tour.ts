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
    steps,
    onDestroyed: () => onDone(),
  });
  d.drive();

  return () => d.destroy();
}
