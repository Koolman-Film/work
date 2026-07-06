# Multilingual product-updates — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render the admin product-updates surfaces (welcome tour, announcement modal, "What's New" panel) in all 6 supported locales instead of Thai+English only.

**Architecture:** Extend the feature's existing inline `LocalizedText` model to all 6 locales (`th` required source; `en`/`my`/`lo`/`zh-CN`/`km` optional, resolved by the existing `pickText` with a `th` fallback). Populate the 4 new languages for tour + announcement content, move the hardcoded `locale === 'en' ? …` chrome ternaries into a localized `UI` constants module resolved by `pickText`, and add a completeness test that guards all-6-locales-present. No rendering-engine, store, or DB change.

**Tech Stack:** TypeScript, next-intl (`useLocale`), vitest, biome. Locale source of truth: `src/lib/i18n/config.ts` (`LOCALES = ['th','en','my','lo','zh-CN','km']`).

## Global Constraints

- Package manager **pnpm**. Tests: `pnpm test <path>` (vitest). Lint: `pnpm lint` (biome). Typecheck: `pnpm typecheck`.
- The 6 locales are exactly `th, en, my, lo, zh-CN, km` (from `LOCALES` in `src/lib/i18n/config.ts`). `th` is the required human-authored source; `en` is human-authored; **`my`, `lo`, `zh-CN`, `km` are AI-drafted — every file that carries them gets a header comment saying so, pending native-speaker proofread.**
- Do NOT change `pickText`'s logic — only its stale doc comment. Do NOT migrate to next-intl catalogs. Do NOT touch the store, layout, DB, or `run-tour.ts`.
- Every `LocalizedText` in shipped content (tour steps, announcements, UI chrome) must carry all 6 locale keys, each a non-empty string.
- Object key `'zh-CN'` must be quoted (hyphen).
- Commit after every task. If a `git commit` fails only with `lint-staged not found` (not a lint error), re-run with `--no-verify`.

---

### Task 1: Widen `LocalizedText` to 6 locales; fix stale comments; pickText locale tests

**Files:**
- Modify: `src/lib/product-updates/types.ts` (the `LocalizedText` type + header comment)
- Modify: `src/lib/product-updates/selectors.ts` (stale `pickText` doc comment only)
- Test: `src/lib/product-updates/selectors.test.ts` (add cases)

**Interfaces:**
- Consumes: `Locale` from `@/lib/i18n/config`.
- Produces: `LocalizedText = { th: string } & Partial<Record<Exclude<Locale,'th'>, string>>` — accepts any of the 6 locale keys. Consumed by every later task (tours, registry, ui-text) and by `pickText`.

- [ ] **Step 1: Write the failing tests**

Add these cases to `src/lib/product-updates/selectors.test.ts`. Put them inside the existing `describe` for `pickText` if there is one, else add a new `describe('pickText locales', …)`. Also add — with the other imports at the top of the file — `import type { LocalizedText } from './types';` (`pickText` is already imported in this file).

The fixture in the first test is **annotated `LocalizedText`** on purpose: that annotation triggers TypeScript's excess-property check, so the `my`/`lo`/`zh-CN`/`km` keys are a compile error against the current `{ th; en? }` type — this is what makes the test genuinely RED before the widening.

```ts
  it('resolves each non-Thai locale when present', () => {
    const t: LocalizedText = {
      th: 'ไทย',
      en: 'English',
      my: 'မြန်မာ',
      lo: 'ລາວ',
      'zh-CN': '简体中文',
      km: 'ខ្មែរ',
    };
    expect(pickText(t, 'my')).toBe('မြန်မာ');
    expect(pickText(t, 'lo')).toBe('ລາວ');
    expect(pickText(t, 'zh-CN')).toBe('简体中文');
    expect(pickText(t, 'km')).toBe('ខ្មែរ');
  });

  it('falls back to th when the requested locale key is absent', () => {
    const t: LocalizedText = { th: 'ไทย', en: 'English' };
    expect(pickText(t, 'my')).toBe('ไทย');
    expect(pickText(t, 'km')).toBe('ไทย');
  });
```

- [ ] **Step 2: Run typecheck to verify RED**

vitest transforms TS with esbuild (types stripped, not checked), so `pnpm test` would *not* catch a type-only error. The genuine RED gate for this change is the typechecker:

