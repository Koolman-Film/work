# Multilingual product-updates (tour + announcements + panel)

**Date:** 2026-07-06
**Status:** Approved (design)
**Area:** admin web · product-updates · i18n

## Problem

The admin welcome tour, the announcement modal, and the "What's New" panel are
only bilingual (Thai + English). The admin topbar language switcher offers all
**6 supported locales** (`th, en, my, lo, zh-CN, km` — see `src/lib/i18n/config.ts`),
so an admin who sets their UI to Burmese/Lao/Chinese/Khmer gets a fully
localized app **except** these product-updates surfaces, which silently fall
back to Thai. Make the whole product-updates feature render in all 6 languages.

## Why inline (not next-intl catalogs)

The product-updates feature deliberately ships copy **inline** (`LocalizedText`
in the code, resolved by `pickText`), and even its chrome button labels are
inline `locale === 'en' ? … : …` ternaries. next-intl message catalogs
(`messages/<code>.json`) are overwhelmingly a LIFF/worker-side mechanism (21
files use `useTranslations` there vs. 3 in admin). Extending the existing inline
model keeps this change self-contained, matches the feature's established
convention, and — because `pickText` already resolves any locale with a `th`
fallback — needs **zero rendering changes**.

## Decisions (locked)

1. **Approach:** extend the inline model (widen `LocalizedText`, populate
   translations, replace chrome ternaries with `pickText`). Do NOT migrate the
   feature to next-intl catalogs.
2. **Translation source:** the 4 non-th/en languages (my, lo, zh-CN, km) are
   **AI-drafted now** and flagged in-code as pending native-speaker proofread.
   th + en remain the human-authored source.
3. **Scope:** the whole feature — tour steps, the welcome announcement, and the
   modal/panel chrome — all 6 languages.
4. **Completeness test is strict:** every `LocalizedText` in the shipped content
   must carry all 6 locales, non-empty. This raises the bar for future
   entries (a new tour/announcement with only th/en will fail the test) — an
   accepted, intentional regression guard aligned with "fully multilingual".

## Design

### 1. Type change (no rendering change)

Widen `LocalizedText` in `src/lib/product-updates/types.ts` to all 6 locales,
DRY against the locale source of truth:

```ts
import type { Locale } from '@/lib/i18n/config';

/** Localized string. `th` is the required human-authored source; every other
 *  supported locale is optional and falls back to `th` via pickText.
 *  my/lo/zh-CN/km are AI-drafted — pending native-speaker proofread. */
export type LocalizedText = { th: string } & Partial<Record<Exclude<Locale, 'th'>, string>>;
```

`pickText` (`src/lib/product-updates/selectors.ts`) already does
`(text as Partial<Record<Locale, string>>)[locale] ?? text.th` — it resolves any
of the 6 locales unchanged. No edit to `pickText` is required (the internal cast
becomes redundant but stays harmless; leave it).

### 2. Content — add my/lo/zh-CN/km

Populate the 4 additional locales for every existing `LocalizedText`:

**`tours.ts`** — the `welcome` tour, 3 steps × (title + body):

| anchor | th | en |
|--------|----|----|
| sidebar-home (title) | หน้าหลัก | Home |
| sidebar-home (body) | ภาพรวมงานทั้งหมดเริ่มที่นี่ | Your dashboard overview starts here. |
| whats-new-button (title) | มีอะไรใหม่ | What's New |
| whats-new-button (body) | กดที่นี่เพื่อดูฟีเจอร์ใหม่และเริ่มทัวร์อีกครั้งได้ทุกเมื่อ | Open this anytime to see new features and replay tours. |
| topbar-bell (title) | การแจ้งเตือน | Notifications |
| topbar-bell (body) | งานที่ต้องดำเนินการจะแจ้งเตือนที่นี่ | Items needing your action show up here. |

**`registry.ts`** — the `welcome-2026-06` announcement:

| field | th | en |
|-------|----|----|
| title | ยินดีต้อนรับสู่ Koolman Work | Welcome to Koolman Work |
| body | ระบบจัดการงานบุคคลของคุณ ดูทัวร์แนะนำเพื่อเริ่มต้นใช้งานได้เลย | Your HR workspace. Take the quick tour to get started. |

