# Multilingual Phase 4 — Localized LINE notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver worker-facing LINE push notifications (all 6 Flex kinds) in each recipient's preferred language, including the lock-screen `altText` preview, while implementing the spec's missing-key fallback chain (target → English → Thai → key) for both notifications and the UI.

**Architecture:** A shared, synchronous message loader (`getMessages(locale)`) statically imports all 6 small JSON catalogs and deep-merges them as `th (base) ← en ← target`, which IS the fallback chain. `getRequestConfig` consumes it for UI rendering. The notification renderer runs in Inngest (no request context), so `buildFlexMessage(payload, baseUrl, locale)` uses next-intl's context-free `createTranslator` over `getMessages(locale)` plus the existing locale-aware `format.ts` helpers. The send path (`line-push`) reads the recipient's `User.locale` in its existing lookup step and threads it in. Only template *chrome* is localized — payload-embedded dynamic values (`leaveTypeName`, `reviewNote`) stay as stored.

**Tech Stack:** `next-intl` v4 (`createTranslator`), Inngest, Prisma 6, `@line/bot-sdk` Flex messages, Vitest. Run all commands with `/opt/homebrew/bin` on PATH (Node 24+/pnpm).

**Spec:** `docs/superpowers/specs/2026-06-09-multilingual-per-user-locale-design.md` (§ Phase 4 + Key decision 5 & 6).

**Depends on:** Phase 3 (Khmer in `LOCALES`; `User.locale` semantics). Phase 4 can be built independently of Phase 3's UI tasks but assumes `km` exists in `config.ts`.

---

## File structure

| File | Responsibility | New/Modify |
|------|----------------|-----------|
| `src/lib/i18n/messages.ts` | static-import 6 catalogs; `deepMerge`; `getMessages(locale)` (target←en←th) | Create |
| `src/lib/i18n/messages.test.ts` | unit tests for merge + fallback order | Create |
| `src/lib/i18n/request.ts` | use `getMessages(locale)` (activates UI fallback chain) | Modify |
| `messages/th.json` | add `notifications.*` namespace (Thai — source of truth) | Modify |
| `messages/en.json` | add `notifications.*` namespace (English) | Modify |
| `src/lib/line/flex-templates.ts` | `buildFlexMessage(payload, baseUrl, locale)`; `createTranslator` + `format.ts`; localized `altText`; drop `fmtThaiDate` | Modify |
| `src/lib/line/flex-templates.test.ts` | per-locale assertions for each kind | Create |
| `src/lib/inngest/functions/line-push.ts` | select `locale`; pass into `buildFlexMessage` | Modify |

**Build order:** message loader (+test) → request.ts swap → th/en notification keys → flex-templates refactor (+test) → line-push wiring. Commit after each task; confirm `git log --oneline -1` is your commit.

**Pre-flight:** `export PATH=/opt/homebrew/bin:$PATH && cd <worktree> && pnpm install`. Confirm `tsconfig.json` has `"resolveJsonModule": true` (it must, for the static JSON imports in Task 1; the existing dynamic `import('messages/...json')` in request.ts implies JSON modules already resolve).

---

## Task 1: Shared message loader with fallback merge