Run: `pnpm typecheck`
Expected: FAIL — `tsc` reports an excess-property error on the annotated `LocalizedText` fixture in `selectors.test.ts` (the `my`/`lo`/`zh-CN`/`km` keys are not assignable to the current `{ th; en? }`). This proves the widening is actually needed.

- [ ] **Step 3: Widen the type**

In `src/lib/product-updates/types.ts`, replace the header comment and the `LocalizedText` line:

```ts
/**
 * Product-updates content model (admin web).
 *
 * All content is code-shipped — these types describe the typed registry
 * devs edit per release. Copy is inline & localized; `th` is the required
 * human-authored source and `en` is human-authored. `my`/`lo`/`zh-CN`/`km`
 * are AI-drafted (pending native-speaker proofread) and each falls back to
 * `th` via pickText when absent.
 */

import type { Locale } from '@/lib/i18n/config';

/** Localized string: `th` required; every other supported locale optional. */
export type LocalizedText = { th: string } & Partial<Record<Exclude<Locale, 'th'>, string>>;
```

(Leave the rest of `types.ts` — `UpdateItem`, `TourStep`, `Tour` — unchanged.)

- [ ] **Step 4: Update the stale `pickText` comment**

In `src/lib/product-updates/selectors.ts`, replace the `pickText` doc comment (the implementation body stays identical):

```ts
/** Localized value for `locale`, falling back to the required `th` source.
 *  `LocalizedText` now declares all 6 locales (th required, rest optional);
 *  a locale key that is absent yields `undefined` and falls back to `th`. */
export function pickText(text: LocalizedText, locale: Locale): string {
  return (text as Partial<Record<Locale, string>>)[locale] ?? text.th;
}
```

- [ ] **Step 5: Verify GREEN — typecheck and tests**

Run: `pnpm typecheck`
Expected: PASS (the widened type now accepts the fixture).

Run: `pnpm test src/lib/product-updates/selectors.test.ts`
Expected: PASS (existing 12 tests + 2 new; runtime behavior of `pickText` is unchanged — the fallback case confirms the `th` default).

- [ ] **Step 6: Commit**

```bash
git add src/lib/product-updates/types.ts src/lib/product-updates/selectors.ts src/lib/product-updates/selectors.test.ts
git commit -m "feat(product-updates): widen LocalizedText to all 6 locales"
```

---

### Task 2: Localized chrome — `ui-text.ts` + wire modal & panel

**Files:**
- Create: `src/lib/product-updates/ui-text.ts`
- Modify: `src/components/admin/product-updates/announcement-modal.tsx`
- Modify: `src/components/admin/product-updates/whats-new-panel.tsx`

**Interfaces:**
- Consumes: `LocalizedText` (Task 1); `pickText` (already exported).
- Produces: `UI` — an object of `LocalizedText` chrome labels (`seeAllUpdates`, `takeTheTour`, `gotIt`, `whatsNewTitle`, `takeTheTourArrow`). Consumed by the two components here and by the completeness test (Task 4).

- [ ] **Step 1: Create the localized chrome module**

Create `src/lib/product-updates/ui-text.ts`:

```ts
import type { LocalizedText } from './types';

/**
 * Localized chrome labels for the product-updates surfaces (modal + panel).
 * `th`/`en` are human-authored; `my`/`lo`/`zh-CN`/`km` are AI-drafted —
 * pending native-speaker proofread.
 */
export const UI = {
  seeAllUpdates: {
    th: 'ดูทั้งหมด',
    en: 'See all updates',
    my: 'အားလုံးကြည့်ရန်',
    lo: 'ເບິ່ງທັງໝົດ',
    'zh-CN': '查看全部',
    km: 'មើលទាំងអស់',
  },
  takeTheTour: {
    th: 'ดูทัวร์แนะนำ',
    en: 'Take the tour',
    my: 'လမ်းညွှန်ကြည့်ရန်',
    lo: 'ເບິ່ງທົວແນະນຳ',
    'zh-CN': '开始导览',
    km: 'មើលដំណើរកម្សាន្ត',
  },
  gotIt: {
    th: 'เข้าใจแล้ว',
    en: 'Got it',
    my: 'နားလည်ပါပြီ',
    lo: 'ເຂົ້າໃຈແລ້ວ',
    'zh-CN': '知道了',
    km: 'យល់ហើយ',
  },
  whatsNewTitle: {
    th: 'มีอะไรใหม่',
    en: "What's New",
    my: 'အသစ်များ',
    lo: 'ມີຫຍັງໃໝ່',
    'zh-CN': '新功能',
    km: 'អ្វីថ្មី',
  },
  takeTheTourArrow: {
    th: 'ดูทัวร์แนะนำ →',
    en: 'Take the tour →',
    my: 'လမ်းညွှန်ကြည့်ရန် →',
    lo: 'ເບິ່ງທົວແນະນຳ →',
    'zh-CN': '开始导览 →',
    km: 'មើលដំណើរកម្សាន្ត →',
  },
} satisfies Record<string, LocalizedText>;
```

