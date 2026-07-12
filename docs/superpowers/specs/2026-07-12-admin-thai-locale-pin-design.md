# Pin the Admin Area to Thai — Design

**Date:** 2026-07-12
**Status:** Approved (design), pending implementation
**Author:** brainstormed with Claude

## Summary

Make the admin web UI render in **Thai regardless of the viewer's resolved
locale**, so a person whose `User.locale` is non-Thai (set via the employee
LIFF) no longer sees a mixed English/Thai admin. The employee/LIFF app keeps
honoring `User.locale` unchanged. This is a **~2-file change** (admin layout +
topbar) — it deliberately replaces the far larger "fully internationalize the
admin" effort, because the admin audience is Thai-only and the workforce
multilingualism belongs to the LIFF side.

## Context

- **Root layout** (`src/app/layout.tsx`) wraps the whole app in
  `<NextIntlClientProvider>` using the request-resolved locale
  (`getLocale()` → cookie `NEXT_LOCALE` → `Accept-Language` → `DEFAULT_LOCALE`,
  where the cookie mirrors `User.locale`, synced at login). So the admin inherits
  whatever locale the viewer chose.
- **Only 2 admin components use next-intl** — `admin/_components/merge-nudge.tsx`
  and `merge-prompt-card.tsx` (both client, `useTranslations`). Everything else
  in admin is **hardcoded Thai literals**. Those 2 are the entire source of the
  observed mixed-language symptom (they render English when the viewer's locale
  is `en`, while the hardcoded rest stays Thai).
- **Admin topbar** (`src/components/admin/topbar.tsx:132`) renders a
  `<LanguageSwitcher variant="topbar" />` — a Server Action that changes the
  user's global locale. In a Thai-only admin this is confusing: it alters the
  viewer's employee-app language from a screen whose content ignores it.
- `getMessages(locale: Locale)` exists (`src/lib/i18n/messages.ts:54`);
  `DEFAULT_LOCALE = 'th'` (`config.ts:32`).

## Decision

1. **Pin the admin subtree to Thai** by nesting a Thai-locale
   `NextIntlClientProvider` in the admin layout. Nested providers override the
   root for their subtree, so every client i18n component under `/admin` — the
   2 today plus any future one — renders Thai independent of the request locale.
2. **Remove the `LanguageSwitcher` from the admin topbar** — the admin is
   Thai-only; users change their employee-app language from the LIFF language
   modal (unchanged).
3. **Do not touch** the root layout, the LIFF, `request.ts`, `User.locale`, the
   login locale-sync, or any hardcoded-Thai admin string. The employee side is
   unaffected.

## Non-goals (explicit YAGNI)

- No extraction of the ~1,500 hardcoded Thai admin strings into i18n keys.
- No change to how the employee/LIFF app resolves or switches locale.
- No admin server-component locale override (there are zero admin server
  components using `getTranslations`; if one is added later it must pass
  `{ locale: 'th' }` — noted for future).
- No new locale, no schema/data change.

## Architecture

### `src/app/(admin)/layout.tsx`

- Import `NextIntlClientProvider` from `next-intl` and `getMessages` from
  `@/lib/i18n/messages`.
- Wrap the layout's returned JSX in
  `<NextIntlClientProvider locale="th" messages={getMessages('th')}>…</NextIntlClientProvider>`
  as the OUTERMOST element (around the existing `<ToastProvider>` + shell), so
  all admin client components (including the Topbar and page content) consume the
  Thai provider.
- The layout stays an async server component; `getMessages('th')` is a sync call
  returning the Thai catalog (already the fallback source of truth).

### `src/components/admin/topbar.tsx`

- Remove the `<div className="border-t border-gray-100"><LanguageSwitcher variant="topbar" /></div>`
  block and the now-unused `LanguageSwitcher` import.

## Behavior after the change

| Actor | Admin web | Employee LIFF |
|---|---|---|
| Thai-locale admin | Thai (as before) | Thai |
| `en`-locale admin (e.g. owner) | **Thai** (was mixed EN/TH) | English |
| Linked admin+employee, `User.locale = my` | **Thai** (was mixed) | **Burmese** (unchanged) |

## Testing

- **Unit/suite:** `pnpm test` stays green (no logic change; a layout wrap + a
  topbar removal). `tsc` + `biome` clean.
- **Browser smoke (the proof):** set `NEXT_LOCALE` to a non-Thai value (e.g.
  `en` or `my`), load `/admin` — the MergeNudge card (and any i18n admin text)
  renders **Thai**; confirm the topbar no longer shows the language switcher; and
  confirm a `/liff/*` page still renders in the cookie's locale (employee side
  unaffected).
- **Reversibility:** additive/removal only — no schema, no data, no server
  contract change. Revertable by dropping the provider wrap + restoring the
  switcher.

## Files

**Modified**
- `src/app/(admin)/layout.tsx` — nest the Thai `NextIntlClientProvider`.
- `src/components/admin/topbar.tsx` — remove the `LanguageSwitcher`.
