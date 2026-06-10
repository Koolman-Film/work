/**
 * Resolve a LeaveType display name for a locale.
 *
 * `LeaveType.name` is the Thai canonical name (unique, shown in the admin
 * UI). `LeaveType.nameByLocale` is an optional JSONB map of per-locale
 * translations ({"en": "Personal leave", ...}) edited on the admin
 * leave-type form. Worker-facing surfaces call this to pick the viewer's
 * locale with fallback to the canonical name.
 *
 * `nameByLocale` is typed `unknown` because it arrives as Prisma `Json` /
 * Inngest-deserialized JSON — this helper does the narrowing so callers
 * don't have to.
 */

import type { Locale } from '@/lib/i18n/config';

/** Narrow a Prisma `Json` value to the locale→name map shape (or null).
 *  Used when embedding nameByLocale into typed notification payloads. */
export function asNameByLocale(value: unknown): Record<string, string> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const entries = Object.entries(value as Record<string, unknown>).filter(
    (e): e is [string, string] => typeof e[1] === 'string',
  );
  return entries.length > 0 ? Object.fromEntries(entries) : null;
}

export function localizedLeaveTypeName(
  name: string,
  nameByLocale: unknown,
  locale: Locale,
): string {
  if (nameByLocale && typeof nameByLocale === 'object' && !Array.isArray(nameByLocale)) {
    const candidate = (nameByLocale as Record<string, unknown>)[locale];
    if (typeof candidate === 'string' && candidate.trim() !== '') return candidate.trim();
  }
  return name;
}
