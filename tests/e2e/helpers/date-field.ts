/**
 * Driving `<DateField>` from Playwright.
 *
 * These forms used to render `<input type="date">`, so specs could just
 * `.fill('2000-05-20')`. They now render the Buddhist-era picker: a `<button>`
 * carrying the label, a popover grid, and a hidden `<input>` holding the ISO
 * value. `.fill()` on the labelled element throws "Element is not an <input>"
 * — an error that reads like a broken selector rather than a changed control.
 *
 * So: click the trigger, walk to the month, click the day — the real user path.
 *
 * The day cells are labelled with `formatShortDate`, which we import from the
 * app rather than reproduce. If that format changes, these helpers follow it
 * instead of silently failing to find a cell.
 */

import { expect, type Locator, type Page } from '@playwright/test';
import { formatShortDate } from '@/lib/i18n/format';

/** Today in Asia/Bangkok as YYYY-MM-DD — the app's timezone, not the runner's. */
export function todayIso(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/**
 * A date `months` from now on the given day-of-month, in Asia/Bangkok.
 *
 * Tests that need "some date that isn't today" should stay near today: the
 * picker only navigates one month per click, so a date years away costs a
 * click per month to reach.
 */
export function isoMonthsAhead(months: number, day: number): string {
  const [y, m] = todayIso().split('-').map(Number);
  // Date handles month overflow (13 → next January) on its own.
  const shifted = new Date(Date.UTC(y as number, (m as number) - 1 + months, day, 12));
  return shifted.toISOString().slice(0, 10);
}

/**
 * A future date nothing else occupies — for tests that create a row on a
 * date with a uniqueness constraint.
 *
 * Two ways a fixed date bites, both of which it already has:
 *   - The holiday seed covers 2026 only, and "two months out, day 23" landed
 *     exactly on วันปิยมหาราช once the month rolled over. Any fixed day
 *     eventually collides with a public holiday as the window slides.
 *   - Archiving is a soft delete, so a row from a previous run still holds
 *     the date against the uniqueness constraint.
 *
 * So: far enough out that the seed can't reach (2027+), on a day that varies
 * per run. The picker walks a month per click, which is milliseconds — the
 * distance costs far less than the flakiness did.
 */
export function unusedFutureDateIso(): string {
  const day = (Math.floor(Date.now() / 1000) % 28) + 1;
  return isoMonthsAhead(14, day);
}

/**
 * Pick `iso` (YYYY-MM-DD) in the DateField whose trigger is `trigger`.
 *
 * The popover opens on the field's current value, or today's month when empty.
 * Rather than compute the offset, this walks one month at a time until the
 * target cell exists, which is self-correcting. Adjacent-month cells are
 * rendered and clickable, so the walk usually stops a month early — harmless,
 * as each cell carries its own full date.
 */
export async function pickDate(page: Page, trigger: Locator, iso: string): Promise<void> {
  await trigger.click();

  const dialog = page.getByRole('dialog', { name: 'เลือกวันที่' });
  await expect(dialog).toBeVisible();

  const label = formatShortDate(new Date(`${iso}T12:00:00Z`), 'th');
  const cell = dialog.getByRole('gridcell', { name: label, exact: true });

  const forward = iso >= todayIso();
  const nav = dialog.getByRole('button', {
    name: forward ? 'เดือนถัดไป' : 'เดือนก่อนหน้า',
  });

  for (let i = 0; i < 36 && (await cell.count()) === 0; i++) {
    await nav.click();
  }

  // 36 hops without finding it means the target is out of reach or the label
  // format drifted — say so, rather than timing out on a click.
  await expect(cell, `no cell for ${iso} ("${label}") after walking 36 months`).toHaveCount(1);
  await cell.click();
  await expect(dialog).toBeHidden();
}

/** Clear a `clearable` DateField via the popover's ล้าง button. */
export async function clearDate(page: Page, trigger: Locator): Promise<void> {
  await trigger.click();

  const dialog = page.getByRole('dialog', { name: 'เลือกวันที่' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'ล้าง' }).click();
  await expect(dialog).toBeHidden();
}

/**
 * The hidden input a DateField submits, addressed by form field name.
 * The labelled element is the trigger button and has no value to assert on.
 */
export function dateValue(page: Page, name: string): Locator {
  return page.locator(`input[type="hidden"][name="${name}"]`);
}
