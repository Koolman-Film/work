# Admin Dashboard Work Calendar (ปฏิทินงาน) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a month leave/holiday calendar card ("ปฏิทินงาน") to the bottom of the admin dashboard (`/admin`), reusing the employee calendar grid, with month navigation and an all-branches-default branch filter.

**Architecture:** A client "island" (`AdminCalendarCard`) renders the existing `CalendarGrid` and calls a `'use server'` action (`loadAdminCalendar`) on each month/branch change, so the dashboard page never reads `searchParams` and keeps its `revalidate = 30` caching. A new org-wide data loader (`getOrgCalendarData`) sits beside the existing branch-scoped `getTeamCalendarData`, sharing an extracted private helper.

**Tech Stack:** Next.js App Router (Server Components + Server Actions), React (`useTransition`), Prisma, Tailwind (Sapphire design tokens), Vitest, Biome.

**Spec:** `docs/superpowers/specs/2026-06-08-admin-dashboard-calendar-design.md`

---

## Environment note (read once)

This repo pins `engines.node >= 24` and uses pnpm + `simple-git-hooks`. All `pnpm`
commands below assume **Node ≥ 24**. If you are stuck on Node 22:
- Run a single test file directly: `./node_modules/.bin/vitest run <path>`
- Run Biome directly: `./node_modules/.bin/biome check <path>`
- `git commit` may need `--no-verify` (the pre-commit hook invokes pnpm and aborts on the engine check).

Otherwise `nvm use 24` first and use the normal `pnpm` commands shown.

## File Structure

- **Modify** `src/lib/leave/team-calendar-shape.ts` — add the pure `formatThaiMonthLabel` helper (client-safe).
- **Modify** `src/lib/leave/team-calendar.test.ts` — add unit tests for `formatThaiMonthLabel`.
- **Modify** `src/lib/leave/team-calendar.ts` — extract a private `loadEntriesAndHolidays` helper; add `getOrgCalendarData`; `getTeamCalendarData` keeps its public signature.
- **Create** `src/app/(admin)/admin/_calendar/actions.ts` — `'use server'` `loadAdminCalendar`.
- **Create** `src/app/(admin)/admin/_calendar/admin-calendar-card.tsx` — `'use client'` island reusing `CalendarGrid`.
- **Modify** `src/app/(admin)/admin/page.tsx` — fetch branches + initial calendar data; render the card.
- **Reused untouched:** `src/app/(liff)/liff/calendar/calendar-grid.tsx`, and the `/liff/calendar` page.

---

## Task 1: Pure helper `formatThaiMonthLabel` (TDD)

**Files:**
- Modify: `src/lib/leave/team-calendar-shape.ts`
- Test: `src/lib/leave/team-calendar.test.ts`

- [ ] **Step 1: Write the failing test**

Add this `describe` block to the end of `src/lib/leave/team-calendar.test.ts`, and add `formatThaiMonthLabel` to the existing import from `'./team-calendar-shape'`:

```ts
describe('formatThaiMonthLabel', () => {
  it('formats month name + Buddhist year (June 2026 → 2569 BE)', () => {
    expect(formatThaiMonthLabel(2026, 5)).toBe('มิถุนายน 2569');
  });
  it('formats January', () => {
    expect(formatThaiMonthLabel(2027, 0)).toBe('มกราคม 2570');
  });
  it('formats December', () => {
    expect(formatThaiMonthLabel(2026, 11)).toBe('ธันวาคม 2569');
  });
});
```

The import line at the top of the test file becomes:

```ts
import {
  buildMonthGrid,
  formatThaiMonthLabel,
  indexEntriesByDate,
  parseMonth,
  shiftMonth,
  type TeamCalendarEntry,
} from './team-calendar-shape';
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/lib/leave/team-calendar.test.ts`
Expected: FAIL — `formatThaiMonthLabel is not a function` (or a TS/import error).

- [ ] **Step 3: Write the implementation**

Append to `src/lib/leave/team-calendar-shape.ts`:

```ts
// ─── Display helpers ───────────────────────────────────────────────────────

const THAI_MONTHS = [
  'มกราคม',
  'กุมภาพันธ์',
  'มีนาคม',
  'เมษายน',
  'พฤษภาคม',
  'มิถุนายน',
  'กรกฎาคม',
  'สิงหาคม',
  'กันยายน',
  'ตุลาคม',
  'พฤศจิกายน',
  'ธันวาคม',
] as const;

/**
 * Header label like "มิถุนายน 2569" — Thai month name + Buddhist-calendar
 * year (Gregorian + 543). `month0` is 0-indexed (0 = January).
 */
export function formatThaiMonthLabel(year: number, month0: number): string {
  return `${THAI_MONTHS[month0]} ${year + 543}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/lib/leave/team-calendar.test.ts`
Expected: PASS — all `formatThaiMonthLabel` cases plus the existing suite green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/leave/team-calendar-shape.ts src/lib/leave/team-calendar.test.ts
git commit -m "feat(calendar): add formatThaiMonthLabel pure helper"
```

---

## Task 2: Extract shared loader + add `getOrgCalendarData`

**Files:**
- Modify: `src/lib/leave/team-calendar.ts` (full-file replace)

No new unit test — this module is `server-only`/Prisma and, like the existing
`getTeamCalendarData`, is verified by typecheck + the still-green `-shape` suite
+ a manual LIFF load. The refactor keeps `getTeamCalendarData`'s public signature
identical.

- [ ] **Step 1: Replace the file contents**

Replace the entire contents of `src/lib/leave/team-calendar.ts` with:

```ts
import 'server-only';

/**
 * Leave-calendar data loaders.
 *
 * **Server-only.** The `import 'server-only'` marker makes any Client
 * Component import fail at compile time. Pure helpers (types, parseMonth,
 * buildMonthGrid, indexEntriesByDate, formatThaiMonthLabel) live in
 * `./team-calendar-shape.ts` and ARE safe to import from Client Components.
 *
 * Two public loaders, one shared core:
 *   - getTeamCalendarData  — employee view (/liff/calendar). Branch-scoped to
 *     the viewer: an employee is on my team if they share ANY branch with me
 *     (primary branchId OR assignedBranchIds overlap). Self is included.
 *   - getOrgCalendarData   — admin dashboard (/admin). All active employees by
 *     default, or a single branch when `branchId` is given.
 *
 * Both resolve an employee set, then delegate to `loadEntriesAndHolidays`,
 * which loads Pending+Approved leaves overlapping the month plus the month's
 * holidays. The leave query uses the classic overlap formula
 * `start ≤ monthEnd AND end ≥ monthStart` so a leave spanning Feb–Apr shows up
 * on the March view.
 */

import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { type TeamCalendarData, type TeamCalendarEntry, ymd } from './team-calendar-shape';

type EmployeeLite = {
  id: string;
  firstName: string;
  lastName: string;
  nickname: string | null;
};

/**
 * Shared core: given a resolved set of employees, load their leave entries
 * (Pending+Approved, overlapping the month) and the month's holidays.
 *
 * `viewerEmployeeId` marks each entry's `isMine`; pass `null` for admin/org
 * views where there is no "me" (every entry → isMine: false).
 *
 * Holidays load UNCONDITIONALLY — even when `employees` is empty — so an empty
 * branch still shows public holidays on the grid.
 */
async function loadEntriesAndHolidays(args: {
  employees: EmployeeLite[];
  monthStart: Date;
  monthEnd: Date;
  viewerEmployeeId: string | null;
}): Promise<TeamCalendarData> {
  const { employees, monthStart, monthEnd, viewerEmployeeId } = args;

  const holidaysPromise = prisma.holiday.findMany({
    where: { archivedAt: null, date: { gte: monthStart, lte: monthEnd } },
    select: { date: true, name: true },
    orderBy: { date: 'asc' },
  });

  if (employees.length === 0) {
    const holidays = await holidaysPromise;
    return {
      entries: [],
      holidays: holidays.map((h) => ({ date: ymd(h.date), name: h.name })),
    };
  }

  const empMap = new Map(employees.map((e) => [e.id, e]));

  const [leaves, holidays] = await Promise.all([
    prisma.leaveRequest.findMany({
      where: {
        employeeId: { in: employees.map((e) => e.id) },
        status: { in: ['Pending', 'Approved'] },
        startDate: { lte: monthEnd },
        endDate: { gte: monthStart },
      },
      select: {
        id: true,
        employeeId: true,
        startDate: true,
        endDate: true,
        status: true,
        leaveType: { select: { name: true } },
      },
      // Chronological within a day so the detail panel reads top-to-bottom.
      orderBy: [{ startDate: 'asc' }, { createdAt: 'asc' }],
    }),
    holidaysPromise,
  ]);

  const entries: TeamCalendarEntry[] = leaves
    .map((l): TeamCalendarEntry | null => {
      const emp = empMap.get(l.employeeId);
      if (!emp) return null; // shouldn't happen given the IN clause
      const fullName = `${emp.firstName} ${emp.lastName}`.trim();
      const short = emp.nickname?.trim() || emp.firstName;
      return {
        leaveRequestId: l.id,
        employeeId: l.employeeId,
        employeeName: fullName,
        shortLabel: short,
        leaveTypeName: l.leaveType.name,
        status: l.status as 'Pending' | 'Approved',
        startDate: ymd(l.startDate),
        endDate: ymd(l.endDate),
        isMine: viewerEmployeeId !== null && l.employeeId === viewerEmployeeId,
      };
    })
    .filter((x): x is TeamCalendarEntry => x !== null);

  return {
    entries,
    holidays: holidays.map((h) => ({ date: ymd(h.date), name: h.name })),
  };
}

/**
 * Employee view: leaves + holidays for everyone on `viewerEmployeeId`'s team
 * (shared-branch), for the month [monthStart, monthEnd].
 *
 * `monthStart` = first of month at UTC midnight; `monthEnd` = last day at UTC
 * midnight.
 */
export async function getTeamCalendarData(args: {
  viewerEmployeeId: string;
  monthStart: Date;
  monthEnd: Date;
}): Promise<TeamCalendarData> {
  const { viewerEmployeeId, monthStart, monthEnd } = args;

  const me = await prisma.employee.findUnique({
    where: { id: viewerEmployeeId },
    select: { branchId: true, assignedBranchIds: true },
  });
  if (!me) return { entries: [], holidays: [] };

  const myBranchIds = Array.from(new Set([me.branchId, ...me.assignedBranchIds]));

  const teammates = await prisma.employee.findMany({
    where: {
      archivedAt: null,
      status: { not: 'Archived' },
      OR: [{ branchId: { in: myBranchIds } }, { assignedBranchIds: { hasSome: myBranchIds } }],
    },
    select: { id: true, firstName: true, lastName: true, nickname: true },
  });

  return loadEntriesAndHolidays({ employees: teammates, monthStart, monthEnd, viewerEmployeeId });
}

/**
 * Admin view: leaves + holidays across ALL active employees (branchId omitted)
 * or a single branch (branchId set → employees whose primary branch is it OR
 * who are assigned to it). No viewer, so every entry's `isMine` is false.
 */
export async function getOrgCalendarData(args: {
  monthStart: Date;
  monthEnd: Date;
  branchId?: string | null;
}): Promise<TeamCalendarData> {
  const { monthStart, monthEnd, branchId } = args;

  const where: Prisma.EmployeeWhereInput = {
    archivedAt: null,
    status: { not: 'Archived' },
  };
  if (branchId) {
    where.OR = [{ branchId }, { assignedBranchIds: { hasSome: [branchId] } }];
  }

  const employees = await prisma.employee.findMany({
    where,
    select: { id: true, firstName: true, lastName: true, nickname: true },
  });

  return loadEntriesAndHolidays({ employees, monthStart, monthEnd, viewerEmployeeId: null });
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: PASS (no errors).

- [ ] **Step 3: Run the calendar test suite (regression check)**

Run: `pnpm test src/lib/leave/team-calendar.test.ts`
Expected: PASS — pure `-shape` tests unaffected by the loader refactor.

- [ ] **Step 4: Commit**

```bash
git add src/lib/leave/team-calendar.ts
git commit -m "refactor(calendar): extract shared loader, add getOrgCalendarData"
```

---

## Task 3: Server action `loadAdminCalendar`

**Files:**
- Create: `src/app/(admin)/admin/_calendar/actions.ts`

- [ ] **Step 1: Create the action file**

Create `src/app/(admin)/admin/_calendar/actions.ts`:

```ts
'use server';