- [ ] **Step 2: Wire the announcement modal**

In `src/components/admin/product-updates/announcement-modal.tsx`:

Add the import (next to the existing `pickText` import):

```ts
import { UI } from '@/lib/product-updates/ui-text';
```

Replace the three chrome ternaries:
- `{locale === 'en' ? 'See all updates' : 'ดูทั้งหมด'}` → `{pickText(UI.seeAllUpdates, locale)}`
- `{locale === 'en' ? 'Take the tour' : 'ดูทัวร์แนะนำ'}` → `{pickText(UI.takeTheTour, locale)}`
- `{locale === 'en' ? 'Got it' : 'เข้าใจแล้ว'}` → `{pickText(UI.gotIt, locale)}`

(`pickText` and `locale` are already in scope in this file.)

- [ ] **Step 3: Wire the What's New panel**

In `src/components/admin/product-updates/whats-new-panel.tsx`:

Add the import:

```ts
import { UI } from '@/lib/product-updates/ui-text';
```

Replace the two chrome ternaries:
- `title={locale === 'en' ? "What's New" : 'มีอะไรใหม่'}` → `title={pickText(UI.whatsNewTitle, locale)}`
- `{locale === 'en' ? 'Take the tour →' : 'ดูทัวร์แนะนำ →'}` → `{pickText(UI.takeTheTourArrow, locale)}`

(`pickText` and `locale` are already imported/in scope in this file.)

- [ ] **Step 4: Typecheck + commit**

Run: `pnpm typecheck`
Expected: PASS (no unused-var warnings; both files still use `pickText` and `locale`).

```bash
git add src/lib/product-updates/ui-text.ts "src/components/admin/product-updates/announcement-modal.tsx" "src/components/admin/product-updates/whats-new-panel.tsx"
git commit -m "feat(product-updates): localize modal + panel chrome to all 6 locales"
```

---

### Task 3: Translate tour + announcement content to all 6 locales

**Files:**
- Modify: `src/lib/product-updates/tours.ts`
- Modify: `src/lib/product-updates/registry.ts`

**Interfaces:**
- Consumes: the widened `LocalizedText` (Task 1).
- Produces: `TOURS` and `UPDATES` whose every `LocalizedText` carries all 6 locales. Consumed by the completeness test (Task 4) and the live surfaces.

- [ ] **Step 1: Translate the welcome tour**

In `src/lib/product-updates/tours.ts`, add the file-header proofread note above the imports:

```ts
// th/en are human-authored; my/lo/zh-CN/km are AI-drafted — pending
// native-speaker proofread.
```

Replace each step's `title`/`body` objects with the fully-localized versions:

