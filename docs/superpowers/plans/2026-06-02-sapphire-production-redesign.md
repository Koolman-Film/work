# Sapphire Editorial — Production Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **This is a MASTER plan.** It fully specifies the shared foundation (PR-0, PR-1) with complete code. The per-page-group ports (PR-2 … PR-12) are specified here as concrete, self-contained units (file lists, recipe, confirm-map, responsive + test requirements, done-criteria). Each page-group PR gets its **own detailed sub-plan** written from this spec at the time we start it — this keeps the master plan readable instead of a 5,000-line wall of repetitive CRUD code.

**Goal:** Port the approved "Sapphire Editorial" mockup design into the live production Next.js app — unifying every page onto a shared core component set, preserving 100% of existing functionality, adding confirm dialogs on sensitive actions, and giving every page a good, readable mobile view.

**Architecture:** Restyle-and-extend, not rebuild. Production already has the right bones (Tailwind v4 `@theme` tokens, a `ui/` primitive set, an admin shell with a working mobile drawer, a `VoidDialog` confirm pattern, vitest + Playwright). We (1) swap the design tokens to Sapphire + add the Inter display font, (2) extend the shared component library to cover every recurring mockup pattern, then (3) migrate page-groups one PR at a time to compose those components, each with a responsive mobile layout and confirm dialogs on destructive/high-consequence actions.

**Tech stack:** Next.js 16 (App Router, RSC), Tailwind CSS v4 (CSS-first `@theme`), `class-variance-authority` + `clsx` + `tailwind-merge`, `lucide-react` icons, `next-intl` (Thai), `next/font` (Inter + IBM Plex Sans Thai + IBM Plex Mono), zustand (mobile-nav), Prisma 6 / Supabase, vitest (pure logic), Playwright (e2e + mobile-viewport).

**Locked decisions (from brainstorming):**
1. **Adopt the Sapphire palette** — brand `#3955e8`, accent amber `#fbbf24`, replacing Finnix Blue. Whole-app reskin via tokens.
2. **Incremental per-section PRs** — foundation first, then one PR per page-group.
3. **⌘K search = visual placeholder now** — the affordance ships; functional command palette is a later enhancement (out of scope here).

---

## Guiding Principles