/**
 * Server action backing the dashboard calendar island. Fetches a month of
 * org-wide (or single-branch) leave + holidays.
 *
 * Gated by `requirePermission('dashboard.read')` — the SAME permission as the
 * dashboard page. Server actions are independently callable POST endpoints, so
 * we re-check here (defense in depth) rather than trusting that the page
 * rendered.
 */

import { requirePermission } from '@/lib/auth/check-permission';
import { getOrgCalendarData } from '@/lib/leave/team-calendar';
import {
  currentMonthYM,
  parseMonth,
  type TeamCalendarData,
} from '@/lib/leave/team-calendar-shape';

export async function loadAdminCalendar(input: {
  ym: string;
  branchId: string | null;
}): Promise<TeamCalendarData> {
  await requirePermission('dashboard.read');

  // Defensive parse: a malformed `ym` falls back to the current month rather
  // than throwing (mirrors the LIFF calendar page).
  const parsed = parseMonth(input.ym) ?? parseMonth(currentMonthYM());
  if (!parsed) throw new Error('Could not parse current month — date system broken?');

  return getOrgCalendarData({
    monthStart: parsed.start,
    monthEnd: parsed.end,
    branchId: input.branchId,
  });
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(admin)/admin/_calendar/actions.ts"
git commit -m "feat(dashboard): add loadAdminCalendar server action"
```

---

## Task 4: Client island `AdminCalendarCard`

**Files:**
- Create: `src/app/(admin)/admin/_calendar/admin-calendar-card.tsx`

- [ ] **Step 1: Create the island component**

Create `src/app/(admin)/admin/_calendar/admin-calendar-card.tsx`:

```tsx
'use client';

/**
 * Dashboard work-calendar island.
 *
 * Reuses the employee `CalendarGrid` verbatim so the admin calendar looks and
 * behaves exactly like the one on /liff/calendar. Month navigation + branch
 * filtering are handled here without URL params (which would make the
 * dashboard page dynamic and kill its revalidate=30 caching): each change
 * calls the `loadAdminCalendar` server action and swaps the data in.
 *
 * `key={ym}` on CalendarGrid forces a remount on month change so the grid's
 * internal "selected day" resets to today / first-of-month. Branch changes
 * keep the same key, so the selected day persists and only the detail panel
 * refreshes (its lookup maps are useMemo'd over `entries`).
 */

import { useMemo, useState, useTransition } from 'react';
import { CalendarGrid } from '@/app/(liff)/liff/calendar/calendar-grid';
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  buildMonthGrid,
  currentMonthYM,
  formatThaiMonthLabel,
  parseMonth,
  shiftMonth,
  type TeamCalendarData,
} from '@/lib/leave/team-calendar-shape';
import { cn } from '@/lib/utils';
import { loadAdminCalendar } from './actions';

type Branch = { id: string; name: string };

type Props = {
  branches: Branch[];
  initialYm: string;
  initialData: TeamCalendarData;
};

