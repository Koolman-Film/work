# Multilingual: per-user locale, first-run modal, switcher & localized notifications

**Date:** 2026-06-09
**Status:** Design — approved, pending spec review
**Author:** brainstormed with Vivatchai Kaveeta

## Summary

Build the **per-user locale control plane** on top of the already-shipped i18n
infrastructure (Phase 1: `next-intl`, cookie-based `NEXT_LOCALE`, `src/lib/i18n/`),
and localize worker-facing LINE notifications. Concretely:

1. **Add Khmer (`km`)** as the 6th language → `th, en, my, lo, zh-CN, km`.
2. **Admin-set default language per employee** — a select on the employee edit
   page that writes the linked `User.locale`.
3. **First-run language modal** in LIFF — shown the first time a worker opens
   any LIFF page, pre-selected to the best guess, one tap to confirm.
4. **Language switcher** — a globe icon on every LIFF page to change language
   later.
5. **Admin ⇄ worker "last-write-wins"** with admin re-override, made real by a
   **LIFF cookie⇄DB reconciliation** so an admin's change reaches the worker on
   their next visit.
6. **Localized LINE notifications** — the 6 Flex-message kinds rendered in the
   recipient's language.
7. **Complex-script webfonts** (Noto Sans Myanmar/Khmer/Lao) so the UI renders
   inside the LINE in-app browser regardless of device fonts.

This is **Phase 3 (control plane)** + **Phase 4 (notifications)**. It depends on
**Phase 2 (content)** — extraction of hardcoded Thai UI strings into `th.json`
and translation — for visible UI impact; Phase 2 proceeds in parallel and is
tracked separately.

## Goals

- One more language (Khmer) added via the existing 2-step locale process.
- An admin can set, change, and re-override an employee's language from the
  employee edit page; the change reaches the worker on their next LIFF visit.
- A worker is asked their language exactly once (first LIFF visit), with a smart
  pre-selection, and can change it anytime via a switcher.
- "Admin can re-override, worker can switch again" semantics — last-write-wins
  between the two actors — with no timestamp gymnastics.
- Worker-facing LINE notifications (all 6 kinds) delivered in the worker's
  language, including the lock-screen `altText` preview.
- Non-Latin scripts render reliably in the LINE in-app browser.
- Reuse existing seams: `src/lib/i18n/*`, `setLocale()` server action, the
  `line-push` Inngest function, `format.ts`, the permission/audit system.

## Non-goals

- **No second locale column.** We keep the single effective `User.locale` and
  add one nullable flag (Approach A); we do not model admin-default and
  worker-choice as separate persisted values.
- **No Phase 2 string extraction in this spec.** Extracting/ translating the
  full UI is its own track; this spec delivers the *mechanism*, and assumes
  `th.json` is the source of truth.
- **No Traditional Chinese (`zh-TW`), Vietnamese, Japanese** — deferred; the
  resolver already refuses to silently map `zh-TW`→`zh-CN`.
- **No RTL work** — all 6 languages are left-to-right.
- **No Zawgyi (non-Unicode Burmese) support** — we standardize on Unicode;
  legacy-Zawgyi-only devices are accepted residual risk.
- **No admin/owner web first-run modal** — the modal is LIFF-only (worker
  audience). Admin/owner staff use the switcher; their login-time sync is
  unchanged.

## Key decisions

1. **Approach A — single effective `locale` + one chosen-flag.** Keep
   `User.locale` as the effective preference written by *both* admin and worker.
   Add `User.localeChosenByEmployeeAt DateTime?`. Last-write-wins falls out for
   free because both actors write the same field; the flag's *only* job is to
   decide whether the first-run modal fires. (Rejected: two columns + timestamps
   — more schema and a read-path change for an admin-UI nicety we don't need;
   event-sourced history — YAGNI.)