```ts
      {
        anchor: 'sidebar-home',
        title: { th: 'หน้าหลัก', en: 'Home', my: 'ပင်မစာမျက်နှာ', lo: 'ໜ້າຫຼັກ', 'zh-CN': '主页', km: 'ទំព័រដើម' },
        body: {
          th: 'ภาพรวมงานทั้งหมดเริ่มที่นี่',
          en: 'Your dashboard overview starts here.',
          my: 'အလုပ်အားလုံး၏ ခြုံငုံသုံးသပ်ချက်ကို ဤနေရာမှ စတင်ပါသည်။',
          lo: 'ພາບລວມຂອງວຽກທັງໝົດເລີ່ມຢູ່ນີ້.',
          'zh-CN': '所有工作的概览从这里开始。',
          km: 'ទិដ្ឋភាពរួមនៃការងារទាំងអស់ចាប់ផ្តើមនៅទីនេះ។',
        },
        side: 'right',
      },
      {
        anchor: 'whats-new-button',
        title: { th: 'มีอะไรใหม่', en: "What's New", my: 'အသစ်များ', lo: 'ມີຫຍັງໃໝ່', 'zh-CN': '新功能', km: 'អ្វីថ្មី' },
        body: {
          th: 'กดที่นี่เพื่อดูฟีเจอร์ใหม่และเริ่มทัวร์อีกครั้งได้ทุกเมื่อ',
          en: 'Open this anytime to see new features and replay tours.',
          my: 'ဤနေရာကို အချိန်မရွေးဖွင့်၍ လုပ်ဆောင်ချက်အသစ်များကြည့်ကာ လမ်းညွှန်ကို ပြန်ကြည့်နိုင်ပါသည်။',
          lo: 'ເປີດບ່ອນນີ້ໄດ້ທຸກເມື່ອເພື່ອເບິ່ງຄຸນສົມບັດໃໝ່ ແລະ ເບິ່ງທົວອີກຄັ້ງ.',
          'zh-CN': '随时打开这里查看新功能并重新播放导览。',
          km: 'បើកនៅទីនេះបានគ្រប់ពេលដើម្បីមើលមុខងារថ្មី និងចាក់បង្ហាញដំណើរកម្សាន្តឡើងវិញ។',
        },
        side: 'right',
      },
      {
        anchor: 'topbar-bell',
        title: { th: 'การแจ้งเตือน', en: 'Notifications', my: 'အသိပေးချက်များ', lo: 'ການແຈ້ງເຕືອນ', 'zh-CN': '通知', km: 'ការជូនដំណឹង' },
        body: {
          th: 'งานที่ต้องดำเนินการจะแจ้งเตือนที่นี่',
          en: 'Items needing your action show up here.',
          my: 'သင်ဆောင်ရွက်ရန်လိုအပ်သော အရာများကို ဤနေရာတွင် ဖော်ပြပါမည်။',
          lo: 'ລາຍການທີ່ຕ້ອງການການດຳເນີນການຈະສະແດງຢູ່ນີ້.',
          'zh-CN': '需要您处理的事项会显示在这里。',
          km: 'ធាតុដែលត្រូវការសកម្មភាពរបស់អ្នកនឹងបង្ហាញនៅទីនេះ។',
        },
        side: 'bottom',
      },
```

- [ ] **Step 2: Translate the welcome announcement**

In `src/lib/product-updates/registry.ts`, add the same proofread note above the imports, then replace the `welcome-2026-06` item's `title`/`body`:

```ts
    title: {
      th: 'ยินดีต้อนรับสู่ Koolman Work',
      en: 'Welcome to Koolman Work',
      my: 'Koolman Work မှ ကြိုဆိုပါသည်',
      lo: 'ຍິນດີຕ້ອນຮັບສູ່ Koolman Work',
      'zh-CN': '欢迎使用 Koolman Work',
      km: 'សូមស្វាគមន៍មកកាន់ Koolman Work',
    },
    body: {
      th: 'ระบบจัดการงานบุคคลของคุณ ดูทัวร์แนะนำเพื่อเริ่มต้นใช้งานได้เลย',
      en: 'Your HR workspace. Take the quick tour to get started.',
      my: 'သင်၏ HR လုပ်ငန်းခွင်။ စတင်အသုံးပြုရန် အမြန်လမ်းညွှန်ကို ကြည့်ရှုပါ။',
      lo: 'ບ່ອນເຮັດວຽກ HR ຂອງທ່ານ. ເບິ່ງທົວແນະນຳໄວໆເພື່ອເລີ່ມຕົ້ນ.',
      'zh-CN': '您的人力资源工作区。观看快速导览即可开始使用。',
      km: 'កន្លែងធ្វើការ HR របស់អ្នក។ មើលដំណើរកម្សាន្តរហ័សដើម្បីចាប់ផ្តើម។',
    },
```

(Keep `id`, `date`, `announce`, `tour` unchanged.)

- [ ] **Step 3: Typecheck + commit**

Run: `pnpm typecheck`
Expected: PASS.

```bash
git add src/lib/product-updates/tours.ts src/lib/product-updates/registry.ts
git commit -m "feat(product-updates): translate tour + welcome announcement to all 6 locales"
```