export function AdminCalendarCard({ branches, initialYm, initialData }: Props) {
  const [ym, setYm] = useState(initialYm);
  const [branchId, setBranchId] = useState(''); // '' = all branches
  const [data, setData] = useState<TeamCalendarData>(initialData);
  const [isPending, startTransition] = useTransition();

  const todayYm = useMemo(() => currentMonthYM(), []);

  // Grid + label derive purely from `ym` via client-safe helpers. The `??`
  // fallback can't realistically fire (ym is always a valid YYYY-MM), but keeps
  // TS happy about parseMonth's nullable return.
  const parsed = useMemo(() => parseMonth(ym) ?? parseMonth(todayYm), [ym, todayYm]);
  const grid = useMemo(
    () => (parsed ? buildMonthGrid(parsed.year, parsed.month0) : []),
    [parsed],
  );
  const monthLabel = parsed ? formatThaiMonthLabel(parsed.year, parsed.month0) : '';

  const branchName = branchId ? branches.find((b) => b.id === branchId)?.name : undefined;
  const scopeLabel = branchName ?? 'ทุกสาขา';

  function reload(nextYm: string, nextBranchId: string) {
    startTransition(async () => {
      const next = await loadAdminCalendar({ ym: nextYm, branchId: nextBranchId || null });
      setData(next);
    });
  }

  function goPrev() {
    const next = shiftMonth(ym, -1);
    setYm(next);
    reload(next, branchId);
  }
  function goNext() {
    const next = shiftMonth(ym, 1);
    setYm(next);
    reload(next, branchId);
  }
  function goToday() {
    setYm(todayYm);
    reload(todayYm, branchId);
  }
  function onBranchChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value;
    setBranchId(next);
    reload(ym, next);
  }

  return (
    <Card>
      <CardHeader className="flex-wrap gap-3">
        <div className="min-w-0">
          <CardTitle>ปฏิทินงาน</CardTitle>
          <CardDescription>วันลาและวันหยุด — {scopeLabel}</CardDescription>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Branch filter — first option = all branches */}
          <select
            aria-label="กรองตามสาขา"
            value={branchId}
            onChange={onBranchChange}
            className="max-w-[200px] rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-100"
          >
            <option value="">สาขาทั้งหมด</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>

          {/* Month navigator */}
          <div className="flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-1 py-0.5">
            <button
              type="button"
              onClick={goPrev}
              aria-label="เดือนก่อนหน้า"
              className="grid size-8 place-items-center rounded-md text-ink-3 hover:bg-gray-100 hover:text-ink-1"
            >
              ‹
            </button>
            <p className="min-w-[7.5rem] text-center text-sm font-semibold text-ink-1">
              {monthLabel}
            </p>
            <button
              type="button"
              onClick={goNext}
              aria-label="เดือนถัดไป"
              className="grid size-8 place-items-center rounded-md text-ink-3 hover:bg-gray-100 hover:text-ink-1"
            >
              ›
            </button>
          </div>

          {ym !== todayYm && (
            <button
              type="button"
              onClick={goToday}
              className="rounded-lg border border-gray-200 bg-white px-2.5 py-2 text-xs font-medium text-ink-2 hover:bg-gray-50"
            >
              วันนี้
            </button>
          )}
        </div>
      </CardHeader>

      <CardBody>
        <div
          aria-busy={isPending}
          className={cn('transition-opacity', isPending && 'pointer-events-none opacity-60')}
        >
          <CalendarGrid key={ym} grid={grid} entries={data.entries} holidays={data.holidays} />
        </div>
      </CardBody>
    </Card>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Lint (auto-fix import order / formatting)**

Run: `pnpm lint:fix`
Expected: Biome formats the new files; no remaining errors. Re-run `pnpm typecheck` if it reordered imports.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(admin)/admin/_calendar/admin-calendar-card.tsx"
git commit -m "feat(dashboard): add AdminCalendarCard island (reuses CalendarGrid)"
```

---

## Task 5: Wire the card into the dashboard page

**Files:**
- Modify: `src/app/(admin)/admin/page.tsx`

- [ ] **Step 1: Add imports**

In `src/app/(admin)/admin/page.tsx`, add these imports alongside the existing
ones (Biome will sort on `lint:fix`):

```ts
import { getOrgCalendarData } from '@/lib/leave/team-calendar';
import { currentMonthYM, parseMonth } from '@/lib/leave/team-calendar-shape';
import { AdminCalendarCard } from './_calendar/admin-calendar-card';
```

- [ ] **Step 2: Compute the initial month**

Find:

```ts
  const today = bangkokDateUtcMidnight(new Date());
  const todayIsSunday = today.getUTCDay() === 0;
```

Replace with:

```ts
  const today = bangkokDateUtcMidnight(new Date());
  const todayIsSunday = today.getUTCDay() === 0;

  // Current Bangkok month for the dashboard calendar card.
  const initialYm = currentMonthYM();
  const calMonth = parseMonth(initialYm);
  if (!calMonth) throw new Error('Could not parse current month — date system broken?');