2. **DB is authoritative on LIFF entry.** A reconciliation step on LIFF load
   rewrites the `NEXT_LOCALE` cookie to match `User.locale` when they differ.
   This is what makes "admin re-override" actually reach a worker who never
   "logs in" — they just open the LINE mini-app. The existing login-time sync
   stays for email/web users. **Runtime constraint:** reconciliation runs in the
   LIFF **server layout** (Node, Prisma available), *not* the edge proxy — the
   proxy has no DB access (per the `src/lib/i18n/resolve.ts` docblock) and only
   seeds `NEXT_LOCALE` from headers on first hit.

3. **First-run modal: always show, pre-selected.** Fires when
   `localeChosenByEmployeeAt IS NULL` (even when an admin pre-set a default).
   Pre-selection order: **admin default (`User.locale`) → `liff.getLanguage()`
   → `Accept-Language` → Thai.** Guarantees a migrant worker actively confirms a
   language they can read and catches a wrong admin guess immediately.

4. **Labels are autonyms, never flags.** Each option shows its own-language name
   (`ไทย`, `English`, `မြန်မာ`, `ລາວ`, `简体中文`, `ភាសាខ្មែរ`) so a worker who
   can't read the current UI can still find their language. Flags are rejected —
   a language is not a country (Chinese/English have no clean flag).

5. **Missing-key fallback chain: target → English → Thai → key.** Thai is the
   guaranteed-complete source of truth, so it is the final real-text safety net
   before falling back to the raw key. Configured via next-intl
   `getMessageFallback` / `onError`.

6. **Notifications use `createTranslator`, not `getTranslations`.** The
   `line-push` function runs in Inngest (no request context), so it builds a
   context-free translator from the loaded catalog + locale and renders dates
   via `format.ts`. `altText` is localized plain text.

7. **Bundle Noto Sans Myanmar/Khmer/Lao webfonts.** Don't depend on device
   fonts inside the LINE in-app browser. Thai/Latin/CJK are well-covered by the
   existing stack; the three SE-Asian scripts are the gap.

## Data model

```prisma
model User {
  // ...
  locale                  String?    // effective preference (BCP 47); written
                                     // by admin AND worker; DB-authoritative on
                                     // LIFF entry. NULL ⇒ no one has set it.
  localeChosenByEmployeeAt DateTime? // set when the WORKER explicitly picks
                                     // (modal or switcher). NULL ⇒ first-run
                                     // modal fires. Admin writes never touch it.
}
```

- One hand-authored numbered migration (`pnpm db:deploy`, **not** `migrate dev`)
  adding the nullable column. No `Employee` change — the admin field edits the
  linked `User`.
- `User.locale` documentation comment updated: it is no longer "NULL until the
  *user* picks"; it is now "NULL until admin OR worker sets it; worker-explicit
  choice is tracked separately by `localeChosenByEmployeeAt`."

## Components & responsibilities

| Unit | Responsibility | New/Modify |
|------|----------------|-----------|
| `src/lib/i18n/config.ts` | add `'km'` to `LOCALES` + `LOCALE_LABELS` | Modify |
| `messages/km.json` | Khmer catalog (stub → translated) | Create |
| `src/lib/i18n/resolve.test.ts` | cover `km` matching | Modify |
| `src/lib/i18n/modal-trigger.ts` | pure `shouldShowLanguageModal(chosenAt)` + pre-select resolver | Create |
| `src/lib/i18n/reconcile.ts` | pure decision: given DB `locale` + cookie, what should the cookie become | Create |
| `src/lib/i18n/actions.ts` | extend `setLocale()` to also set `localeChosenByEmployeeAt` when the *worker* chooses | Modify |
| LIFF layout / entry (server) | load `User.locale` + `chosenAt`, run reconciliation, pass modal flag to client | Modify |
| `language-modal.tsx` (LIFF) | first-run picker (6 autonym targets), pre-selected | Create |
| `language-switcher.tsx` (LIFF) | globe icon → bottom-sheet of 6 autonyms | Create |
| employee edit page + action | admin "default language" select bound to `User.locale`; permission-gated; audit-logged | Modify/Create |
| `src/lib/line/flex-templates.ts` | thread `locale`; replace hardcoded Thai with translator + `format.ts`; localized `altText` | Modify |
| `src/lib/inngest/functions/line-push.ts` | add `locale` to the step-2 `select`; pass into `buildFlexMessage` | Modify |
| `messages/*.json` (all 6) | add `notifications.*` namespace (6 kinds) | Modify |
| app font setup | bundle Noto Sans Myanmar/Khmer/Lao; apply in LIFF | Modify |