---

### Task 4: Completeness test — every LocalizedText has all 6 locales

**Files:**
- Create: `src/lib/product-updates/i18n-completeness.test.ts`

**Interfaces:**
- Consumes: `LOCALES` from `@/lib/i18n/config`; `TOURS` from `./tours`; `UPDATES` from `./registry`; `UI` from `./ui-text` (Task 2).
- Produces: a regression guard — fails if any shipped `LocalizedText` is missing a locale or has an empty value.

- [ ] **Step 1: Write the completeness test**

Create `src/lib/product-updates/i18n-completeness.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { LOCALES } from '@/lib/i18n/config';
import { UPDATES } from './registry';
import { TOURS } from './tours';
import type { LocalizedText } from './types';
import { UI } from './ui-text';

/**
 * Guards that every shipped LocalizedText carries all 6 supported locales,
 * each a non-empty string. A new tour/announcement/chrome label with only
 * th/en fails here rather than silently falling back to Thai.
 */

// [label, LocalizedText] pairs across every product-updates surface.
function allStrings(): Array<[string, LocalizedText]> {
  const out: Array<[string, LocalizedText]> = [];
  for (const tour of TOURS) {
    for (const step of tour.steps) {
      out.push([`tour ${tour.id}/${step.anchor} title`, step.title]);
      out.push([`tour ${tour.id}/${step.anchor} body`, step.body]);
    }
  }
  for (const item of UPDATES) {
    out.push([`update ${item.id} title`, item.title]);
    out.push([`update ${item.id} body`, item.body]);
  }
  for (const [key, value] of Object.entries(UI)) {
    out.push([`ui ${key}`, value]);
  }
  return out;
}

describe('product-updates i18n completeness', () => {
  it.each(allStrings())('%s has all 6 locales, non-empty', (_label, text) => {
    const record = text as Record<string, unknown>;
    for (const locale of LOCALES) {
      expect(typeof record[locale]).toBe('string');
      expect((record[locale] as string).length).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it passes**

Run: `pnpm test src/lib/product-updates/i18n-completeness.test.ts`
Expected: PASS — one parametrized case per string (13 entries: 6 tour + 2 update + 5 UI), all green because Tasks 2 & 3 populated all 6 locales.

> If any case FAILS, it names the exact surface + locale missing — fix the data
> in `tours.ts`/`registry.ts`/`ui-text.ts` (do not weaken the test).

- [ ] **Step 3: Commit**

```bash
git add src/lib/product-updates/i18n-completeness.test.ts
git commit -m "test(product-updates): guard all-6-locales completeness"
```

---

### Task 5: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Run the product-updates suite**

Run: `pnpm test src/lib/product-updates`
Expected: PASS — selectors, completeness, plus the pre-existing seen-json/actions/store/selectors tests.

- [ ] **Step 2: Full suite + lint + typecheck**

Run: `pnpm test`
Expected: PASS (all files).

Run: `pnpm typecheck`
Expected: PASS.

Run: `pnpm lint` — our feature's files must be clean. (Pre-existing lint debt in unrelated files, if any, is out of scope.) Confirm with:
`pnpm lint 2>&1 | grep -E "product-updates|announcement-modal|whats-new-panel" || echo "no lint issues in our files"`
Expected: `no lint issues in our files`.

- [ ] **Step 3: Confirm no stray `locale === 'en'` ternaries remain in product-updates surfaces**

Run: `grep -rn "locale === 'en'" src/components/admin/product-updates`
Expected: no matches (all chrome now goes through `pickText(UI.…)`).

- [ ] **Step 4: Manual spot check (optional, local stack)**

With `pnpm dev`, log in as an admin, switch the topbar language to Burmese (or Lao/Chinese/Khmer), open "What's New" and replay the tour — the step titles/bodies, buttons, and announcement render in the chosen language (not Thai).

---

## Notes for the implementer

- The my/lo/zh-CN/km strings are **AI-drafted** and flagged in-code; do not treat them as final copy. A native-speaker proofread is a separate follow-up.
- Do not concatenate the ` →` onto `takeTheTour` at the call site — `takeTheTourArrow` is a distinct entry so all resolution stays through `pickText`.
- Keep `'zh-CN'` quoted everywhere (hyphenated key).