```

- [ ] **Step 3: Add the two queries to the existing `Promise.all`**

Find the destructuring head:

```ts
    pendingAdvanceRecent,
    onLeaveToday,
  ] = await Promise.all([
```

Replace with:

```ts
    pendingAdvanceRecent,
    onLeaveToday,
    branchesForCalendar,
    initialCalendar,
  ] = await Promise.all([
```

Then find the tail of the `Promise.all` array (the end of the OnLeave
`attendance.findMany`):

```ts
            leaveType: { select: { name: true } },
          },
        },
      },
    }),
  ]);
```

Replace with:

```ts
            leaveType: { select: { name: true } },
          },
        },
      },
    }),
    prisma.branch.findMany({
      where: { archivedAt: null },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
    getOrgCalendarData({ monthStart: calMonth.start, monthEnd: calMonth.end }),
  ]);
```

- [ ] **Step 4: Render the card below the two-column panels**

Find the end of the component (closing of the second `Card`, the two-column
grid `</div>`, and the page wrapper):

```tsx
        </Card>
      </div>
    </div>
  );
}
```

Replace with:

```tsx
        </Card>
      </div>

      {/* Work calendar — month leave/holiday view across all branches */}
      <div className="mt-4">
        <AdminCalendarCard
          branches={branchesForCalendar}
          initialYm={initialYm}
          initialData={initialCalendar}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS (no type errors, no Biome errors).

- [ ] **Step 6: Manual verification**

Run: `pnpm dev`, then as an admin user:
- Open `/admin`. A **ปฏิทินงาน** card renders below the two panels, showing the
  current month with leave bars + holiday dots, subtitle "วันลาและวันหยุด — ทุกสาขา".
- Click `›` / `‹` — the month label changes and the grid reloads (brief dim);
  `วันนี้` appears off the current month and returns to it.
- Change the **branch** dropdown — entries filter to that branch; subtitle tail
  becomes the branch name.
- Tap a day — the detail panel below the grid lists who is on leave that day.
- Open `/liff/calendar` as a staff user — the employee calendar is unchanged.

- [ ] **Step 7: Commit**

```bash
git add "src/app/(admin)/admin/page.tsx"
git commit -m "feat(dashboard): render ปฏิทินงาน work calendar at page bottom"
```

---

## Self-Review

**1. Spec coverage**
- Month nav (prev/next/today) → Task 4 (`goPrev/goNext/goToday`). ✓
- Island + server action preserving `revalidate=30` → Tasks 3–5 (page reads no `searchParams`). ✓
- All-branches default + branch selector → Task 2 (`getOrgCalendarData`), Task 4 (`<select>`). ✓
- Detail panel parity → Task 4 reuses `CalendarGrid` (which renders the panel). ✓
- Title "ปฏิทินงาน" + leave/holiday subtitle with branch tail → Task 4 (`CardTitle`/`CardDescription`, `scopeLabel`). ✓
- Shared-helper refactor, `getTeamCalendarData` signature unchanged → Task 2. ✓
- Holiday-on-empty-branch fix → Task 2 (`loadEntriesAndHolidays` loads holidays unconditionally). ✓
- `formatThaiMonthLabel` unit test → Task 1. ✓
- `/liff/calendar` untouched → no task modifies it; cross-route import is read-only. ✓

**2. Placeholder scan:** No TBD/TODO/"handle edge cases"/"similar to" — every code step shows complete code. ✓

**3. Type consistency:**
- `TeamCalendarData` returned by `loadEntriesAndHolidays`, `getOrgCalendarData`, `loadAdminCalendar`, and consumed by `AdminCalendarCard` — same type throughout. ✓
- `loadAdminCalendar({ ym, branchId: string | null })` — island calls it with `branchId: nextBranchId || null` (string→null). ✓
- `getOrgCalendarData({ monthStart, monthEnd, branchId? })` — page calls without `branchId` (all branches); action passes `branchId`. ✓
- `formatThaiMonthLabel(year, month0)` defined in Task 1, used in Task 4. ✓
- `Branch = { id, name }` matches the page's `prisma.branch.findMany(... select: { id, name })`. ✓
