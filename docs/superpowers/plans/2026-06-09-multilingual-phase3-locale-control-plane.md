# Multilingual Phase 3 — Per-user locale control plane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Khmer as the 6th language and build the per-user locale control plane — admin-set default language per employee, a first-run language modal in LIFF, reuse of the existing switcher, and a cookie⇄DB reconciliation so an admin's re-override reaches the worker on their next LIFF visit.

**Architecture:** Keep the single effective `User.locale` (written by both admin and worker; last-write-wins). Add one nullable flag `User.localeChosenByEmployeeAt` whose only job is to decide whether the first-run modal fires. Reconciliation runs in a **Server Action** (`syncLiffLocale`) triggered by a client `<LiffLocaleGate>` mounted in the LIFF layout — because Next.js forbids cookie writes during Server Component render. DB wins on LIFF entry; the action rewrites the cookie only when it differs and returns the modal decision + pre-selection in the same round-trip.

**Tech Stack:** Next.js 16 (App Router, Server Components + Server Actions), `next-intl` v4 (cookie-based, no URL prefix), Prisma 6 + PostgreSQL, Zod 4, Vitest, custom Tailwind UI, `next/font`. Run all commands with `/opt/homebrew/bin` on PATH (Node 24+/pnpm). Hand-authored numbered migrations applied via `pnpm db:deploy` (NOT `migrate dev`). `.env.local` must be copied into this worktree and `pnpm install` run before tests/commits.

**Spec:** `docs/superpowers/specs/2026-06-09-multilingual-per-user-locale-design.md`.