- **One source of truth per concept.** A status pill, a confirm dialog, a page header, a data table — each is defined once in `src/components/**` and composed everywhere. No re-deriving the same markup per page. This is the central goal of the request ("unified … shared core components as much as possible").
- **Token-driven reskin.** Color/brand changes flow through `@theme` in `globals.css`. Components reference `primary-*` / semantic tokens, never hardcoded brand hex (the one deliberate exception is `StatusBadge`'s status map, which is spec-locked hex).
- **Functionality parity is non-negotiable.** Every server action, form, filter, tab, upload, realtime board, and role-gate that exists today must still work after the restyle. The existing Playwright specs (`admin-leave-approval`, `admin-advance-approval`, `*-void`, `admin-settings-crud`, `auth`, `smoke`, `soft-delete-readpath`) must stay green — they are our parity safety net. Prefer role/text selectors so a restyle doesn't break them.
- **Confirm on consequence.** Destructive (delete/void) and high-consequence (approve money, approve leave, reject, unlink, force-checkout, cancel request, password change) actions route through the shared `<ConfirmDialog>`. Void keeps its required-reason variant.
- **Mobile is a first-class layout, not an afterthought.** Every page must be readable and usable at 360px. Wide tables become stacked cards; multi-column forms become single column; filter bars collapse into a sheet. Touch targets ≥ 44px.
- **TDD where there's logic; Playwright where there's behavior; eyes where there's pixels.** New pure helpers get vitest tests. New interactive components and flows get Playwright specs (incl. a mobile-viewport project). Visual fidelity is verified by reviewing each PR against its `*-sapphire.html` mockup at desktop + mobile widths.
- **DRY, YAGNI, frequent commits.** Small commits per task. Don't build the ⌘K engine, dark mode, or speculative variants we don't use.

---

## Source-of-Truth Map (mockup → production)

Mockups live in `.superpowers/brainstorm/64600-1780264990/content/*-sapphire.html` (+ shared `nav.js`) and the locked tokens in `.superpowers/brainstorm/5713-1779972323/tokens.json`. They are the visual spec. Representative mappings:

| Mockup | Production route(s) | PR |
|---|---|---|
| `dashboard-sapphire.html` | `/admin` | PR-2 |
| (owner read-only) | `/owner` | PR-2 |
| `employees-sapphire.html`, `forms-set-sapphire.html` | `/admin/employees`, `/new`, `/[id]/edit` | PR-3 |
| `admin-leave-sapphire.html` | `/admin/leave` | PR-4 |
| `admin-advance-sapphire.html`, `review-detail-sapphire.html` | `/admin/advance` | PR-5 |
| `account-attendance-sapphire.html`, `live-board-sapphire.html`, `disputed-review-sapphire.html` | `/admin/attendance`, `/disputed`, `/live`, `/manual` | PR-6 |
| `settings-lists-sapphire.html`, `system-glue-sapphire.html`, `editors-spatial-sapphire.html` | `/admin/settings/*` CRUDs | PR-7 |
| `roles-editor-sapphire.html`, `team-edit-sapphire.html` | `/admin/settings/roles`, `/team` | PR-8 |
| (profile) | `/admin/profile` | PR-9 |
| `auth-sapphire.html` | `/login`, `/reset-password`, `/update-password` | PR-10 |
| `liff-checkin-sapphire.html`, `liff-leave-advance-sapphire.html`, `liff-rest-sapphire.html`, `search-responsive-sapphire.html` | `/liff/*`, `/i/[token]` | PR-11 |
| `nav.js` (sidebar + topbar + PageHeader) | `AppShell` (PR-1) | PR-1 |

`nav.js` is the source of truth for the **AppShell** (floating sidebar card + shared topbar + the unified PageHeader). The brainstorm folder is gitignored and never deployed — it is reference only.

---

## Shared Core Component Inventory

The deliverable of PR-1. Each row is one component file. "Extend" = the file exists and we restyle/expand it; "New" = create it.

| Component | File | Status | Replaces inline pattern |
|---|---|---|---|
| `AppShell` (layout) | `src/app/(admin)/layout.tsx` | Extend | flex shell → floating-sidebar-card canvas |
| `Sidebar` | `src/components/admin/sidebar.tsx` | Extend | flat rail → floating card, Sapphire active state, sections |
| `Topbar` | `src/components/admin/topbar.tsx` | Extend | add ⌘K placeholder + Sapphire styling; keep bell/user/drawer |
| `PageHeader` | `src/components/ui/page-header.tsx` | New | per-page breadcrumb+title+subtitle+actions (the `nav.js` topbar header) |
| `Button` | `src/components/ui/button.tsx` | Extend | add `approve` (green gradient) + `reject` variants; Sapphire primary |
| `Surface`/`Card` | `src/components/ui/card.tsx` | Extend | layered shadow, hairline border, radius tokens |
| `Pill` / `Tag` | `src/components/ui/pill.tsx` | New | `.pill` variants (pending/approved/leave/neutral) for non-status chips |
| `StatusBadge` | `src/components/ui/status-badge.tsx` | Keep | spec-locked status→hex map (unchanged) |
| `Tabs` | `src/components/ui/tabs.tsx` | New | `.tab on/off` (list filter tabs: รออนุมัติ / ทั้งหมด / ถังขยะ) |
| `Avatar` | `src/components/ui/avatar.tsx` | New | `.av` initials avatar (+ amber "SP" superadmin variant) |
| `Dialog` | `src/components/ui/dialog.tsx` | New | accessible modal primitive (focus-trap, Esc, backdrop, `role=dialog`) |
| `ConfirmDialog` | `src/components/ui/confirm-dialog.tsx` | New | confirm (+ optional required reason); `VoidDialog` refactors onto it |
| `VoidDialog`/`RestoreButton` | `src/components/admin/void-dialog.tsx` | Extend | re-implement on `ConfirmDialog`; keep public API |
| `ResponsiveTable` / `DataList` | `src/components/ui/responsive-table.tsx` | New | `<table>` ≥md, stacked cards <md (the core mobile-table primitive) |
| `KpiHero` | `src/components/ui/kpi-hero.tsx` | New | dashboard sapphire-gradient hero (checked-in / not-checked-in numbers) |
| `StatCard` | `src/components/ui/stat-card.tsx` | New | dashboard/owner metric tiles |
| `ProgressRing` | `src/components/ui/progress-ring.tsx` | New | on-time-rate ring |
| `DayChip` | `src/components/ui/day-chip.tsx` | New | `.day` date chip (leave rows) |
| `Dropzone` | `src/components/ui/dropzone.tsx` | New | dashed upload (receipt / medical cert) — wraps existing upload action |
| `EmptyState` | `src/components/ui/empty-state.tsx` | New | consistent "no data" panel |
| `FilterBar` | `src/components/ui/filter-bar.tsx` | New | search + selects; collapses to a sheet on mobile |
| formatting helpers | `src/lib/format.ts` | New | `formatTHB`, `formatThaiDate`, `initials` (pure, vitest-tested) |

---

## Sensitive-Action → Confirm-Dialog Map

Every row routes through `<ConfirmDialog>` (or its required-reason variant). `tone` drives the confirm button color.

| Action | Route | Confirm copy emphasis | Reason field | tone |
|---|---|---|---|---|
| Approve leave | `/admin/leave` | "สร้าง N วันลา (OnLeave) อัตโนมัติ" | no | primary |
| Reject leave | `/admin/leave` | employee + dates | optional | danger |
| Approve advance | `/admin/advance` | **฿amount** + post-balance | no | primary |
| Reject advance | `/admin/advance` | employee + ฿amount | optional | danger |
| Approve/Reject disputed | `/admin/attendance/disputed` | employee + time | reject: optional | primary/danger |
| Void record | attendance/leave/advance lists | what gets hidden | **required** | danger |
| Restore record | trash tabs | one-line confirm | no | primary |
| Delete / archive employee | `/admin/employees`, `/[id]/edit` | name + irreversibility | no | danger |
| Unlink LINE | `/admin/employees/[id]/edit` | "พนักงานต้องผูกใหม่" | no | danger |
| Delete settings entity | `/admin/settings/*` | name + in-use guard | no | danger |
| Delete role | `/admin/settings/roles` | block if assigned, else confirm | no | danger |
| Remove / change team member role | `/admin/settings/team` | member + new role | no | danger/primary |
| Manual attendance overwrite | `/admin/attendance/manual` | only when overwriting an existing row | no | primary |
| Change password | `/admin/profile` | confirm | (current pw gate) | primary |
| Cancel leave/advance request | `/liff/leave`, `/liff/advance` | "ยกเลิกคำขอนี้?" | no | danger |

Non-destructive create/edit submits do **not** get a confirm dialog (avoids confirm-fatigue).

---

## Responsive Strategy

- **Breakpoints:** keep Tailwind defaults. Sidebar drawer toggles at `lg` (1024px, already implemented). Table→cards and form column-collapse at `md` (768px). Verify down to **360px**.
- **Wide data tables** (employees, attendance records, live board, settings lists, roles matrix, team): use `<ResponsiveTable>` — semantic `<table>` at ≥md, **stacked label:value cards** at <md, with row actions behind a `⋯` menu. This is the single most important mobile primitive.
- **Forms:** `grid gap-4 md:grid-cols-2` → single column on mobile; sticky action bar at the bottom on mobile so primary submit is always reachable.
- **PageHeader:** title scales (`text-2xl md:text-3xl`); action buttons wrap; on `<sm` the breadcrumb shows only the current section.
- **FilterBar:** inline row at ≥md; a "ตัวกรอง" button opening a bottom sheet (reusing `Dialog`) at <md.
- **KPI / stat grids:** `grid grid-cols-2 md:grid-cols-4`.
- **LIFF:** already phone-first (LINE webview). Keep single column, ensure ≥44px touch targets, bottom-anchored CTAs.

---

## Testing Strategy

- **vitest (pure logic only — current convention):** new helpers in `src/lib/format.ts` get unit tests. If `Topbar`'s `labelFor`/breadcrumb logic is extracted to `src/lib/nav/breadcrumb.ts`, it gets tests. No component-render tests (no testing-library/jsdom in the stack — we will **not** introduce one; behavior is covered by Playwright).
- **Playwright e2e (UI behavior + mobile):**
  - Add a **`mobile` project** (Pixel-7-sized viewport) to `playwright.config.ts`.
  - New specs: `confirm-dialog.spec.ts` (approve advance → dialog shows ฿amount → Cancel aborts/no mutation → Confirm calls action), `mobile-nav.spec.ts` (hamburger opens drawer, link navigates + closes), `responsive-table.spec.ts` (desktop shows `<th>`; mobile shows stacked cards, no horizontal overflow), `tabs.spec.ts` (tab switch filters list).
  - **Keep all existing specs green** — they are the functionality-parity gate. Update selectors only where a restyle legitimately changes them, preferring `getByRole`/`getByText`.
- **Visual fidelity:** per PR, open the page at 1440px and 390px and compare to the matching `*-sapphire.html`. (Optional: Playwright screenshot baselines — note they're flaky across machines; not required.)
- **Per-PR gate:** `npm run lint && npm run typecheck && npm run test && npm run test:e2e` all green before merge.

---

## Rollout / PR Sequence

Each PR branches off `main`, is independently shippable, and ends green. Order matters: foundation → components → pages.

| PR | Scope | Depends on |
|---|---|---|
| **PR-0** | Foundation: Sapphire tokens, Inter font, base utilities, mobile Playwright project | — |
| **PR-1** | Shared core components (the whole inventory above) + AppShell restyle | PR-0 |
| **PR-2** | Dashboard `/admin` + Owner `/owner` | PR-1 |
| **PR-3** | Employees (list/new/edit) | PR-1 |
| **PR-4** | Leave admin `/admin/leave` | PR-1 |
| **PR-5** | Advance admin `/admin/advance` | PR-1 |
| **PR-6** | Attendance (records/disputed/live/manual) | PR-1 |
| **PR-7** | Settings CRUDs (branches/departments/accounting-groups/holidays/leave-types/work-schedules) | PR-1 |
| **PR-8** | Settings: roles + team (permission matrix, assignment editor) | PR-1, PR-7 |
| **PR-9** | Profile `/admin/profile` | PR-1 |
| **PR-10** | Auth (login/reset/update-password) | PR-0 |
| **PR-11** | LIFF (`/liff/*`) + pairing `/i/[token]` | PR-0, PR-1 (Dialog/Button only) |
| **PR-12** | Consistency + a11y sweep, doc/user-guide screenshot refresh, final parity pass | all |

After PR-1, PRs 2–11 are largely parallelizable.

---

# PR-0 — Foundation: tokens, fonts, utilities

**Goal:** Reskin the entire app's color/brand/typography via tokens, with zero page edits. After this PR, the existing UI renders in Sapphire (anything using `primary-*` shifts automatically).

**Files:**
- Modify: `src/app/globals.css`
- Modify: `src/app/layout.tsx`
- Create: `src/lib/format.ts`
- Create: `src/lib/format.test.ts`
- Modify: `playwright.config.ts`

### Task 0.1: Swap `@theme` to the Sapphire ramp

**File:** `src/app/globals.css`

- [ ] **Step 1: Replace the `@theme` primary ramp + accent + add Sapphire-specific tokens.** Replace lines 16–48 (the `@theme {…}` block and the `:root` shadow block) with:

```css
@theme {
  /* Primary ramp — Sapphire (tokens.json "derived"; 400 interpolated) */
  --color-primary-50:  #f0f5ff;
  --color-primary-100: #e0eaff;
  --color-primary-200: #c7d8ff;
  --color-primary-300: #9fbaff;
  --color-primary-400: #6f8cf9;
  --color-primary-500: #4f72ff;
  --color-primary-600: #3955e8;
  --color-primary-700: #2f43c4;
  --color-primary-800: #283a9e;
  --color-primary-900: #1e2d7a;

  /* Accent — amber */
  --color-accent-400: #fbbf24;
  --color-accent-500: #f59e0b;
  --color-accent-600: #b45309;

  /* Semantic status colors */
  --color-success: #10b981;
  --color-success-soft: #d1fae5;
  --color-success-deep: #047857;
  --color-danger:  #ef4444;
  --color-danger-soft: #fee2e2;
  --color-danger-deep: #b91c1c;
  --color-warning: #f59e0b;
  --color-info:    #3955e8;

  /* Ink / text ramp */
  --color-ink-1: #0f172a;
  --color-ink-2: #334155;
  --color-ink-3: #64748b;
  --color-ink-4: #94a3b8;
  --color-ink-5: #cbd5e1;
  --color-canvas: #f6f8fb;

  /* Radii */
  --radius-sm: 5px;
  --radius:    8px;
  --radius-lg: 12px;

  /* Type */
  --font-display: 'Inter', ui-sans-serif, system-ui, sans-serif;
  --font-sans: 'IBM Plex Sans Thai', 'Sarabun', ui-sans-serif, system-ui, -apple-system, sans-serif;
  --font-mono: 'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
}

:root {
  /* Layered shadows (tokens.json) */
  --shadow-card: 0 1px 2px rgb(15 23 42 / 0.04), 0 4px 12px rgb(15 23 42 / 0.05), 0 12px 32px rgb(15 23 42 / 0.06);
  --shadow-cta:  0 1px 2px rgb(57 85 232 / 0.15), 0 8px 24px rgb(57 85 232 / 0.28);
  --shadow-hero: 0 20px 60px rgb(30 45 122 / 0.28), 0 4px 12px rgb(30 45 122 / 0.18);
  --border-color: rgb(15 23 42 / 0.08);
  --border-strong: rgb(15 23 42 / 0.14);
  --brand-glow: rgb(57 85 232 / 0.32);
  --accent-glow: rgb(251 191 36 / 0.5);
  color-scheme: light; /* lock light — dark mode out of scope */
}
```

- [ ] **Step 2: Add shared utility classes** below the base block (keep existing `.tabular`):

```css
/* Display type for headings / KPI numerics */
.display { font-family: var(--font-display); letter-spacing: -0.015em; }
.h-page  { font-family: var(--font-display); font-weight: 700; letter-spacing: -0.025em; }
.mono    { font-family: var(--font-mono); }

/* Canonical surface card (layered shadow, hairline border) */
.surface {
  background: #fff;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-card);
}
.shadow-cta  { box-shadow: var(--shadow-cta); }
.shadow-hero { box-shadow: var(--shadow-hero); }
```

- [ ] **Step 3: Verify build + visual smoke.** Run `npm run dev`, open `/login` and `/admin`. Expected: blue chrome is now Sapphire; no console errors; fonts still render (Inter loads in Task 0.2). Commit.

```bash
git add src/app/globals.css
git commit -m "feat(design): swap @theme to Sapphire Editorial tokens + utilities"
```

### Task 0.2: Load the Inter display font

**File:** `src/app/layout.tsx`

- [ ] **Step 1: Add `next/font` for Inter + IBM Plex families** and apply CSS variables on `<body>`. At the top of the file:

```tsx
import { IBM_Plex_Sans_Thai, IBM_Plex_Mono, Inter } from 'next/font/google';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
const plexThai = IBM_Plex_Sans_Thai({
  subsets: ['thai', 'latin'], weight: ['300', '400', '500', '600', '700'],
  variable: '--font-plex-thai', display: 'swap',
});
const plexMono = IBM_Plex_Mono({
  subsets: ['latin'], weight: ['400', '500'], variable: '--font-plex-mono', display: 'swap',
});
```

- [ ] **Step 2: Attach the font variables to `<html>`** so the `@theme` `--font-*` stacks resolve to the loaded faces:

```tsx
<html lang={locale} className={`${inter.variable} ${plexThai.variable} ${plexMono.variable}`}>
```

- [ ] **Step 3: Point the `@theme` font stacks at the loaded variables.** In `globals.css`, change the font tokens to prefer the `next/font` variables:

```css
  --font-display: var(--font-inter), ui-sans-serif, system-ui, sans-serif;
  --font-sans: var(--font-plex-thai), 'Sarabun', ui-sans-serif, system-ui, sans-serif;
  --font-mono: var(--font-plex-mono), ui-monospace, monospace;
```

- [ ] **Step 4: Verify** — `/admin` headings render in Inter, Thai body in Plex Thai, no FOUT flash. Commit.

```bash
git add src/app/layout.tsx src/app/globals.css
git commit -m "feat(design): load Inter display font via next/font"
```

### Task 0.3: Pure formatting helpers (TDD)

**Files:** Create `src/lib/format.ts`, `src/lib/format.test.ts`

- [ ] **Step 1: Write the failing test** `src/lib/format.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { formatTHB, initials, formatThaiDate } from './format';

describe('formatTHB', () => {
  it('formats with ฿ and thousands separators, no decimals', () => {
    expect(formatTHB(5000)).toBe('฿5,000');
    expect(formatTHB(0)).toBe('฿0');
  });
});

describe('initials', () => {
  it('takes first two chars, uppercased', () => {
    expect(initials('สมพงษ์ ผจญภัย')).toBe('สม');
    expect(initials('admin@x.com')).toBe('AD');
  });
});

describe('formatThaiDate', () => {
  it('renders Buddhist-era short Thai date', () => {
    expect(formatThaiDate(new Date('2026-06-01'))).toMatch(/มิ\.ย\./);
  });
});
```

- [ ] **Step 2: Run it — expect FAIL** (module not found). `npm run test -- format`.

- [ ] **Step 3: Implement** `src/lib/format.ts`:

```ts
const thb = new Intl.NumberFormat('th-TH', { maximumFractionDigits: 0 });

/** "฿5,000" — tabular-friendly money for THB. */
export function formatTHB(amount: number): string {
  return `฿${thb.format(amount)}`;
}

/** First two characters of a name/email, uppercased (avatar initials). */
export function initials(label: string): string {
  return label.trim().slice(0, 2).toUpperCase();
}

/** Short Thai date, Buddhist era — e.g. "1 มิ.ย. 2569". */
export function formatThaiDate(d: Date): string {
  return new Intl.DateTimeFormat('th-TH', {
    day: 'numeric', month: 'short', year: 'numeric',
  }).format(d);
}
```

- [ ] **Step 4: Run — expect PASS.** `npm run test -- format`.

- [ ] **Step 5: Commit.**

```bash
git add src/lib/format.ts src/lib/format.test.ts
git commit -m "feat: add THB/date/initials formatting helpers"
```

### Task 0.4: Add the mobile Playwright project

**File:** `playwright.config.ts`

- [ ] **Step 1: Add a `mobile` project** to the `projects` array (alongside the existing desktop project), using a phone viewport:

```ts
import { devices } from '@playwright/test';
// …
projects: [
  // …existing desktop project(s)…
  { name: 'mobile', use: { ...devices['Pixel 7'] } },
],
```

- [ ] **Step 2: Verify config loads** — `npx playwright test --list` shows specs under both projects. Commit.

```bash
git add playwright.config.ts
git commit -m "test(e2e): add mobile (Pixel 7) Playwright project"
```

**PR-0 done-criteria:** lint + typecheck + unit tests green; app renders in Sapphire with Inter; existing e2e unaffected. Merge.

---

# PR-1 — Shared core components + AppShell

**Goal:** Build the full shared component inventory so every later PR composes components instead of inline markup. Ends with the admin shell already wearing the new design (sidebar card + topbar + PageHeader available).

> This PR is large. Implement components in the order below; each is its own commit. Components with interactive logic get a Playwright spec; presentational ones are verified visually + by typecheck.

**File list (create unless noted):**
`src/components/ui/{pill,tabs,avatar,dialog,confirm-dialog,responsive-table,kpi-hero,stat-card,progress-ring,day-chip,dropzone,empty-state,filter-bar,page-header}.tsx`; modify `src/components/ui/{button,card,status-badge}.tsx`; modify `src/components/admin/{sidebar,topbar,void-dialog}.tsx` + `src/app/(admin)/layout.tsx`; tests `tests/e2e/{confirm-dialog,mobile-nav,responsive-table,tabs}.spec.ts`.

### Task 1.1: `Dialog` primitive (accessible modal)

**File:** Create `src/components/ui/dialog.tsx`

- [ ] **Step 1: Implement** an accessible modal: backdrop, centered panel, `role="dialog" aria-modal`, Esc-to-close, focus-trap to first focusable, body-scroll-lock, click-backdrop-to-close (opt-out). Controlled via `open`/`onClose`.

```tsx
'use client';
import { type ReactNode, useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';

type Props = {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  /** Disable backdrop-click close (e.g. while a mutation is pending). */
  dismissable?: boolean;
  className?: string;
};

export function Dialog({ open, onClose, title, children, dismissable = true, className }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panelRef.current?.querySelector<HTMLElement>('[data-autofocus],button,textarea,input,select')?.focus();
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape' && dismissable) onClose(); }
    window.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = prev; window.removeEventListener('keydown', onKey); };
  }, [open, dismissable, onClose]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink-1/40 p-0 sm:items-center sm:p-4"
      onMouseDown={(e) => { if (dismissable && e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        className={cn(
          'w-full rounded-t-2xl bg-white p-5 shadow-hero sm:max-w-md sm:rounded-2xl',
          className,
        )}
      >
        {title && <h3 className="h-page text-lg text-ink-1">{title}</h3>}
        {children}
      </div>
    </div>
  );
}
```

Note the mobile treatment: bottom-sheet on `<sm`, centered modal on `≥sm` — reused by `FilterBar` and `ConfirmDialog`.

- [ ] **Step 2: Typecheck + commit.**

```bash
git add src/components/ui/dialog.tsx
git commit -m "feat(ui): accessible Dialog primitive (bottom-sheet on mobile)"
```

### Task 1.2: `ConfirmDialog` (+ optional required reason)

**File:** Create `src/components/ui/confirm-dialog.tsx`

- [ ] **Step 1: Implement** a trigger + Dialog that runs an async action, supports an optional **required reason** field, a `tone` (primary|danger), pending state, and inline error. Returns `{ ok } | { ok:false, message }`.

```tsx
'use client';
import { type ReactNode, useId, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from './button';
import { Dialog } from './dialog';

export type ActionResult = { ok: true } | { ok: false; message: string };

type Props = {
  trigger: (open: () => void) => ReactNode;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'primary' | 'danger';
  /** When set, a textarea is shown and its trimmed value is required before confirm. */
  reason?: { label: string; placeholder?: string };
  action: (reason: string) => Promise<ActionResult>;
  /** Refresh the route on success (default true). */
  refreshOnSuccess?: boolean;
};

export function ConfirmDialog({
  trigger, title, description, confirmLabel = 'ยืนยัน', cancelLabel = 'ยกเลิก',
  tone = 'primary', reason, action, refreshOnSuccess = true,
}: Props) {
  const router = useRouter();
  const reasonId = useId();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function close() { setOpen(false); setValue(''); setError(null); }
  function confirm() {
    setError(null);
    if (reason && !value.trim()) { setError('กรุณาระบุเหตุผล'); return; }
    start(async () => {
      const r = await action(value.trim());
      if (r.ok) { close(); if (refreshOnSuccess) router.refresh(); }
      else setError(r.message);
    });
  }

  return (
    <>
      {trigger(() => setOpen(true))}
      <Dialog open={open} onClose={() => !pending && close()} title={title} dismissable={!pending}>
        {description && <p className="mt-1 text-sm text-ink-3">{description}</p>}
        {reason && (
          <div className="mt-4">
            <label htmlFor={reasonId} className="block text-xs font-medium text-ink-2">{reason.label}</label>
            <textarea
              id={reasonId} data-autofocus rows={3} value={value} disabled={pending}
              onChange={(e) => setValue(e.target.value)} placeholder={reason.placeholder}
              className="mt-1 w-full rounded-lg border border-gray-300 p-2 text-sm focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-100"
            />
          </div>
        )}
        {error && <p role="alert" className="mt-2 text-xs font-medium text-danger-deep">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={close} disabled={pending}>{cancelLabel}</Button>
          <Button variant={tone === 'danger' ? 'destructive' : 'primary'} size="sm" onClick={confirm} disabled={pending}>
            {pending ? 'กำลังดำเนินการ…' : confirmLabel}
          </Button>
        </div>
      </Dialog>
    </>
  );
}
```

- [ ] **Step 2: Typecheck + commit.**

```bash
git add src/components/ui/confirm-dialog.tsx
git commit -m "feat(ui): ConfirmDialog with optional required-reason + tone"
```

### Task 1.3: Refactor `VoidDialog`/`RestoreButton` onto `ConfirmDialog`

**File:** `src/components/admin/void-dialog.tsx` — **keep the exported API identical** (callers in attendance/leave/advance lists must not change).

- [ ] **Step 1:** Re-implement `VoidDialog` as a thin wrapper over `ConfirmDialog` with `reason={{ label:'เหตุผล (จำเป็น)', placeholder:'เช่น บันทึกผิดวัน / อนุมัติผิดคน' }}`, `tone="danger"`, a destructive-text trigger using `triggerLabel`, and `confirmLabel` default `'ลบรายการ'`. Re-implement `RestoreButton` as a `ConfirmDialog` (no reason, `confirmLabel='กู้คืน'`) OR keep its current inline form — **but** route it through `ConfirmDialog` so restore also confirms (matches the action map). Preserve the `VoidActionResult` type and both function signatures.

- [ ] **Step 2: Run the existing void specs — must stay green:** `npm run test:e2e -- admin-attendance-void admin-leave-void admin-advance-void`. Fix selectors if the markup changed (prefer text/role).

- [ ] **Step 3: Commit.**

```bash
git add src/components/admin/void-dialog.tsx
git commit -m "refactor(void): build VoidDialog/RestoreButton on shared ConfirmDialog"
```

### Task 1.4: Extend `Button` (approve / reject variants + Sapphire)

**File:** `src/components/ui/button.tsx`

- [ ] **Step 1:** Add two variants to the `Variant` union and `variantClasses`:

```ts
type Variant = 'primary' | 'secondary' | 'destructive' | 'ghost' | 'approve' | 'reject';
// …in variantClasses:
approve:
  'bg-gradient-to-b from-success to-success-deep text-white shadow-cta hover:brightness-105 focus-visible:ring-success/40',
reject:
  'border border-gray-300 bg-white text-ink-2 hover:bg-gray-50 focus-visible:ring-primary-500/30',
```

Keep existing variants; just ensure `primary` reads `bg-primary-600 hover:bg-primary-700` (already token-based → now Sapphire).

- [ ] **Step 2: Typecheck + commit.**

```bash
git add src/components/ui/button.tsx
git commit -m "feat(ui): add approve/reject Button variants"
```

### Task 1.5: `Pill`, `Avatar`, `DayChip`, `Tabs` (presentational)

**Files:** Create `pill.tsx`, `avatar.tsx`, `day-chip.tsx`, `tabs.tsx` in `src/components/ui/`.

- [ ] **Step 1: `Pill`** — `variant` of `pending|approved|leave|neutral` mapping to the mockup `.pill-*` colors (amber-soft/green-soft/brand-soft/gray). Small rounded-full chip. (For semantic *status* keep `StatusBadge`; `Pill` is for generic tags like "พักร้อน".)
- [ ] **Step 2: `Avatar`** — initials avatar; `tone` `brand|amber`; sizes `sm|md`. Uses `initials()` from `src/lib/format.ts`.
- [ ] **Step 3: `DayChip`** — the `.day` date tile (day number + Thai month), `tone` `brand|danger`.
- [ ] **Step 4: `Tabs`** — controlled tab strip: `items: {key,label,badge?}[]`, `value`, `onChange`. `.tab on/off` styling (active = brand-50 bg + brand-200 border). Keyboard: arrow-key roving + `role="tablist"`.
- [ ] **Step 5: Typecheck + commit each.**

```bash
git add src/components/ui/pill.tsx src/components/ui/avatar.tsx src/components/ui/day-chip.tsx src/components/ui/tabs.tsx
git commit -m "feat(ui): Pill, Avatar, DayChip, Tabs primitives"
```

### Task 1.6: `ResponsiveTable` / `DataList`

**File:** Create `src/components/ui/responsive-table.tsx`

- [ ] **Step 1: Implement** a column-driven table that renders a semantic `<table>` at `md` and up, and **stacked label:value cards** below `md`. Generic over a row type.

```tsx
'use client';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type Column<T> = {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  /** Hide this column's row in the mobile card (e.g. redundant avatar). */
  hideOnMobile?: boolean;
  className?: string;
};

type Props<T> = {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  /** Optional row actions rendered in a trailing cell / card footer. */
  actions?: (row: T) => ReactNode;
  empty?: ReactNode;
};

export function ResponsiveTable<T>({ columns, rows, rowKey, actions, empty }: Props<T>) {
  if (rows.length === 0 && empty) return <>{empty}</>;
  return (
    <>
      {/* Desktop table */}
      <div className="hidden overflow-hidden rounded-xl border border-[var(--border-color)] md:block">
        <table className="w-full text-sm">
          <thead className="bg-gray-50/60 text-left text-xs font-semibold text-ink-3">
            <tr>{columns.map((c) => <th key={c.key} className={cn('px-5 py-3', c.className)}>{c.header}</th>)}
              {actions && <th className="px-5 py-3" />}</tr>
          </thead>
          <tbody className="divide-y divide-[var(--border-color)]">
            {rows.map((row) => (
              <tr key={rowKey(row)} className="hover:bg-gray-50/50">
                {columns.map((c) => <td key={c.key} className={cn('px-5 py-3.5', c.className)}>{c.cell(row)}</td>)}
                {actions && <td className="px-5 py-3.5 text-right">{actions(row)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* Mobile cards */}
      <ul className="space-y-3 md:hidden">
        {rows.map((row) => (
          <li key={rowKey(row)} className="surface p-4">
            <dl className="space-y-1.5">
              {columns.filter((c) => !c.hideOnMobile).map((c) => (
                <div key={c.key} className="flex justify-between gap-3 text-sm">
                  <dt className="text-ink-3">{c.header}</dt>
                  <dd className="text-right font-medium text-ink-1">{c.cell(row)}</dd>
                </div>
              ))}
            </dl>
            {actions && <div className="mt-3 flex justify-end gap-2 border-t border-[var(--border-color)] pt-3">{actions(row)}</div>}
          </li>
        ))}
      </ul>
    </>
  );
}
```

- [ ] **Step 2: Typecheck + commit.**

```bash
git add src/components/ui/responsive-table.tsx
git commit -m "feat(ui): ResponsiveTable (table on desktop, cards on mobile)"
```

### Task 1.7: Remaining presentational components

- [ ] **`KpiHero`** (`kpi-hero.tsx`): sapphire-gradient hero with the dashboard split — **checked-in** (white) + **not-checked-in** (amber) paired numbers, total, progress bar, sub-stats. Props: `{ checkedIn, notCheckedIn, total, late, leave, onTimeRate }`. (Mirrors the finalized `dashboard-sapphire.html` hero exactly.)
- [ ] **`StatCard`** (`stat-card.tsx`): label + big tabular number + optional delta + optional CTA link.
- [ ] **`ProgressRing`** (`progress-ring.tsx`): SVG ring, `value` 0–100, center label.
- [ ] **`Dropzone`** (`dropzone.tsx`): dashed upload affordance; props `{ label, hint, onFile, accept }`; wraps the existing upload server action (receipt/medical-cert). Preserve current upload behavior — this is a restyle of the trigger, not a new pipeline.
- [ ] **`EmptyState`** (`empty-state.tsx`): icon + title + hint + optional action.
- [ ] **`FilterBar`** (`filter-bar.tsx`): inline `children` row at `md`; a "ตัวกรอง" button opening a `Dialog` bottom-sheet at `<md`.
- [ ] **Commit** (one commit, presentational batch).

```bash
git add src/components/ui/kpi-hero.tsx src/components/ui/stat-card.tsx src/components/ui/progress-ring.tsx src/components/ui/dropzone.tsx src/components/ui/empty-state.tsx src/components/ui/filter-bar.tsx
git commit -m "feat(ui): KpiHero, StatCard, ProgressRing, Dropzone, EmptyState, FilterBar"
```

### Task 1.8: `PageHeader`

**File:** Create `src/components/ui/page-header.tsx`

- [ ] **Step 1: Implement** the unified content header from `nav.js`: breadcrumb (`Workspace › section`) + `h1` title + optional subtitle + a right-aligned `actions` slot; responsive (title scales, actions wrap, breadcrumb condenses `<sm`).

```tsx
import type { ReactNode } from 'react';

type Props = {
  breadcrumb?: string;      // e.g. "พนักงาน" → renders "Workspace › พนักงาน"
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
};

export function PageHeader({ breadcrumb, title, subtitle, actions }: Props) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:mb-7 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        {breadcrumb && (
          <nav className="mb-2 flex items-center gap-1.5 text-xs text-ink-3" aria-label="breadcrumb">
            <span className="display">Workspace</span>
            <span className="text-ink-5">›</span>
            <span className="font-medium text-ink-2">{breadcrumb}</span>
          </nav>
        )}
        <h1 className="h-page text-2xl text-ink-1 sm:text-3xl">{title}</h1>
        {subtitle && <p className="mt-1.5 text-sm text-ink-3">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
```

- [ ] **Step 2: Commit.**

```bash
git add src/components/ui/page-header.tsx
git commit -m "feat(ui): unified PageHeader (breadcrumb + title + actions)"
```

### Task 1.9: Restyle the AppShell (layout + Sidebar + Topbar)

**Files:** `src/app/(admin)/layout.tsx`, `src/components/admin/sidebar.tsx`, `src/components/admin/topbar.tsx`

- [ ] **Step 1: Layout → canvas + floating sidebar.** Change the shell to the Sapphire canvas (`bg-canvas`) with content gutters; the sidebar becomes a floating rounded card with layered shadow, the topbar sits above the main column. Keep `requireRole(['Admin','Superadmin'])`. Keep the `Sidebar`/`Topbar` composition (mobile drawer still works — it's CSS-only).

- [ ] **Step 2: Sidebar → floating card + Sapphire active state.** Restyle the `<aside>` to `surface`-style rounded card (desktop), keep the `fixed`+`translate` mobile drawer. Active item: `bg-primary-50 text-primary-700` + brand left-accent rail (already present — just retoned). Group the nav into "เมนูหลัก" / "ระบบ" sections (the disabled `เงินเดือน/บัญชี/Audit log` get a "เร็วๆ นี้" pill — already implemented). Add the SP user card at the bottom (matches mockup). **Keep the `NAV` array and `isActive` logic unchanged** (functionality parity).

- [ ] **Step 3: Topbar → Sapphire + ⌘K placeholder.** Restyle to the mockup topbar; **add a non-functional ⌘K search affordance** (button with search icon + `⌘K` kbd hint) that is visually present but does nothing yet (or opens a "เร็วๆ นี้" tooltip). Keep the hamburger, `NotificationBell`, and `UserMenu` (profile/language/logout) exactly as-is. **DECIDED: `PageHeader` owns the breadcrumb — the Topbar drops its breadcrumb entirely** (no double breadcrumb). Remove the `<nav aria-label="breadcrumb">` block and the `segments`/`labelFor`/`SEGMENT_LABELS` machinery from `topbar.tsx`; that responsibility now lives in `PageHeader` (per-page `breadcrumb` prop). The topbar's left cluster becomes just the hamburger + the ⌘K search.

- [ ] **Step 4: Run e2e auth + smoke + mobile-nav** to confirm the shell still authenticates, navigates, and the drawer works. `npm run test:e2e -- auth smoke`.

- [ ] **Step 5: Commit.**

```bash
git add src/app/(admin)/layout.tsx src/components/admin/sidebar.tsx src/components/admin/topbar.tsx
git commit -m "feat(design): Sapphire AppShell — floating sidebar card + topbar + ⌘K placeholder"
```

### Task 1.10: Component-behavior e2e specs

**Files:** Create `tests/e2e/{confirm-dialog,mobile-nav,responsive-table,tabs}.spec.ts`

- [ ] **Step 1: `mobile-nav.spec.ts`** (mobile project): on `/admin`, drawer hidden; tap hamburger → drawer visible; tap a nav link → navigates + drawer closes.
- [ ] **Step 2: `confirm-dialog.spec.ts`**: drive a page that uses `ConfirmDialog` (use `/admin/advance` once PR-5 lands, or a minimal test harness route): clicking approve opens a dialog showing the amount; **Cancel** closes with no mutation; **Confirm** triggers the action. (Until PR-5, scope this spec to the void flow already covered, and expand in PR-5.)
- [ ] **Step 3: `responsive-table.spec.ts`**: on a list page, desktop project asserts `<th>` headers present; mobile project asserts the stacked-card markup present and **no horizontal scroll** (`scrollWidth <= clientWidth`).
- [ ] **Step 4: `tabs.spec.ts`**: switching tabs changes the filtered list / active state.
- [ ] **Step 5: Run the new specs on both projects; commit.**

```bash
git add tests/e2e/confirm-dialog.spec.ts tests/e2e/mobile-nav.spec.ts tests/e2e/responsive-table.spec.ts tests/e2e/tabs.spec.ts
git commit -m "test(e2e): confirm-dialog, mobile-nav, responsive-table, tabs"
```

**PR-1 done-criteria:** all components exist + typecheck; AppShell reskinned; existing e2e green; new component specs green on desktop + mobile. Merge.

---

# PR-2 … PR-12 — Page-group ports

> Each PR below shares this **per-page recipe**. When we start a PR, expand it into its own detailed sub-plan (TDD/Playwright steps with concrete code) from this spec.

**Per-page recipe (apply to every page):**
1. Replace the page's bespoke header with `<PageHeader breadcrumb title subtitle actions />`.
2. Wrap content sections in `Card`/`.surface`; replace inline cards.
3. Replace data tables with `<ResponsiveTable>`; define `columns` + mobile `hideOnMobile` + `actions`.
4. Replace status chips with `StatusBadge`/`Pill`; avatars with `Avatar`; date tiles with `DayChip`.
5. Replace filter rows with `<FilterBar>`; tab strips with `<Tabs>`.
6. Route every sensitive action (per the confirm-map) through `<ConfirmDialog>` (or `VoidDialog`).
7. Collapse multi-column forms to single column `<md`; bottom-anchor primary CTA on mobile.
8. **Do not touch the server action signatures or the data-fetching** — restyle the view only.
9. Verify at 1440px and 390px against the matching mockup; keep the page's existing e2e green; add/adjust specs for new confirms.
10. lint + typecheck + test + e2e green → commit.

### PR-2 — Dashboard `/admin` + Owner `/owner`
- **Files:** `src/app/(admin)/admin/page.tsx`, `src/app/(owner)/owner/page.tsx` (+ any extracted client cards).
- **Build:** `KpiHero` (checked-in / not-checked-in numbers — the finalized hero), `StatCard` grid, pending-approvals list (links to leave/advance), on-leave panel, `ProgressRing` on-time rate. Owner = read-only subset.
- **Sensitive actions:** none (dashboard is read + navigation). 
- **Responsive:** KPI `grid-cols-2 md:grid-cols-4`; hero stacks; lists become cards.
- **Tests:** smoke (renders, counts present); mobile snapshot of hero readability.

### PR-3 — Employees
- **Files:** `src/app/(admin)/admin/employees/{page,new/page,[id]/edit/page}.tsx`, `actions.ts` (unchanged), client bits.
- **Build:** list with `FilterBar` (search + branch + dept + status — preserve existing filters) + `ResponsiveTable`; new/edit forms via `FormField`/`Input` single-column on mobile.
- **Sensitive actions:** delete/archive employee, unlink LINE → `ConfirmDialog` (danger). 
- **Tests:** keep employee-list behavior; add confirm spec for delete + unlink.

### PR-4 — Leave admin `/admin/leave`
- **Files:** `src/app/(admin)/admin/leave/page.tsx` (+ client review rows), `src/lib/leave/actions.ts` (unchanged).
- **Build:** `Tabs` (รออนุมัติ · N / ทั้งหมด / 🗑️ ถังขยะ), review rows with `DayChip` + `Avatar` + `Pill`, expandable detail (quota remaining, medical-cert via `Dropzone` view), approve/reject.
- **Sensitive actions:** approve (confirm — "สร้าง N วันลา"), reject (confirm + optional reason), void (required reason), restore.
- **Tests:** `admin-leave-approval` + `admin-leave-void` stay green; add approve-confirm spec.

### PR-5 — Advance admin `/admin/advance`
- **Files:** `src/app/(admin)/admin/advance/page.tsx` (+ client rows), `src/lib/advance/actions.ts` (unchanged).
- **Build:** `Tabs` + balance-check panel + receipt `Dropzone`; approve shows **฿amount + post-balance** in the confirm.
- **Sensitive actions:** approve (confirm with amount — money), reject (confirm + reason), void (reason), restore.
- **Tests:** `admin-advance-approval` + `admin-advance-void` green; finish `confirm-dialog.spec.ts` (amount shown, cancel aborts, confirm mutates).

### PR-6 — Attendance `/admin/attendance` (+ disputed/live/manual)
- **Files:** `src/app/(admin)/admin/attendance/{page,disputed/page,live/page,manual/page,layout}.tsx`.
- **Build:** records list `ResponsiveTable` + `FilterBar`; disputed inbox approve/reject; **live board** keep Realtime + 30s polling (restyle only); manual entry form.
- **Sensitive actions:** disputed approve/reject (confirm), manual overwrite (confirm only when replacing an existing row), void/restore, force-checkout (confirm).
- **Tests:** `admin-attendance-void` green; live board still updates; mobile records readable.

### PR-7 — Settings CRUDs (parametrized)
- **Scope:** branches, departments, accounting-groups, holidays, leave-types, work-schedules — each `{page,new/page,[id]/edit/page}.tsx` + `actions.ts` (unchanged). 24 pages share **one recipe**.
- **Build:** a settings list = `PageHeader` + `ResponsiveTable` (+ "เพิ่ม" action) + delete confirm; a settings form = `Card` + `FormField`s single-column on mobile. Branches keep the **Leaflet geofence picker** (`geofence-picker-dynamic`) — restyle the surrounding card only.
- **Sensitive actions:** delete each entity → `ConfirmDialog` (danger, with in-use guard message where the action already guards).
- **Tests:** `admin-settings-crud` + `admin-department-crud` green; one parametrized mobile spec.

### PR-8 — Settings: roles + team
- **Files:** `src/app/(admin)/admin/settings/{roles,team}/{page,new/page,[id]/edit/page}.tsx` + `actions.ts` (unchanged).
- **Build:** roles permission **matrix** (responsive: matrix on desktop, grouped toggles on mobile); team assignment editor.
- **Sensitive actions:** delete role (confirm; block if assigned), remove/role-change team member (confirm).
- **Tests:** role guard behavior unchanged; add confirm specs.

### PR-9 — Profile `/admin/profile`
- **Files:** `src/app/(admin)/admin/profile/page.tsx`, `actions.ts` (unchanged).
- **Build:** profile card + password-change form + language.
- **Sensitive actions:** change password → confirm (current-password gate already exists).

### PR-10 — Auth (login / reset / update-password)
- **Files:** `src/app/(auth)/{login,reset-password,update-password}/page.tsx`, `(auth)/layout.tsx`, `actions.ts` (unchanged).
- **Build:** restyle to `auth-sapphire.html` — centered card on canvas, brand mark, Sapphire inputs/buttons. Mobile = full-width card.
- **Sensitive actions:** none new. **Tests:** `auth.spec.ts` green (login flow unchanged).

### PR-11 — LIFF + pairing
- **Files:** `src/app/(liff)/liff/**` (check-in, leave list/new/[id], advance list/new/[id], calendar, profile, pair, pair/[token]), `(liff)/layout.tsx`, `src/app/i/[token]/page.tsx`.
- **Build:** mobile-first restyle (LINE webview) — Sapphire tokens, `Button`/`Card`/`Dialog`; check-in screen (GPS/geofence/selfie — restyle only, keep logic), leave/advance submit + balance card + cert/receipt `Dropzone`, calendar, profile.
- **Sensitive actions:** cancel leave/advance request → `ConfirmDialog`. Keep all LIFF SDK + GPS + upload logic intact.
- **Tests:** keep LIFF-related specs green; verify ≥44px touch targets.

### PR-12 — Consistency + a11y sweep + docs
- **Build:** cross-page audit (one PageHeader per page, consistent spacing/shadows, focus-visible rings, `prefers-reduced-motion` on the drawer/dialog transitions, color-contrast check on pills/buttons). Refresh `docs/user-guide/` screenshots to the new design.
- **Tests:** full `npm run test:e2e` on desktop + mobile; final visual pass across all routes vs mockups.

---

## Self-Review (against the request)

- ✅ **"unified … shared core components as much as possible"** — PR-1 builds one component per recurring pattern; the per-page recipe forbids re-deriving markup. Inventory table + recipe enforce it.
- ✅ **"all functionalities correctly ported and available"** — recipe step 8 (don't touch actions/data), the existing Playwright specs as a parity gate, and per-PR "keep X spec green" lines cover every mutating flow.
- ✅ **"create new tests if needed"** — PR-0 (format helpers), PR-1 (4 component specs + mobile project), per-PR confirm/mobile specs.
- ✅ **"confirm dialog on sensitive/important actions"** — explicit confirm-map; `ConfirmDialog` primitive; VoidDialog refactored onto it.
- ✅ **"all pages mobile view … good design, easy to read"** — Responsive Strategy section + `ResponsiveTable`/`FilterBar`/bottom-sheet `Dialog` + mobile Playwright project + per-PR mobile verification.
- ✅ **Scope/decomposition** — master plan fully codes the foundation (PR-0/1); page groups are independent, shippable PRs, each to get its own detailed sub-plan. No placeholder code in the foundation tasks.
- ⚠️ **Open item to confirm during PR-1:** whether to keep the breadcrumb in the Topbar or move it solely into `PageHeader` (avoid double breadcrumb). Recommendation: `PageHeader` owns it; Topbar drops the breadcrumb. Decide in Task 1.9.

---

## Execution Handoff

Per the plan, the foundation (PR-0, PR-1) should be executed first and reviewed before the page-group PRs begin. Each page-group PR (PR-2…PR-12) is expanded into its own detailed sub-plan at the time we start it, using the recipe above.

### Progress

- ✅ **PR-0** Foundation (tokens, fonts, utilities, mobile Playwright project)
- ✅ **PR-1** Shared core components + AppShell restyle (canon card surface: `rounded-xl border border-gray-200 bg-white shadow-sm`)
- ✅ **PR-2** Dashboard `/admin` + Owner `/owner`
- ✅ **PR-3** Employees (list/new/edit) — full-width 2-col form, `belowForm` PairingCard, ConfirmDialog danger actions
- ✅ **PR-4** Leave admin `/admin/leave` — PageHeader, tab chips, StatusBadge, EmptyState; **fixed approve/reject revalidatePath race** (dynamic page → no revalidate → panel owns settled confirmation). Both leave-approval e2e tests deterministic.
- ✅ **PR-5** Advance admin `/admin/advance` — same restyle; **unified approve/reject onto shared ConfirmDialog** (approve confirm shows ฿amount; receipt via shared Dropzone); same revalidate-race fix. Rewrote stale advance-approval spec (was driving a removed receipt-URL textbox) + added `confirm-dialog.spec.ts` (amount shown / cancel aborts / confirm mutates).
  - ⏸️ Deferred: "post-balance in approve confirm" — on approve an advance flips Pending→Approved but stays reserved-not-deducted, so available balance doesn't change; the line would be misleading. The ฿amount is the real safety gate. Revisit if a true available-balance/overdraw warning is wanted.
- ⬜ **PR-6** Attendance (records/disputed/live/manual) — next
- ⬜ **PR-7** Settings CRUDs · ⬜ **PR-8** roles+team · ⬜ **PR-9** profile · ⬜ **PR-10** auth · ⬜ **PR-11** LIFF · ⬜ **PR-12** consistency+a11y sweep + doc screenshots

**Known local-env limitations (not regressions):** the `*-void` e2e specs can't run locally (`Cannot find module next/headers` during Playwright collection of `src/lib/*/void.ts`); the advance receipt-upload e2e path needs a Storage bucket (none in local stack).

---

## Post-PR-5 refinement — Review modal + status rail (2026-06-03)

After QA, the inline `ตรวจสอบ` accordion on `/admin/leave` and `/admin/advance`
was replaced with a shared focused **`ReviewModal`**, and request rows gained a
status-colored **left rail + icon badge** for at-a-glance scannability. See
`docs/superpowers/specs/2026-06-03-review-modal-status-redesign-design.md` and
`docs/superpowers/plans/2026-06-03-review-modal-status-redesign.md`.

- New shared primitives: `STATUS_RAIL`/`STATUS_ICON`/`statusRail()` (next to
  `StatusBadge`), `DialogFooter`, `ReviewModal` (composes `Dialog`+`DialogFooter`;
  owns required-note, in-modal money-confirm + void-reason steps, success →
  `router.refresh()`). `Dialog` also gained an explicit ✕ close button.
- The two inline panels (`leave-review-panel.tsx`, `advance-review-panel.tsx`)
  and the advance approve `ConfirmDialog` were removed; void moved into the modal
  footer. Whole-row click opens the modal; decided rows are read-only.
- Tests: `confirm-dialog.spec.ts` → `review-modal.spec.ts` (amount/back/confirm/
  void); `admin-leave-approval` + `admin-advance-approval` updated to the modal
  flow. All three pass deterministically (the modal-closes-on-resolve flow also
  fixed the old flaky leave-reject/settled-message race).
- Reusable later by the attendance disputed inbox (PR-6) + dashboard pending lists.