**Files:**
- Create: `src/lib/i18n/messages.ts`
- Test: `src/lib/i18n/messages.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/i18n/messages.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { deepMerge, getMessages } from './messages';

describe('deepMerge', () => {
  it('overlays later layers over earlier ones, recursively', () => {
    const base = { a: '1', nested: { x: 'th-x', y: 'th-y' } };
    const over = { nested: { y: 'en-y' } };
    expect(deepMerge(base, over)).toEqual({ a: '1', nested: { x: 'th-x', y: 'en-y' } });
  });

  it('does not mutate inputs', () => {
    const base = { nested: { x: '1' } };
    deepMerge(base, { nested: { x: '2' } });
    expect(base.nested.x).toBe('1');
  });
});

describe('getMessages', () => {
  it('returns an object containing the notifications namespace for every locale', () => {
    for (const loc of ['th', 'en', 'my', 'lo', 'zh-CN', 'km'] as const) {
      const m = getMessages(loc) as Record<string, unknown>;
      expect(m.notifications).toBeTypeOf('object');
    }
  });

  it('falls back to Thai for keys missing in an untranslated locale', () => {
    // km.json has no notifications keys yet → must resolve from th (base).
    const km = getMessages('km') as { notifications: { leaveApproved: { header: string } } };
    const th = getMessages('th') as { notifications: { leaveApproved: { header: string } } };
    expect(km.notifications.leaveApproved.header).toBe(th.notifications.leaveApproved.header);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `export PATH=/opt/homebrew/bin:$PATH && pnpm vitest run src/lib/i18n/messages.test.ts`
Expected: FAIL — cannot find module `./messages` (and the fallback test will only pass after Task 3 adds keys; see Step 4 note).

- [ ] **Step 3: Implement the loader**

Create `src/lib/i18n/messages.ts`:

```ts
/**
 * Message catalog loader with the fallback chain: target ← English ← Thai.
 *
 * Thai is the source of truth (always complete), so it is the base layer;
 * English overlays it; the target locale overlays both. A key missing in
 * the target therefore resolves to English, then Thai, before next-intl
 * would ever fall back to the raw key. Catalogs are tiny (text only), so
 * we static-import all six and merge synchronously — this keeps the
 * notification renderer (Inngest, no request) synchronous.
 */

import type { Locale } from './config';
import en from '../../../messages/en.json';
import km from '../../../messages/km.json';
import lo from '../../../messages/lo.json';
import my from '../../../messages/my.json';
import th from '../../../messages/th.json';
import zhCN from '../../../messages/zh-CN.json';

type Messages = Record<string, unknown>;

