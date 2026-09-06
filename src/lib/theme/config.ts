/**
 * Theme contract, shared by the server action, the root layout and the toggle.
 *
 * Deliberately dependency-free so it can be imported from a Server Component,
 * a Server Action and a Client Component without dragging anything along.
 */

export const THEMES = ['light', 'dark', 'system'] as const;
export type Theme = (typeof THEMES)[number];

export const THEME_COOKIE_NAME = 'KM_THEME';
/** One year, matching the locale cookie's horizon. */
export const THEME_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export const DEFAULT_THEME: Theme = 'system';

export function isTheme(value: unknown): value is Theme {
  return typeof value === 'string' && (THEMES as readonly string[]).includes(value);
}

export type ThemeAttrs = {
  dataTheme: 'light' | 'dark' | undefined;
  colorScheme: 'light' | 'dark' | 'light dark';
};

/**
 * Maps the cookie to the attributes the root layout stamps on <html>.
 *
 * `system` — and any cookie we cannot read — deliberately stamps NO
 * data-theme. That omission is the whole no-flash property: the CSS
 * `@media (prefers-color-scheme: dark)` block resolves before first paint,
 * with no cookie read, no script and no hydration step.
 *
 * Stamping a concrete value here instead would mean guessing the visitor's OS
 * theme on the server, and a wrong guess is precisely what produces the flash
 * this design exists to avoid.
 */
export function resolveThemeAttrs(cookie: string | null | undefined): ThemeAttrs {
  if (cookie === 'dark') return { dataTheme: 'dark', colorScheme: 'dark' };
  if (cookie === 'light') return { dataTheme: 'light', colorScheme: 'light' };
  return { dataTheme: undefined, colorScheme: 'light dark' };
}