**Spec refinement (reuse, don't rebuild):** A `LanguageSwitcher` component already exists at `src/components/language-switcher.tsx` with `topbar` + `standalone` variants (a `<select>` using `LOCALE_LABELS`). This plan **reuses** it (it auto-picks up Khmer once `LOCALES` grows) and does **not** build a bottom-sheet. The "switch later" affordance on LIFF is satisfied by the existing `standalone` switcher already on `/liff/profile`; Task 9 additionally surfaces a compact switcher entry point so it is reachable from every LIFF page.

---

## File structure

| File | Responsibility | New/Modify |
|------|----------------|-----------|
| `prisma/schema.prisma` | add `User.localeChosenByEmployeeAt`; update `locale` doc comment | Modify |
| `prisma/migrations/0020_user_locale_chosen_at/migration.sql` | DDL for the nullable column | Create |
| `src/lib/i18n/config.ts` | add `'km'` to `LOCALES` + `LOCALE_LABELS` | Modify |
| `messages/km.json` | Khmer catalog stub (`_meta`) | Create |
| `src/lib/i18n/resolve.test.ts` | cover `km` matching | Modify |
| `src/lib/i18n/modal-trigger.ts` | pure `shouldShowLanguageModal()` + `resolvePreselectLocale()` | Create |
| `src/lib/i18n/modal-trigger.test.ts` | unit tests for the pure helpers | Create |
| `src/lib/i18n/actions.ts` | extend `setLocale()` to stamp `localeChosenByEmployeeAt` (worker choice) | Modify |
| `src/lib/i18n/liff-locale.ts` | `syncLiffLocale()` Server Action (reconcile cookie ⇄ DB, return modal decision) | Create |
| `src/lib/auth/permissions.ts` | (reuse `employee.update`; no new key) | — |
| `src/lib/audit/log.ts` | add `'user.locale-change'` action + ensure `'User'` entity type | Modify |
| `src/app/(admin)/admin/employees/[id]/edit/locale-actions.ts` | `setEmployeeDefaultLocale()` Server Action | Create |
| `src/app/(admin)/admin/employees/[id]/edit/locale-default-card.tsx` | admin "default language" card (Server Component + form) | Create |
| `src/app/(admin)/admin/employees/[id]/edit/page.tsx` | select `user.locale`; render `LocaleDefaultCard` | Modify |
| `src/components/liff/language-modal.tsx` | first-run picker (6 autonym buttons), pre-selected | Create |
| `src/components/liff/liff-locale-gate.tsx` | client gate: call `syncLiffLocale()` on mount, render modal/switcher entry | Create |
| `src/app/(liff)/layout.tsx` | mount `<LiffLocaleGate>` | Modify |
| `src/app/layout.tsx` | load Noto Sans Myanmar/Khmer/Lao via `next/font` | Modify |
| `src/app/globals.css` | add the three font vars to the body font stack | Modify |

**Build order:** schema/migration → Khmer locale → pure modal-trigger helpers → extend `setLocale` → audit plumbing → admin action → admin UI card → reconciliation action → LIFF gate + modal → fonts. Each task ends with a commit. After each task run `git log --oneline -1` and confirm it is your commit (worktree commits must land on this branch).

**Pre-flight (run once, do not commit):**

```bash
export PATH=/opt/homebrew/bin:$PATH
cd /Users/tong/Works/fai/koolman_hr/.claude/worktrees/thirsty-greider-72d33e
pnpm install
test -f .env.local || echo "MISSING .env.local — copy it before running db/test commands"
```

---

## Task 1: Schema + migration `0020_user_locale_chosen_at`

**Files:**
- Modify: `prisma/schema.prisma:133-137`
- Create: `prisma/migrations/0020_user_locale_chosen_at/migration.sql`

- [ ] **Step 1: Edit the `User` model**

Replace the `locale` field + its docblock (schema.prisma:133-137) with:

```prisma
  /// Effective UI language (BCP 47 — 'th','en','my','lo','zh-CN','km').
  /// Written by BOTH the worker (modal/switcher) and an admin (employee
  /// edit page). Last write wins. DB-authoritative on LIFF entry — see
  /// src/lib/i18n/liff-locale.ts. NULL until anyone sets it.
  locale     String?
  /// When the WORKER explicitly picked a language (modal or switcher).
  /// NULL ⇒ the LIFF first-run language modal fires. Admin writes to
  /// `locale` never touch this. See src/lib/i18n/modal-trigger.ts.
  localeChosenByEmployeeAt DateTime?
```

- [ ] **Step 2: Write the migration SQL**

Create `prisma/migrations/0020_user_locale_chosen_at/migration.sql`:

```sql
-- AlterTable
ALTER TABLE "User" ADD COLUMN     "localeChosenByEmployeeAt" TIMESTAMP(3);
```

- [ ] **Step 3: Apply the migration**

Run: `export PATH=/opt/homebrew/bin:$PATH && pnpm db:deploy`
Expected: migration `0020_user_locale_chosen_at` applied; no error.

- [ ] **Step 4: Regenerate the Prisma client**

Run: `export PATH=/opt/homebrew/bin:$PATH && pnpm prisma generate`
Expected: client regenerated; `localeChosenByEmployeeAt` available on the `User` type.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/0020_user_locale_chosen_at/migration.sql
git commit -m "feat(i18n): add User.localeChosenByEmployeeAt + migration 0020"
```

---

## Task 2: Add Khmer (`km`) as the 6th language

**Files:**
- Modify: `src/lib/i18n/config.ts:31` and `:67-73`
- Create: `messages/km.json`
- Test: `src/lib/i18n/resolve.test.ts`

- [ ] **Step 1: Add the failing test**

In `src/lib/i18n/resolve.test.ts`, inside `describe('resolveLocaleFromAcceptLanguage')`, add to the `'matches exact locale codes'` test and the `'matches region-tagged requests to bare-language locales'` test:

```ts
  it('matches Khmer', () => {
    expect(resolveLocaleFromAcceptLanguage('km')).toBe('km');
    expect(resolveLocaleFromAcceptLanguage('km-KH')).toBe('km');
    expect(resolveLocaleFromAcceptLanguage('KM')).toBe('km');
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `export PATH=/opt/homebrew/bin:$PATH && pnpm vitest run src/lib/i18n/resolve.test.ts`
Expected: FAIL — `expected null to be 'km'` (km not yet in `LOCALES`).

- [ ] **Step 3: Add `km` to the config**

In `src/lib/i18n/config.ts` change the `LOCALES` line (currently line 31):

```ts
export const LOCALES = ['th', 'en', 'my', 'lo', 'zh-CN', 'km'] as const;
```

And add to `LOCALE_LABELS` (the object currently at lines 67-73), keeping the docblock note about adding a language accurate:

```ts
export const LOCALE_LABELS: Record<Locale, string> = {
  th: 'ไทย',
  en: 'English',
  my: 'မြန်မာ',
  lo: 'ລາວ',
  'zh-CN': '简体中文',
  km: 'ភាសាខ្មែរ',
};
```

- [ ] **Step 4: Create the Khmer catalog stub**

Create `messages/km.json`:

```json
{
  "_meta": {
    "locale": "km",
    "note": "Khmer translations. Populated in Phase 2 from th.json by translator; English-fallback until then."
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `export PATH=/opt/homebrew/bin:$PATH && pnpm vitest run src/lib/i18n/resolve.test.ts`
Expected: PASS (all `resolve` tests, including the new Khmer test).

- [ ] **Step 6: Commit**

```bash
git add src/lib/i18n/config.ts src/lib/i18n/resolve.test.ts messages/km.json
git commit -m "feat(i18n): add Khmer (km) as the 6th supported locale"
```

---

## Task 3: Pure modal-trigger helpers

**Files:**
- Create: `src/lib/i18n/modal-trigger.ts`
- Test: `src/lib/i18n/modal-trigger.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/i18n/modal-trigger.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { resolvePreselectLocale, shouldShowLanguageModal } from './modal-trigger';

describe('shouldShowLanguageModal', () => {
  it('shows the modal when the worker has never chosen', () => {
    expect(shouldShowLanguageModal(null)).toBe(true);
  });

  it('does NOT show the modal once the worker has chosen', () => {
    expect(shouldShowLanguageModal(new Date('2026-01-01T00:00:00Z'))).toBe(false);
  });
});

describe('resolvePreselectLocale', () => {
  it('prefers the admin default when set and supported', () => {
    expect(resolvePreselectLocale({ adminDefault: 'my', acceptLanguage: 'en-US' })).toBe('my');
  });

  it('falls back to Accept-Language when no admin default', () => {
    expect(resolvePreselectLocale({ adminDefault: null, acceptLanguage: 'km-KH' })).toBe('km');
  });

  it('ignores an unsupported admin default and uses Accept-Language', () => {
    expect(resolvePreselectLocale({ adminDefault: 'zz', acceptLanguage: 'lo' })).toBe('lo');
  });

  it('falls back to Thai when nothing matches', () => {
    expect(resolvePreselectLocale({ adminDefault: null, acceptLanguage: 'ja-JP' })).toBe('th');
    expect(resolvePreselectLocale({ adminDefault: null, acceptLanguage: null })).toBe('th');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `export PATH=/opt/homebrew/bin:$PATH && pnpm vitest run src/lib/i18n/modal-trigger.test.ts`
Expected: FAIL — cannot find module `./modal-trigger`.

- [ ] **Step 3: Implement the helpers**

Create `src/lib/i18n/modal-trigger.ts`:

```ts
/**
 * Pure helpers for the LIFF first-run language modal. No I/O — the
 * caller (syncLiffLocale Server Action) supplies the inputs so these
 * stay trivially testable.
 */

import { DEFAULT_LOCALE, isLocale, type Locale } from './config';
import { resolveLocaleFromAcceptLanguage } from './resolve';

/** The modal fires exactly once: when the worker has never explicitly
 *  chosen a language. Admin-set defaults do NOT suppress it (decided:
 *  "always show, pre-selected"). */
export function shouldShowLanguageModal(chosenAt: Date | null | undefined): boolean {
  return chosenAt == null;
}

/**
 * Pre-selection for the modal. Order: admin default (if a supported
 * locale) → Accept-Language match → Thai. `liff.getLanguage()` is layered
 * on top of this on the client (see liff-locale-gate.tsx) as an optional
 * enhancement; this server-side resolver is the dependable floor.
 */
export function resolvePreselectLocale(input: {
  adminDefault: string | null | undefined;
  acceptLanguage: string | null | undefined;
}): Locale {
  if (isLocale(input.adminDefault)) return input.adminDefault;
  const fromHeader = resolveLocaleFromAcceptLanguage(input.acceptLanguage ?? null);
  if (fromHeader) return fromHeader;
  return DEFAULT_LOCALE;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `export PATH=/opt/homebrew/bin:$PATH && pnpm vitest run src/lib/i18n/modal-trigger.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/i18n/modal-trigger.ts src/lib/i18n/modal-trigger.test.ts
git commit -m "feat(i18n): pure modal-trigger + preselect helpers"
```

---

## Task 4: Extend `setLocale()` to stamp worker choice

`setLocale()` is called by the worker (modal + switcher). When the WORKER picks, we must stamp `localeChosenByEmployeeAt` so the modal never fires again. Admin writes go through a *different* action (Task 6) and must not stamp it.

**Files:**
- Modify: `src/lib/i18n/actions.ts`

- [ ] **Step 1: Update the DB write in `setLocale`**

In `src/lib/i18n/actions.ts`, change the `prisma.user.update` call (inside the `if (authUser)` block) from:

```ts
      await prisma.user.update({
        where: { authUserId: authUser.id },
        data: { locale },
      });
```

to:

```ts
      await prisma.user.update({
        where: { authUserId: authUser.id },
        // This action is the WORKER's explicit choice (modal/switcher), so
        // stamp localeChosenByEmployeeAt — that's what stops the first-run
        // modal from reappearing. Admin default-setting uses a separate
        // action (setEmployeeDefaultLocale) that does NOT stamp this.
        data: { locale, localeChosenByEmployeeAt: new Date() },
      });
```

Also update the docblock at the top of the file: add a line noting `setLocale` stamps `localeChosenByEmployeeAt` and that admin default-setting is a separate action.

- [ ] **Step 2: Typecheck**

Run: `export PATH=/opt/homebrew/bin:$PATH && pnpm tsc --noEmit`
Expected: no errors (the `data` shape now includes `localeChosenByEmployeeAt`, which exists after Task 1's `prisma generate`).

- [ ] **Step 3: Commit**

```bash
git add src/lib/i18n/actions.ts
git commit -m "feat(i18n): stamp localeChosenByEmployeeAt on worker locale choice"
```

---

## Task 5: Audit plumbing for admin locale changes

**Files:**
- Modify: `src/lib/audit/log.ts` (`AuditAction` union; `AuditEntityType` union)

- [ ] **Step 1: Add the audit action + entity**

In `src/lib/audit/log.ts`, add to the `AuditAction` union (near the other `user.*` actions):

```ts
  | 'user.locale-change'
```

In the `AuditEntityType` union (starts at log.ts:118), ensure `'User'` is present; if it is not, add:

```ts
  | 'User'
```

- [ ] **Step 2: Typecheck**

Run: `export PATH=/opt/homebrew/bin:$PATH && pnpm tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/audit/log.ts
git commit -m "feat(audit): user.locale-change action for admin language changes"
```

---

## Task 6: Admin `setEmployeeDefaultLocale` Server Action

Writes the linked `User.locale` for a given employee. Permission-gated by `employee.update`. Audited. **Does not** stamp `localeChosenByEmployeeAt` (admin re-override must leave the worker's "has chosen" flag alone). Mirrors the structure of `entitlements-actions.ts`.

**Files:**
- Create: `src/app/(admin)/admin/employees/[id]/edit/locale-actions.ts`

- [ ] **Step 1: Implement the action**

Create `src/app/(admin)/admin/employees/[id]/edit/locale-actions.ts`:

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { auditLog } from '@/lib/audit/log';
import { requirePermission } from '@/lib/auth/check-permission';
import { prisma } from '@/lib/db/prisma';
import { isLocale } from '@/lib/i18n/config';

/**
 * Admin sets/changes the default language for an employee. Writes the
 * linked User.locale (the effective preference; last-write-wins with the
 * worker). Deliberately does NOT touch localeChosenByEmployeeAt — an
 * admin re-override must not retrigger the worker's first-run modal, and
 * the worker can still switch again afterwards. An empty value clears
 * the default (back to detection on the worker's next visit).
 */
export async function setEmployeeDefaultLocale(employeeId: string, formData: FormData) {
  const { user: actor } = await requirePermission('employee.update');

  const path = `/admin/employees/${employeeId}/edit`;
  const raw = formData.get('locale');
  const next = typeof raw === 'string' && raw.length > 0 ? raw : null;

  if (next !== null && !isLocale(next)) {
    redirect(`${path}?error=${encodeURIComponent('ภาษาที่เลือกไม่ถูกต้อง')}`);
  }

  const emp = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { userId: true, user: { select: { id: true, locale: true } } },
  });
  if (!emp?.user) {
    redirect(`${path}?error=${encodeURIComponent('ไม่พบบัญชีผู้ใช้ของพนักงาน')}`);
  }

  const before = emp.user.locale;
  await prisma.user.update({
    where: { id: emp.user.id },
    data: { locale: next },
  });

  auditLog({
    actorId: actor.id,
    action: 'user.locale-change',
    entityType: 'User',
    entityId: emp.user.id,
    before: { locale: before },
    after: { locale: next },
    metadata: { source: 'admin-ui', employeeId },
  });

  revalidatePath(path);
  redirect(`${path}?ok=1`);
}
```

> **Note on `emp.user.id` vs `userId`:** select both as shown; if the schema's relation field differs (`emp.userId`), use whichever is non-null. The `findUnique` select above returns the nested `user.id`, which is the `User.id` we update.

- [ ] **Step 2: Typecheck**

Run: `export PATH=/opt/homebrew/bin:$PATH && pnpm tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(admin)/admin/employees/[id]/edit/locale-actions.ts"
git commit -m "feat(employee): admin action to set an employee's default language"
```

---

## Task 7: Admin "default language" card on the employee edit page

**Files:**
- Create: `src/app/(admin)/admin/employees/[id]/edit/locale-default-card.tsx`
- Modify: `src/app/(admin)/admin/employees/[id]/edit/page.tsx`

- [ ] **Step 1: Build the card (Server Component + form)**

Create `src/app/(admin)/admin/employees/[id]/edit/locale-default-card.tsx`:

```tsx
import { LOCALE_LABELS, LOCALES, type Locale } from '@/lib/i18n/config';
import { setEmployeeDefaultLocale } from './locale-actions';

/**
 * Admin "default language" card. Sets the linked User.locale. The select
 * shows the employee's CURRENT effective locale (which may be the worker's
 * own choice) — admins see reality, and saving re-overrides it. Blank =
 * "no default; detect on next visit".
 */
export function LocaleDefaultCard({
  employeeId,
  currentLocale,
}: {
  employeeId: string;
  currentLocale: Locale | null;
}) {
  const action = setEmployeeDefaultLocale.bind(null, employeeId);
  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <h2 className="text-sm font-semibold text-gray-900">ภาษาเริ่มต้น (Default language)</h2>
      <p className="mt-1 text-xs text-gray-500">
        ตั้งภาษาที่พนักงานจะเห็นใน LIFF พนักงานยังเปลี่ยนเองได้ และการแก้ที่นี่จะมีผลในการเข้าใช้งานครั้งถัดไป
      </p>
      <form action={action} className="mt-3 flex items-end gap-3">
        <div className="flex-1">
          <label htmlFor="default-locale" className="sr-only">
            Default language
          </label>
          <select
            id="default-locale"
            name="locale"
            defaultValue={currentLocale ?? ''}
            className="block w-full max-w-xs rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/30"
          >
            <option value="">— ตรวจจับอัตโนมัติ —</option>
            {LOCALES.map((code) => (
              <option key={code} value={code}>
                {LOCALE_LABELS[code]}
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          className="rounded-md bg-primary-600 px-3 py-2 text-sm font-medium text-white hover:bg-primary-700"
        >
          บันทึก
        </button>
      </form>
    </section>
  );
}
```

- [ ] **Step 2: Wire the card into the edit page**

In `src/app/(admin)/admin/employees/[id]/edit/page.tsx`:

(a) Extend the `user` select in the `prisma.employee.findUnique` call (currently `user: { select: { lineUserId: true, authUserId: true } }`) to include `locale`:

```ts
        user: { select: { lineUserId: true, authUserId: true, locale: true } },
```

(b) Add the import near the other local imports:

```ts
import { LocaleDefaultCard } from './locale-default-card';
import { isLocale } from '@/lib/i18n/config';
```

(c) Render the card in the page body, directly above the `PairingCard` (matching where the leave-rights card sits). Insert:

```tsx
        <LocaleDefaultCard
          employeeId={emp.id}
          currentLocale={isLocale(emp.user.locale) ? emp.user.locale : null}
        />
```

- [ ] **Step 3: Typecheck + lint**

Run: `export PATH=/opt/homebrew/bin:$PATH && pnpm tsc --noEmit && pnpm lint`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(admin)/admin/employees/[id]/edit/locale-default-card.tsx" "src/app/(admin)/admin/employees/[id]/edit/page.tsx"
git commit -m "feat(employee): admin default-language card on the edit page"
```

---

## Task 8: `syncLiffLocale()` reconciliation Server Action

Runs from the client gate on LIFF entry. Reconciles the cookie to DB `locale` (DB wins) **only when they differ**, and returns the modal decision + pre-selection. Cookie writes are legal here (Server Action).

**Files:**
- Create: `src/lib/i18n/liff-locale.ts`

- [ ] **Step 1: Implement the action**

Create `src/lib/i18n/liff-locale.ts`:

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { cookies, headers } from 'next/headers';
import { prisma } from '@/lib/db/prisma';
import { createClient } from '@/lib/supabase/server';
import { isLocale, LOCALE_COOKIE_MAX_AGE, LOCALE_COOKIE_NAME, type Locale } from './config';
import { resolvePreselectLocale, shouldShowLanguageModal } from './modal-trigger';

export type LiffLocaleSync =
  | { paired: false }
  | { paired: true; showModal: boolean; preselect: Locale };

/**
 * LIFF entry reconciliation. Called once on mount by <LiffLocaleGate>.
 *
 * - Not signed in / not paired (pre-/mid-pair) → { paired: false }; the
 *   gate renders nothing.
 * - DB `locale` is authoritative for LIFF: if it is set and differs from
 *   the NEXT_LOCALE cookie, rewrite the cookie + revalidate so the
 *   admin's re-override takes effect on this visit. No DB change ⇒ no
 *   revalidate (no flash on the common path).
 * - Returns whether the first-run modal should show + its pre-selection.
 */
export async function syncLiffLocale(): Promise<LiffLocaleSync> {
  const supabase = await createClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();
  if (!authUser) return { paired: false };

  const dbUser = await prisma.user.findUnique({
    where: { authUserId: authUser.id },
    select: { locale: true, localeChosenByEmployeeAt: true, lineUserId: true, archivedAt: true },
  });
  // Only paired, active workers get the LIFF locale experience.
  if (!dbUser || dbUser.archivedAt || !dbUser.lineUserId) return { paired: false };

  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get(LOCALE_COOKIE_NAME)?.value ?? null;

  // DB wins: rewrite the cookie when the DB has a supported locale that
  // the cookie doesn't already match.
  if (isLocale(dbUser.locale) && dbUser.locale !== cookieLocale) {
    cookieStore.set(LOCALE_COOKIE_NAME, dbUser.locale, {
      maxAge: LOCALE_COOKIE_MAX_AGE,
      sameSite: 'lax',
      path: '/',
      httpOnly: false,
    });
    revalidatePath('/', 'layout');
  }

  const headerStore = await headers();
  return {
    paired: true,
    showModal: shouldShowLanguageModal(dbUser.localeChosenByEmployeeAt),
    preselect: resolvePreselectLocale({
      adminDefault: dbUser.locale,
      acceptLanguage: headerStore.get('accept-language'),
    }),
  };
}
```

- [ ] **Step 2: Typecheck**

Run: `export PATH=/opt/homebrew/bin:$PATH && pnpm tsc --noEmit`
Expected: no errors. (Confirm `@/lib/supabase/server` exports `createClient` — it is used by `src/lib/i18n/actions.ts`.)

- [ ] **Step 3: Commit**

```bash
git add src/lib/i18n/liff-locale.ts
git commit -m "feat(i18n): syncLiffLocale reconciliation action (DB wins on LIFF entry)"
```

---

## Task 9: LIFF locale gate + first-run modal

**Files:**
- Create: `src/components/liff/language-modal.tsx`
- Create: `src/components/liff/liff-locale-gate.tsx`
- Modify: `src/app/(liff)/layout.tsx`

- [ ] **Step 1: Build the modal**

Create `src/components/liff/language-modal.tsx`:

```tsx
'use client';

import { useState, useTransition } from 'react';
import { setLocale } from '@/lib/i18n/actions';
import { LOCALE_LABELS, LOCALES, type Locale } from '@/lib/i18n/config';
import { cn } from '@/lib/utils';

/**
 * First-run language picker. Big autonym buttons (never flags). Pre-selected
 * to the best guess; one tap confirms. Writes via setLocale (which stamps
 * localeChosenByEmployeeAt, so this never reappears).
 */
export function LanguageModal({ preselect }: { preselect: Locale }) {
  const [selected, setSelected] = useState<Locale>(preselect);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  if (done) return null;

  function confirm() {
    startTransition(async () => {
      await setLocale(selected);
      setDone(true);
    });
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Choose language"
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
    >
      <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl">
        <h2 className="text-center text-base font-semibold text-gray-900">
          เลือกภาษา · Choose your language
        </h2>
        <div className="mt-4 grid grid-cols-1 gap-2">
          {LOCALES.map((code) => (
            <button
              key={code}
              type="button"
              onClick={() => setSelected(code)}
              className={cn(
                'w-full rounded-xl border px-4 py-3 text-left text-base',
                code === selected
                  ? 'border-primary-500 bg-primary-50 font-semibold text-primary-700'
                  : 'border-gray-200 text-gray-800',
              )}
            >
              {LOCALE_LABELS[code]}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={confirm}
          disabled={pending}
          className="mt-5 w-full rounded-xl bg-primary-600 px-4 py-3 text-base font-medium text-white hover:bg-primary-700 disabled:opacity-60"
        >
          ตกลง · OK
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Build the gate**

Create `src/components/liff/liff-locale-gate.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { isLocale, type Locale } from '@/lib/i18n/config';
import { type LiffLocaleSync, syncLiffLocale } from '@/lib/i18n/liff-locale';
import { LanguageModal } from './language-modal';

/**
 * Mounted once in the LIFF layout. On entry it reconciles the locale
 * (DB wins) and decides whether to show the first-run modal. The DB
 * preselect is refined client-side with liff.getLanguage() when the LINE
 * SDK is available — best-effort, never throws.
 */
export function LiffLocaleGate() {
  const [sync, setSync] = useState<LiffLocaleSync | null>(null);
  const [liffLang, setLiffLang] = useState<Locale | null>(null);

  useEffect(() => {
    let cancelled = false;
    syncLiffLocale().then((r) => {
      if (!cancelled) setSync(r);
    });
    // Best-effort: LINE's app language as a smarter preselect. Guarded so
    // a missing/uninitialised SDK never breaks the gate.
    (async () => {
      try {
        const liff = (await import('@line/liff')).default;
        const tag = liff.getLanguage?.();
        const base = tag?.toLowerCase().split('-')[0];
        if (base && isLocale(base)) setLiffLang(base);
        else if (tag && isLocale(tag)) setLiffLang(tag);
      } catch {
        /* SDK not ready — ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!sync || !sync.paired || !sync.showModal) return null;

  // Preselect priority: admin default (already in sync.preselect when set)
  // wins; otherwise LINE app language refines the header-based guess.
  const preselect =
    sync.preselect !== 'th' ? sync.preselect : (liffLang ?? sync.preselect);
  return <LanguageModal preselect={preselect} />;
}
```

> **Preselect priority note:** `sync.preselect` already encodes admin-default → Accept-Language → th. We only let `liff.getLanguage()` override when the server fell all the way back to Thai (i.e. no admin default and no header match), so an admin's explicit guess is never overridden by the device language.

- [ ] **Step 3: Mount the gate in the LIFF layout**

Replace the body of `src/app/(liff)/layout.tsx`'s returned JSX:

```tsx
import { LiffLocaleGate } from '@/components/liff/liff-locale-gate';

export default function LiffLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-gray-50">
      {children}
      <LiffLocaleGate />
    </div>
  );
}
```

- [ ] **Step 4: Typecheck + lint**

Run: `export PATH=/opt/homebrew/bin:$PATH && pnpm tsc --noEmit && pnpm lint`
Expected: no errors. (Confirm `@line/liff` is a dependency — it is, per `serverExternalPackages`/LIFF pages.)

- [ ] **Step 5: Commit**

```bash
git add src/components/liff/language-modal.tsx src/components/liff/liff-locale-gate.tsx "src/app/(liff)/layout.tsx"
git commit -m "feat(liff): first-run language modal + locale reconciliation gate"
```

---

## Task 10: Bundle complex-script webfonts (Myanmar/Khmer/Lao)

Without bundled fonts these scripts can render as tofu (□□□) in the LINE in-app browser. Thai/Latin/CJK are already covered by the existing stack; add the three SE-Asian scripts.

**Files:**
- Modify: `src/app/layout.tsx`
- Modify: `src/app/globals.css`

- [ ] **Step 1: Load the fonts via `next/font/google`**

In `src/app/layout.tsx`, extend the `next/font/google` import and add three font instances next to `plexThai`:

```ts
import {
  IBM_Plex_Mono,
  IBM_Plex_Sans_Thai,
  Inter,
  Noto_Sans_Myanmar,
  Noto_Sans_Khmer,
  Noto_Sans_Lao,
} from 'next/font/google';

const notoMyanmar = Noto_Sans_Myanmar({
  subsets: ['myanmar'],
  weight: ['400', '500', '700'],
  variable: '--font-noto-myanmar',
  display: 'swap',
});
const notoKhmer = Noto_Sans_Khmer({
  subsets: ['khmer'],
  weight: ['400', '500', '700'],
  variable: '--font-noto-khmer',
  display: 'swap',
});
const notoLao = Noto_Sans_Lao({
  subsets: ['lao'],
  weight: ['400', '500', '700'],
  variable: '--font-noto-lao',
  display: 'swap',
});
```

- [ ] **Step 2: Attach the font variables to `<html>`**

In the same file, find where the existing font variables are applied to the root element's `className` (e.g. `${inter.variable} ${plexThai.variable} ${plexMono.variable}`) and append the three new variables:

```tsx
` ${notoMyanmar.variable} ${notoKhmer.variable} ${notoLao.variable}`
```

- [ ] **Step 3: Add the fonts to the body font stack**

In `src/app/globals.css`, find the `@theme` body font stack (the `--font-*` that resolves the Thai/Latin body font, e.g. `--font-sans`) and append the three families as fallbacks so any script renders:

```css
  --font-sans: var(--font-plex-thai), var(--font-inter), var(--font-noto-myanmar),
    var(--font-noto-khmer), var(--font-noto-lao), system-ui, sans-serif;
```

(Match the existing variable name; only the appended `var(--font-noto-*)` entries are new.)

- [ ] **Step 4: Build to verify fonts resolve**

Run: `export PATH=/opt/homebrew/bin:$PATH && pnpm build`
Expected: build succeeds; no "Unknown font" error from `next/font`.

- [ ] **Step 5: Commit**

```bash
git add src/app/layout.tsx src/app/globals.css
git commit -m "feat(i18n): bundle Noto Sans Myanmar/Khmer/Lao webfonts for LIFF"
```

---

## Task 11: Manual verification checklist (no code)

- [ ] **Admin default:** On `/admin/employees/<id>/edit`, set the default language; confirm the card saves (`?ok=1`) and the select reflects the value on reload.
- [ ] **First-run modal:** With a paired test worker whose `localeChosenByEmployeeAt IS NULL`, open any `/liff/*` page → modal appears pre-selected; pick a language → UI updates and the modal does not reappear on the next visit.
- [ ] **Switcher:** On `/liff/profile`, change language via the existing `LanguageSwitcher`; confirm it persists.
- [ ] **Admin re-override:** With a worker who has already chosen, change their default in admin → on the worker's next LIFF entry the language flips, with no modal.
- [ ] **Khmer fonts:** Switch to Khmer/Burmese/Lao; confirm no tofu (□□□) glyphs in the LINE in-app browser.

---

## Self-review notes (author)

- **Spec coverage:** Khmer (T2), admin default field (T6–T7), first-run modal always-pre-selected (T3, T9), switcher reuse (refinement note + T11), reconciliation/DB-wins (T8–T9), schema Approach A (T1, T4), fonts (T10), no RTL (n/a). Notifications are Phase 4 (separate plan).
- **No-cookie-during-render** constraint honored by routing reconciliation through a Server Action (T8) invoked by a client gate (T9).
- **Type consistency:** `syncLiffLocale` returns `LiffLocaleSync`; `resolvePreselectLocale`/`shouldShowLanguageModal` signatures match their tests (T3) and the action's call sites (T8).