const CATALOGS: Record<Locale, Messages> = {
  th: th as Messages,
  en: en as Messages,
  my: my as Messages,
  lo: lo as Messages,
  'zh-CN': zhCN as Messages,
  km: km as Messages,
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Deep-merge plain objects left→right (right wins). Pure; no mutation. */
export function deepMerge(...layers: Messages[]): Messages {
  const out: Messages = {};
  for (const layer of layers) {
    for (const [k, v] of Object.entries(layer)) {
      const prev = out[k];
      out[k] = isPlainObject(prev) && isPlainObject(v) ? deepMerge(prev, v) : v;
    }
  }
  return out;
}

/** Merged catalog for `locale`: th (base) ← en ← target. */
export function getMessages(locale: Locale): Messages {
  if (locale === 'th') return CATALOGS.th;
  if (locale === 'en') return deepMerge(CATALOGS.th, CATALOGS.en);
  return deepMerge(CATALOGS.th, CATALOGS.en, CATALOGS[locale]);
}
```

- [ ] **Step 4: Run the merge tests**

Run: `export PATH=/opt/homebrew/bin:$PATH && pnpm vitest run src/lib/i18n/messages.test.ts -t deepMerge`
Expected: PASS for the `deepMerge` block. The `getMessages` fallback test depends on Task 3 (it asserts notification keys exist in Thai); it will pass after Task 3. Leave both files; re-run the full file at the end of Task 3.

- [ ] **Step 5: Commit**

```bash
git add src/lib/i18n/messages.ts src/lib/i18n/messages.test.ts
git commit -m "feat(i18n): shared message loader with target<-en<-th fallback merge"
```

---

## Task 2: Route UI rendering through the fallback loader

**Files:**
- Modify: `src/lib/i18n/request.ts`

- [ ] **Step 1: Replace the dynamic single-catalog import**

In `src/lib/i18n/request.ts`, replace:

```ts
  const messages = (await import(`../../../messages/${locale}.json`)).default;

  return { locale, messages };
```

with:

```ts
  // getMessages applies the fallback chain (target ← en ← th), so an
  // untranslated key renders English, then Thai, before the raw key.
  const { getMessages } = await import('./messages');
  return { locale, messages: getMessages(locale) };
```

Update the surrounding docblock (the paragraph about "loads the locale's message catalog") to mention the fallback merge instead of a single-file load.

- [ ] **Step 2: Typecheck**

Run: `export PATH=/opt/homebrew/bin:$PATH && pnpm tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/i18n/request.ts
git commit -m "feat(i18n): render UI through fallback-merged catalogs"
```

---

## Task 3: Add the `notifications.*` namespace (Thai + English)

Only Thai (source of truth) and English get real strings now; `my/lo/km/zh-CN` intentionally omit them and resolve via the fallback merge until translators deliver (per spec). Placeholders use ICU params: `{type}`, `{amount}`, `{date}`, `{days}`.

**Files:**
- Modify: `messages/th.json`
- Modify: `messages/en.json`

- [ ] **Step 1: Add the namespace to `messages/th.json`**

Add a top-level `"notifications"` key (sibling of `_meta`):

```json
  "notifications": {
    "action": { "viewDetails": "ดูรายละเอียด", "viewAttendance": "ดูประวัติเช็คอิน" },
    "label": { "duration": "ระยะเวลา", "workingDays": "วันทำงาน", "note": "หมายเหตุ", "reason": "เหตุผล" },
    "workingDaysValue": "{days} วัน",
    "leaveApproved": { "header": "อนุมัติคำขอลา", "alt": "✅ คำขอลา {type} ของคุณได้รับการอนุมัติ" },
    "leaveRejected": { "header": "ไม่อนุมัติคำขอลา", "alt": "❌ คำขอลา {type} ของคุณถูกปฏิเสธ" },
    "advanceApproved": { "header": "อนุมัติคำขอเบิก", "subtitle": "จะหักจากเงินเดือนงวดถัดไป", "alt": "✅ คำขอเบิก ฿{amount} ของคุณได้รับการอนุมัติ" },
    "advanceRejected": { "header": "ไม่อนุมัติคำขอเบิก", "subtitle": "กรุณาติดต่อแอดมินเพื่อขอข้อมูลเพิ่มเติม", "alt": "❌ คำขอเบิก ฿{amount} ของคุณถูกปฏิเสธ" },
    "disputeApproved": { "header": "ยืนยันการเช็คอิน", "subtitle": "แอดมินตรวจสอบและยืนยันการเช็คอินที่ต้องตรวจสอบแล้ว", "alt": "✅ เช็คอินวันที่ {date} ของคุณได้รับการยืนยัน" },
    "disputeRejected": { "header": "ปฏิเสธการเช็คอิน", "subtitle": "แอดมินไม่ยืนยันการเช็คอินวันดังกล่าว", "alt": "❌ เช็คอินวันที่ {date} ของคุณถูกปฏิเสธ" }
  }
```

- [ ] **Step 2: Add the namespace to `messages/en.json`**

```json
  "notifications": {
    "action": { "viewDetails": "View details", "viewAttendance": "View check-in history" },
    "label": { "duration": "Duration", "workingDays": "Working days", "note": "Note", "reason": "Reason" },
    "workingDaysValue": "{days} days",
    "leaveApproved": { "header": "Leave approved", "alt": "✅ Your {type} leave request was approved" },
    "leaveRejected": { "header": "Leave rejected", "alt": "❌ Your {type} leave request was rejected" },
    "advanceApproved": { "header": "Advance approved", "subtitle": "Will be deducted from your next payslip", "alt": "✅ Your advance of ฿{amount} was approved" },
    "advanceRejected": { "header": "Advance rejected", "subtitle": "Please contact an admin for more information", "alt": "❌ Your advance of ฿{amount} was rejected" },
    "disputeApproved": { "header": "Check-in confirmed", "subtitle": "An admin reviewed and confirmed the flagged check-in", "alt": "✅ Your check-in on {date} was confirmed" },
    "disputeRejected": { "header": "Check-in rejected", "subtitle": "An admin did not confirm that check-in", "alt": "❌ Your check-in on {date} was rejected" }
  }
```

- [ ] **Step 3: Validate JSON + the loader's fallback test now passes**

Run: `export PATH=/opt/homebrew/bin:$PATH && pnpm vitest run src/lib/i18n/messages.test.ts`
Expected: PASS (including the `getMessages` fallback test — `km` now resolves `notifications.leaveApproved.header` from Thai).

- [ ] **Step 4: Commit**

```bash
git add messages/th.json messages/en.json
git commit -m "feat(i18n): notifications.* strings (th source + en)"
```

---

## Task 4: Localize the Flex templates

Change `buildFlexMessage` to take a `locale`, render chrome via `createTranslator`, and format dates via `format.ts`. Dynamic payload values (`leaveTypeName`, `reviewNote`) pass through untranslated.

**Files:**
- Modify: `src/lib/line/flex-templates.ts`
- Test: `src/lib/line/flex-templates.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/line/flex-templates.test.ts`:

```ts
import type { messagingApi } from '@line/bot-sdk';
import { describe, expect, it } from 'vitest';
import { buildFlexMessage } from './flex-templates';

type Bubble = messagingApi.FlexBubble;
const headerText = (m: messagingApi.FlexMessage): string => {
  const b = m.contents as Bubble;
  const box = b.header as messagingApi.FlexBox;
  const t = box.contents?.[0] as messagingApi.FlexText;
  return t.text;
};

const leaveApproved = {
  kind: 'leave.approved' as const,
  leaveRequestId: 'r1',
  employeeFirstName: 'Aung',
  leaveTypeName: 'ลาป่วย',
  startDate: '2026-05-12',
  endDate: '2026-05-12',
  workingDays: 1,
  durationLabel: null,
  reviewNote: null,
};

describe('buildFlexMessage localization', () => {
  it('renders Thai chrome for th', () => {
    const m = buildFlexMessage(leaveApproved, 'https://x', 'th');
    expect(headerText(m)).toContain('อนุมัติคำขอลา');
    expect(m.altText).toContain('ได้รับการอนุมัติ');
  });

  it('renders English chrome for en', () => {
    const m = buildFlexMessage(leaveApproved, 'https://x', 'en');
    expect(headerText(m)).toContain('Leave approved');
    expect(m.altText).toContain('approved');
  });

  it('falls back to Thai chrome for an untranslated locale (km)', () => {
    const m = buildFlexMessage(leaveApproved, 'https://x', 'km');
    expect(headerText(m)).toContain('อนุมัติคำขอลา');
  });

  it('passes the dynamic leaveTypeName through untranslated', () => {
    const m = buildFlexMessage(leaveApproved, 'https://x', 'en');
    expect(m.altText).toContain('ลาป่วย');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `export PATH=/opt/homebrew/bin:$PATH && pnpm vitest run src/lib/line/flex-templates.test.ts`
Expected: FAIL — `buildFlexMessage` takes 2 args / no locale handling.

- [ ] **Step 3: Refactor the templates**

In `src/lib/line/flex-templates.ts`:

(a) Replace the imports block + `fmtThaiDate`/`fmtDateRange` helpers with locale-aware versions:

```ts
import type { messagingApi } from '@line/bot-sdk';
import { createTranslator } from 'next-intl';
import type { Locale } from '@/lib/i18n/config';
import { formatDate } from '@/lib/i18n/format';
import { getMessages } from '@/lib/i18n/messages';
import type { NotificationPayload } from '@/lib/inngest/events';

// ... keep the existing FlexMessage/FlexBubble/FlexBox/FlexBoxComponent + color consts ...

/** Parse a 'YYYY-MM-DD' calendar day into a Date (UTC midnight). */
function parseYmd(ymd: string): Date {
  return new Date(`${ymd}T00:00:00.000Z`);
}

function fmtDate(ymd: string, locale: Locale): string {
  const d = parseYmd(ymd);
  return Number.isNaN(d.getTime()) ? ymd : formatDate(d, locale);
}

function fmtDateRange(startYmd: string, endYmd: string, locale: Locale): string {
  return startYmd === endYmd
    ? fmtDate(startYmd, locale)
    : `${fmtDate(startYmd, locale)} – ${fmtDate(endYmd, locale)}`;
}
```

(b) Change the signature + build a translator at the top of `buildFlexMessage`:

```ts
export function buildFlexMessage(
  payload: NotificationPayload,
  appBaseUrl: string,
  locale: Locale,
): FlexMessage {
  const t = createTranslator({ locale, messages: getMessages(locale), namespace: 'notifications' });
  let bubble: FlexBubble;
  let altText: string;

  switch (payload.kind) {
    // ...cases below...
  }

  return { type: 'flex', altText, contents: bubble };
}
```

(c) Replace every hardcoded case. Full replacements for all six kinds:

```ts
    case 'leave.approved':
      altText = t('leaveApproved.alt', { type: payload.leaveTypeName });
      bubble = approvedRejectedBubble({
        accent: GREEN,
        headerEmoji: '✅',
        headerText: t('leaveApproved.header'),
        title: payload.leaveTypeName,
        subtitle: fmtDateRange(payload.startDate, payload.endDate, locale),
        details: [
          payload.durationLabel
            ? { label: t('label.duration'), value: payload.durationLabel }
            : payload.workingDays != null
              ? { label: t('label.workingDays'), value: t('workingDaysValue', { days: payload.workingDays }) }
              : null,
          payload.reviewNote ? { label: t('label.note'), value: payload.reviewNote } : null,
        ],
        actionLabel: t('action.viewDetails'),
        actionUri: `${appBaseUrl}/liff/leave/${payload.leaveRequestId}`,
      });
      break;

    case 'leave.rejected':
      altText = t('leaveRejected.alt', { type: payload.leaveTypeName });
      bubble = approvedRejectedBubble({
        accent: RED,
        headerEmoji: '❌',
        headerText: t('leaveRejected.header'),
        title: payload.leaveTypeName,
        subtitle: fmtDateRange(payload.startDate, payload.endDate, locale),
        details: [payload.reviewNote ? { label: t('label.reason'), value: payload.reviewNote } : null],
        actionLabel: t('action.viewDetails'),
        actionUri: `${appBaseUrl}/liff/leave/${payload.leaveRequestId}`,
      });
      break;

    case 'advance.approved':
      altText = t('advanceApproved.alt', { amount: payload.amount });
      bubble = approvedRejectedBubble({
        accent: GREEN,
        headerEmoji: '✅',
        headerText: t('advanceApproved.header'),
        title: `฿${payload.amount}`,
        subtitle: t('advanceApproved.subtitle'),
        details: [],
        actionLabel: t('action.viewDetails'),
        actionUri: `${appBaseUrl}/liff/advance/${payload.cashAdvanceId}`,
      });
      break;

    case 'advance.rejected':
      altText = t('advanceRejected.alt', { amount: payload.amount });
      bubble = approvedRejectedBubble({
        accent: RED,
        headerEmoji: '❌',
        headerText: t('advanceRejected.header'),
        title: `฿${payload.amount}`,
        subtitle: t('advanceRejected.subtitle'),
        details: [],
        actionLabel: t('action.viewDetails'),
        actionUri: `${appBaseUrl}/liff/advance/${payload.cashAdvanceId}`,
      });
      break;

    case 'attendance.dispute-approved':
      altText = t('disputeApproved.alt', { date: fmtDate(payload.date, locale) });
      bubble = approvedRejectedBubble({
        accent: GREEN,
        headerEmoji: '✅',
        headerText: t('disputeApproved.header'),
        title: fmtDate(payload.date, locale),
        subtitle: t('disputeApproved.subtitle'),
        details: [payload.reviewNote ? { label: t('label.note'), value: payload.reviewNote } : null],
        actionLabel: t('action.viewAttendance'),
        actionUri: `${appBaseUrl}/liff/check-in`,
      });
      break;

    case 'attendance.dispute-rejected':
      altText = t('disputeRejected.alt', { date: fmtDate(payload.date, locale) });
      bubble = approvedRejectedBubble({
        accent: RED,
        headerEmoji: '❌',
        headerText: t('disputeRejected.header'),
        title: fmtDate(payload.date, locale),
        subtitle: t('disputeRejected.subtitle'),
        details: [payload.reviewNote ? { label: t('label.reason'), value: payload.reviewNote } : null],
        actionLabel: t('action.viewAttendance'),
        actionUri: `${appBaseUrl}/liff/check-in`,
      });
      break;
```

(d) Update the module docblock: replace the "Why we hardcode template strings instead of i18n: v1 is Thai-only" paragraph with a note that templates are localized via `createTranslator` + `getMessages(locale)`, chrome only, dynamic payload values pass through. Leave `approvedRejectedBubble` and `appBaseUrl` unchanged.

- [ ] **Step 4: Run tests to verify they pass**

Run: `export PATH=/opt/homebrew/bin:$PATH && pnpm vitest run src/lib/line/flex-templates.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Typecheck**

Run: `export PATH=/opt/homebrew/bin:$PATH && pnpm tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/line/flex-templates.ts src/lib/line/flex-templates.test.ts
git commit -m "feat(line): localize Flex notification templates per recipient locale"
```

---

## Task 5: Thread recipient locale through `line-push`

**Files:**
- Modify: `src/lib/inngest/functions/line-push.ts`

- [ ] **Step 1: Select `locale` in the lookup step**

In `src/lib/inngest/functions/line-push.ts`, change step 2 (`lookup-line-user-id`) so it returns the locale alongside the LINE id. Replace the step body:

```ts
    const recipient = await step.run('lookup-line-user', async () => {
      const u = await prisma.user.findUnique({
        where: { id: recipientUserId },
        select: { lineUserId: true, archivedAt: true, locale: true },
      });
      if (!u || u.archivedAt) return null;
      return { lineUserId: u.lineUserId, locale: u.locale };
    });
```

- [ ] **Step 2: Update the bail + build steps**

Replace the step-3 bail and step-4 build to use `recipient`:

```ts
    // Step 3 — bail if not paired.
    if (!recipient?.lineUserId) {
      logger.info(
        `skipping push: no lineUserId on User.${recipientUserId} (employee not yet paired)`,
      );
      return { notificationId: notification.id, delivered: false, reason: 'no-line-user-id' };
    }
    const lineUserId = recipient.lineUserId;

    // Step 4 — build the localized Flex Message (pure).
    const locale = isLocale(recipient.locale) ? recipient.locale : DEFAULT_LOCALE;
    const message: FlexMessage = buildFlexMessage(payload, appBaseUrl(), locale);
```

- [ ] **Step 3: Add the import**

At the top of the file, add:

```ts
import { DEFAULT_LOCALE, isLocale } from '@/lib/i18n/config';
```

- [ ] **Step 4: Typecheck**

Run: `export PATH=/opt/homebrew/bin:$PATH && pnpm tsc --noEmit`
Expected: no errors (`buildFlexMessage` now requires the 3rd `locale` arg, satisfied here).

- [ ] **Step 5: Run the full i18n + line test suite**

Run: `export PATH=/opt/homebrew/bin:$PATH && pnpm vitest run src/lib/i18n src/lib/line`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/inngest/functions/line-push.ts
git commit -m "feat(line): send notifications in the recipient's preferred language"
```

---

## Task 6: Manual verification (no code)

- [ ] Trigger a leave approval for a worker whose `User.locale = 'en'`; confirm the LINE push + lock-screen preview are English.
- [ ] Set the worker to `'km'` (no Khmer translations yet); confirm the push renders Thai (fallback), not raw keys.
- [ ] Confirm a Thai worker's notifications are unchanged from before.
- [ ] Confirm dates render correctly per locale (Buddhist year for Thai) and `฿` is shown for all locales.

---

## Self-review notes (author)

- **Spec coverage:** fallback chain target←en←th (T1–T3), notifications namespace (T3), localized templates incl. altText (T4), recipient-locale send path (T5), `createTranslator` (Inngest, no request) per Key decision 6 (T4). Chrome-only boundary (dynamic values pass through) asserted by a test (T4 Step 1).
- **Type consistency:** `buildFlexMessage(payload, baseUrl, locale)` signature is defined in T4 and called with all three args in T5; `getMessages(locale)` defined in T1 and consumed in T2 + T4; `Locale` imported from `@/lib/i18n/config` everywhere.
- **Placeholder scan:** none — every catalog string and every switch case is shown in full; untranslated locales are an explicit rollout decision (fallback), not a plan gap.