(The implementer/author supplies the my/lo/zh-CN/km values for each row above.)

### 3. Chrome — new `ui-text.ts`, replace ternaries

Create `src/lib/product-updates/ui-text.ts` holding the chrome labels as
`LocalizedText` in all 6 languages:

```ts
import type { LocalizedText } from './types';

/** Localized chrome labels for product-updates surfaces.
 *  my/lo/zh-CN/km are AI-drafted — pending native-speaker proofread. */
export const UI = {
  seeAllUpdates: { th: 'ดูทั้งหมด', en: 'See all updates', /* my, lo, zh-CN, km */ },
  takeTheTour:   { th: 'ดูทัวร์แนะนำ', en: 'Take the tour', /* … */ },
  gotIt:         { th: 'เข้าใจแล้ว', en: 'Got it', /* … */ },
  whatsNewTitle: { th: 'มีอะไรใหม่', en: "What's New", /* … */ },
  takeTheTourArrow: { th: 'ดูทัวร์แนะนำ →', en: 'Take the tour →', /* … */ },
} satisfies Record<string, LocalizedText>;
```

Replace the inline ternaries:
- `announcement-modal.tsx`: `See all updates` → `pickText(UI.seeAllUpdates, locale)`;
  `Take the tour` → `pickText(UI.takeTheTour, locale)`; `Got it` → `pickText(UI.gotIt, locale)`.
- `whats-new-panel.tsx`: panel title → `pickText(UI.whatsNewTitle, locale)`;
  `Take the tour →` → `pickText(UI.takeTheTourArrow, locale)`.

Both files already import `pickText` (or will add it) and have `locale` in scope.

> Note: `takeTheTour` and `takeTheTourArrow` differ only by the trailing ` →`.
> Keep them as two entries (the arrow is presentational and lives with the label)
> rather than concatenating at the call site — simpler and keeps `pickText` the
> single resolution path.

### 4. Testing

- Extend `src/lib/product-updates/selectors.test.ts`:
  - `pickText` returns the correct value for `my`, `lo`, `zh-CN`, `km` when present.
  - `pickText` falls back to `th` when the requested locale key is absent.
- New completeness test (`src/lib/product-updates/i18n-completeness.test.ts`):
  collect every `LocalizedText` from `TOURS` (step titles + bodies), `UPDATES`
  (title + body), and `UI`; assert each has all 6 locale keys present and each
  value is a non-empty string. One failing entry names which surface/locale is
  missing.

## Files touched

| File | Change |
|------|--------|
| `src/lib/product-updates/types.ts` | widen `LocalizedText` to 6 locales |
| `src/lib/product-updates/tours.ts` | add my/lo/zh-CN/km to 6 strings + proofread-flag comment |
| `src/lib/product-updates/registry.ts` | add my/lo/zh-CN/km to 2 strings + flag comment |
| `src/lib/product-updates/ui-text.ts` | **new** — localized chrome labels (5 entries × 6 locales) |
| `src/components/admin/product-updates/announcement-modal.tsx` | 3 ternaries → `pickText(UI.…)` |
| `src/components/admin/product-updates/whats-new-panel.tsx` | 2 ternaries → `pickText(UI.…)` |
| `src/lib/product-updates/selectors.test.ts` | add my/lo/zh-CN/km + fallback cases |
| `src/lib/product-updates/i18n-completeness.test.ts` | **new** — all-6-locales-present guard |

No change to `pickText`, `run-tour.ts`, `store.ts`, the layout, or the DB.

## Error handling / edge cases

- A missing locale key in any `LocalizedText` degrades to `th` via `pickText`
  (never blank, never throws) — the completeness test ensures shipped content
  never actually hits this path.
- The tour's driver.js layer still resolves each step's copy to a plain string
  via `pickText` before rendering — unchanged.

## Out of scope / YAGNI

- No migration to next-intl catalogs.
- No runtime/Google machine translation at request time (translations are
  baked into the code now).
- No new locales; no change to the locale switcher, cookie, or `User.locale`.
- Translation *quality*: my/lo/zh-CN/km are AI-drafted and flagged; human
  proofreading is a follow-up, not part of this change.
```