## Data flow

**Worker first LIFF visit.** LIFF layout loads paired `User` → reconciliation
sets cookie from DB if present → `chosenAt IS NULL` ⇒ client shows modal,
pre-selected via `admin default → liff.getLanguage() → Accept-Language → th` →
worker taps a language → `setLocale()` writes `locale` + cookie +
`localeChosenByEmployeeAt = now` → `revalidatePath('/', 'layout')` re-renders in
the chosen language.

**Subsequent visits.** Reconciliation keeps cookie = DB `locale`; `chosenAt`
non-null ⇒ no modal; switcher available.

**Admin re-override.** Admin edits the select on the employee edit page →
`locale` updated in DB → worker's next LIFF visit: reconciliation sees DB ≠
cookie → cookie rewritten → UI in the admin's language; `chosenAt` untouched so
no modal; worker may switch again via the icon (which writes DB+cookie, becoming
the new latest write).

**Notification send.** Event fires → `line-push` step 2 selects
`lineUserId, archivedAt, locale` → `buildFlexMessage(payload, baseUrl, locale)`
renders the bubble + `altText` from `notifications.*` in that locale, dates via
`format.ts` → push to LINE.

## Error handling & edge cases

- **Unpaired / no `lineUserId`** — notification path already skips (unchanged);
  the worker simply hasn't seen the modal yet.
- **`locale` NULL everywhere** — resolver falls through Accept-Language → Thai
  default (existing behavior); modal still fires to capture a choice.
- **Missing translation key** — fallback chain target→en→th→key; never a raw key
  in practice because `th.json` is complete.
- **`setLocale()` DB write fails mid-pair** — already best-effort (cookie still
  set); `chosenAt` write is part of the same best-effort block.
- **Stale/edited cookie value** — `isLocale()` guard rejects it; reconciliation
  re-derives from DB.
- **Complex-script font missing on device** — mitigated by bundled webfonts;
  Zawgyi-only devices accepted as residual risk.

## Testing

- **Pure units:** `shouldShowLanguageModal`, pre-select resolver, reconcile
  decision, extended `resolve` for `km` — table-driven Vitest.
- **Notifications:** snapshot `buildFlexMessage` per locale × representative
  kinds; assert `altText` is localized plain text and dates use `format.ts`.
- **Action:** `setLocale()` sets `chosenAt` on worker pick but not on admin
  write.
- **E2E (Playwright):** first-run modal appears once and not again; switcher
  changes language; admin re-override flips the worker's next load.

## Phasing

- **Phase 3 — control plane:** schema + migration → Khmer → reconcile + modal
  trigger (pure) → extend `setLocale` → LIFF reconciliation + modal + switcher →
  admin default field → webfonts.
- **Phase 4 — localized notifications:** `line-push` locale lookup →
  `flex-templates` i18n + `format.ts` → `notifications.*` ×6.
- **Dependency:** Phase 2 (UI string extraction/translation) gates *visible* UI
  localization but not the mechanism; build in parallel.

## Open items (revisitable defaults, not blockers)

- Fallback chain set to target→en→th→key; revisit if en gaps are common.
- `localeSetBy` enum (audit/UX badge "set by HR") intentionally omitted for now.
- Locale-distribution analytics (a query over `User.locale`) deferred to a
  follow-up.
