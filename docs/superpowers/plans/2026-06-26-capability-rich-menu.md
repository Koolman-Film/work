# Capability-Driven Rich Menu (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the LINE rich menu a pure function of a user's capabilities — three states (employee-only, admin-only, admin+employee) — applied at every bind / merge / role-change, fixing the bug where a merged admin-employee silently loses their employee menu.

**Architecture:** A pure decision function (`computeMenuTarget`) + a best-effort I/O wrapper (`syncRichMenuForUser`) live in `src/lib/line/rich-menu.ts`. Every site that changes a user's LINE binding or capabilities calls `syncRichMenuForUser(userId)` after its mutation. Employee-only resolves to "unlink" so the OA default (employee) menu shows — so only one new menu object (`COMBINED_RICH_MENU_ID`) is created, via a setup script mirroring the existing admin one.

**Tech Stack:** TypeScript, Next.js 16 App Router, Prisma → Supabase (local Postgres for tests), `@line/bot-sdk` messaging client, Vitest, Biome.

## Global Constraints

- Rich-menu operations are **best-effort: never throw** — a LINE API failure must not break pairing/merge/role changes (log and return). Copied from the existing `rich-menu.ts` contract.
- LINE allows **one per-user rich menu** at a time, plus the OA-wide default. Employee-only = unlink (default shows).
- Menu ids come from **env vars** read at call time: `ADMIN_RICH_MENU_ID` (exists), `COMBINED_RICH_MENU_ID` (new). If an id is unset, log a warning and skip — do not throw.
- "Admin" capability = tier `Admin` or `Superadmin` per `computeTier` (`src/lib/auth/user-tier.ts`). "Employee" capability = the User has an Employee record (`User.employee !== null`).
- Gate every task on: `npx tsc --noEmit` clean, `npx biome check .` clean, `npx vitest run` green. Commit per task.
- Co-author every commit: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

## File Structure

- Modify `src/lib/line/rich-menu.ts` — add `MenuTarget`, `computeMenuTarget` (pure), `resolveCapabilities` (pure), `syncRichMenuForUser` (I/O). Keep existing `linkAdminRichMenu`/`unlinkAdminRichMenu` (still used by unpair).
- Create `src/lib/line/rich-menu.test.ts` — unit tests for the two pure functions.
- Create `scripts/setup-combined-rich-menu.ts` — one-off Combined menu creator (ops).
- Modify `src/lib/auth/link-line-to-admin.ts` — swap `linkAdminRichMenu` → `syncRichMenuForUser`.
- Modify `src/lib/auth/link-line-to-employee.ts` — apply menu after employee bind.
- Modify `src/lib/auth/merge-admin-into-employee.ts` — apply menu after merge.
- Modify `src/app/(admin)/admin/employees/actions.ts` — apply menu after `grantAdminAccess`.

---

### Task 1: Pure decision functions (`computeMenuTarget`, `resolveCapabilities`)

**Files:**
- Modify: `src/lib/line/rich-menu.ts`
- Test: `src/lib/line/rich-menu.test.ts`

**Interfaces:**
- Consumes: `computeTier`, `TierAssignment` from `src/lib/auth/user-tier.ts`.
- Produces:
  - `type MenuTarget = 'combined' | 'admin' | 'none'`
  - `computeMenuTarget(caps: { hasEmployee: boolean; hasAdmin: boolean }): MenuTarget`
  - `resolveCapabilities(user: { employee: { id: string } | null; roleAssignments: ReadonlyArray<TierAssignment> }): { hasEmployee: boolean; hasAdmin: boolean }`

- [ ] **Step 1: Write the failing test**

Create `src/lib/line/rich-menu.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { computeMenuTarget, resolveCapabilities } from './rich-menu';

describe('computeMenuTarget', () => {
  it('admin + employee → combined', () => {
    expect(computeMenuTarget({ hasAdmin: true, hasEmployee: true })).toBe('combined');
  });
  it('admin only → admin', () => {
    expect(computeMenuTarget({ hasAdmin: true, hasEmployee: false })).toBe('admin');
  });
  it('employee only → none (OA default menu shows)', () => {
    expect(computeMenuTarget({ hasAdmin: false, hasEmployee: true })).toBe('none');
  });
  it('neither → none', () => {
    expect(computeMenuTarget({ hasAdmin: false, hasEmployee: false })).toBe('none');
  });
});

describe('resolveCapabilities', () => {
  const admin = { role: { key: 'admin', isSuperadmin: false, archivedAt: null } };
  const staff = { role: { key: 'staff', isSuperadmin: false, archivedAt: null } };
  const superadmin = { role: { key: 'owner', isSuperadmin: true, archivedAt: null } };

  it('employee who is also admin → both', () => {
    expect(resolveCapabilities({ employee: { id: 'e1' }, roleAssignments: [admin] })).toEqual({
      hasEmployee: true,
      hasAdmin: true,
    });
  });
  it('pure admin (no employee record) → admin only', () => {
    expect(resolveCapabilities({ employee: null, roleAssignments: [admin] })).toEqual({
      hasEmployee: false,
      hasAdmin: true,
    });
  });
  it('employee with only staff role → employee only', () => {
    expect(resolveCapabilities({ employee: { id: 'e1' }, roleAssignments: [staff] })).toEqual({
      hasEmployee: true,
      hasAdmin: false,
    });
  });
  it('superadmin counts as admin', () => {
    expect(resolveCapabilities({ employee: null, roleAssignments: [superadmin] })).toEqual({
      hasEmployee: false,
      hasAdmin: true,
    });
  });
  it('archived admin role does not count', () => {
    const archived = { role: { key: 'admin', isSuperadmin: false, archivedAt: new Date() } };
    expect(resolveCapabilities({ employee: { id: 'e1' }, roleAssignments: [archived] })).toEqual({
      hasEmployee: true,
      hasAdmin: false,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/line/rich-menu.test.ts`
Expected: FAIL — `computeMenuTarget`/`resolveCapabilities` are not exported.

- [ ] **Step 3: Add the pure functions to `rich-menu.ts`**

At the top of `src/lib/line/rich-menu.ts`, add imports below the existing `getLineMessagingClient` import:

```ts
import { computeTier, type TierAssignment } from '@/lib/auth/user-tier';
```

Then append these exports to `src/lib/line/rich-menu.ts`:

```ts
export type MenuTarget = 'combined' | 'admin' | 'none';

/**
 * Pure policy: which rich menu should a user with these capabilities see?
 * Employee-only and "neither" both resolve to 'none' (unlink) — the OA
 * default menu is the employee menu, so we only per-user-link the two
 * override menus (admin, combined).
 */
export function computeMenuTarget(caps: { hasEmployee: boolean; hasAdmin: boolean }): MenuTarget {
  if (caps.hasAdmin && caps.hasEmployee) return 'combined';
  if (caps.hasAdmin) return 'admin';
  return 'none';
}

/** Pure: derive capability flags from a loaded user's relations. */
export function resolveCapabilities(user: {
  employee: { id: string } | null;
  roleAssignments: ReadonlyArray<TierAssignment>;
}): { hasEmployee: boolean; hasAdmin: boolean } {
  const tier = computeTier(user.roleAssignments);
  return {
    hasEmployee: user.employee !== null,
    hasAdmin: tier === 'Admin' || tier === 'Superadmin',
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/line/rich-menu.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/line/rich-menu.ts src/lib/line/rich-menu.test.ts
git commit -m "feat(line): capability→rich-menu decision functions

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: `syncRichMenuForUser` I/O wrapper

**Files:**
- Modify: `src/lib/line/rich-menu.ts`
- Test: `tests/integration/rich-menu-sync.integration.test.ts` (Create)

**Interfaces:**
- Consumes: `computeMenuTarget`, `resolveCapabilities` (Task 1); `prisma`; `getLineMessagingClient`.
- Produces: `syncRichMenuForUser(userId: string): Promise<void>` — loads the user's `lineUserId` + capabilities, links the correct override menu or unlinks. No-op when the user has no `lineUserId`. Never throws.

- [ ] **Step 1: Write the failing integration test**

Create `tests/integration/rich-menu-sync.integration.test.ts`:

```ts
import { Prisma } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const link = vi.fn();
const unlink = vi.fn();
vi.mock('@/lib/line/messaging-client', () => ({
  getLineMessagingClient: () => ({
    linkRichMenuIdToUser: link,
    unlinkRichMenuIdFromUser: unlink,
  }),
}));

import { prisma } from '@/lib/db/prisma';
import { syncRichMenuForUser } from '@/lib/line/rich-menu';

process.env.ADMIN_RICH_MENU_ID = 'rm-admin';
process.env.COMBINED_RICH_MENU_ID = 'rm-combined';

async function reset() {
  await prisma.userRoleAssignment.deleteMany({});
  await prisma.employee.deleteMany({});
  await prisma.user.deleteMany({});
  await prisma.roleDefinition.deleteMany({});
}
beforeEach(async () => {
  link.mockClear();
  unlink.mockClear();
  await reset();
});
afterAll(async () => {
  await prisma.$disconnect();
});

async function adminRole() {
  return prisma.roleDefinition.create({
    data: { key: 'admin', name: 'Admin', isSuperadmin: false, isSystem: true },
  });
}

describe('syncRichMenuForUser', () => {
  it('admin + employee → links the combined menu', async () => {
    const role = await adminRole();
    const user = await prisma.user.create({ data: { lineUserId: 'U-both' } });
    await prisma.employee.create({
      data: {
        userId: user.id,
        firstName: 'A',
        lastName: 'B',
        salaryType: 'Monthly',
        baseSalary: new Prisma.Decimal(1),
        status: 'Active',
        hiredAt: new Date('2026-01-01'),
      },
    });
    await prisma.userRoleAssignment.create({ data: { userId: user.id, roleId: role.id } });

    await syncRichMenuForUser(user.id);
    expect(link).toHaveBeenCalledWith('U-both', 'rm-combined');
  });

  it('pure admin → links the admin menu', async () => {
    const role = await adminRole();
    const user = await prisma.user.create({ data: { lineUserId: 'U-admin' } });
    await prisma.userRoleAssignment.create({ data: { userId: user.id, roleId: role.id } });

    await syncRichMenuForUser(user.id);
    expect(link).toHaveBeenCalledWith('U-admin', 'rm-admin');
  });

  it('employee only → unlinks (OA default shows)', async () => {
    const user = await prisma.user.create({ data: { lineUserId: 'U-emp' } });
    await prisma.employee.create({
      data: {
        userId: user.id,
        firstName: 'A',
        lastName: 'B',
        salaryType: 'Monthly',
        baseSalary: new Prisma.Decimal(1),
        status: 'Active',
        hiredAt: new Date('2026-01-01'),
      },
    });

    await syncRichMenuForUser(user.id);
    expect(unlink).toHaveBeenCalledWith('U-emp');
    expect(link).not.toHaveBeenCalled();
  });

  it('no lineUserId → no-op', async () => {
    const user = await prisma.user.create({ data: {} });
    await syncRichMenuForUser(user.id);
    expect(link).not.toHaveBeenCalled();
    expect(unlink).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/rich-menu-sync.integration.test.ts`
Expected: FAIL — `syncRichMenuForUser` is not exported.

- [ ] **Step 3: Implement `syncRichMenuForUser`**

Append to `src/lib/line/rich-menu.ts`:

```ts
import { prisma } from '@/lib/db/prisma';

/**
 * Best-effort: bring a user's per-user rich-menu link in line with their
 * current capabilities. No-op if the user has no LINE bound. Never throws —
 * a LINE failure must not break the pairing / merge / role-change that
 * triggered it.
 */
export async function syncRichMenuForUser(userId: string): Promise<void> {
  let user: {
    lineUserId: string | null;
    employee: { id: string } | null;
    roleAssignments: TierAssignment[];
  } | null;
  try {
    user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        lineUserId: true,
        employee: { select: { id: true } },
        roleAssignments: {
          select: { role: { select: { key: true, isSuperadmin: true, archivedAt: true } } },
        },
      },
    });
  } catch (err) {
    console.error('[rich-menu] sync load failed (non-fatal)', { userId, err: String(err) });
    return;
  }
  if (!user?.lineUserId) return;

  const lineUserId = user.lineUserId;
  const target = computeMenuTarget(resolveCapabilities(user));
  try {
    const client = getLineMessagingClient();
    if (target === 'none') {
      await client.unlinkRichMenuIdFromUser(lineUserId);
      return;
    }
    const richMenuId =
      target === 'combined' ? process.env.COMBINED_RICH_MENU_ID : process.env.ADMIN_RICH_MENU_ID;
    if (!richMenuId) {
      console.warn('[rich-menu] menu id env not set — skipping link', { target });
      return;
    }
    await client.linkRichMenuIdToUser(lineUserId, richMenuId);
  } catch (err) {
    console.error('[rich-menu] sync apply failed (non-fatal)', { userId, target, err: String(err) });
  }
}
```

Note: place the `import { prisma }` line with the other imports at the top of the file (Biome will reorder on `--write` if needed).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/integration/rich-menu-sync.integration.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Format, typecheck, commit**

```bash
npx biome check --write src/lib/line/rich-menu.ts tests/integration/rich-menu-sync.integration.test.ts
npx tsc --noEmit
git add src/lib/line/rich-menu.ts tests/integration/rich-menu-sync.integration.test.ts
git commit -m "feat(line): syncRichMenuForUser applies capability-driven menu

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Combined rich-menu setup script

**Files:**
- Create: `scripts/setup-combined-rich-menu.ts`

**Interfaces:**
- Consumes: `@line/bot-sdk` `messagingApi`; env `LINE_MESSAGING_CHANNEL_ACCESS_TOKEN`, `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_LIFF_ID`, optional `DATABASE_URL`.
- Produces: prints `COMBINED_RICH_MENU_ID=<id>` for the operator to set in the deploy env.

This is an ops script (run manually, no automated test). It mirrors `scripts/setup-admin-rich-menu.ts`. The **tap-area layout and the menu image are a design asset** — the `areas`/`dest` below are a working default (2 rows × 3 columns) the operator adjusts to match the final image and the dispatcher's known `?dest=` keys.

- [ ] **Step 1: Create the script**

Create `scripts/setup-combined-rich-menu.ts`:

```ts
/**
 * One-off: create the COMBINED (admin + employee) rich menu, upload its
 * image, print the id.
 * Usage: pnpm tsx scripts/setup-combined-rich-menu.ts ./assets/rich-menu/combined.png [old-richmenu-id]
 * Env: LINE_MESSAGING_CHANNEL_ACCESS_TOKEN + NEXT_PUBLIC_APP_URL + NEXT_PUBLIC_LIFF_ID.
 * Then set COMBINED_RICH_MENU_ID=<printed id> in the deploy env.
 *
 * Image: 2500x1686 px, JPEG/PNG <= 1MB. The areas below are a 2x3 default —
 * adjust bounds + dest values to match the designed image and the /liff/pair
 * dispatcher's dest keys.
 *
 * If [old-richmenu-id] is given, every COMBINED-eligible user (lineUserId +
 * admin role + Employee record) is re-linked to the new menu and the old menu
 * deleted (rotation — LINE rich menus are immutable).
 */
import { existsSync, readFileSync } from 'node:fs';
import { messagingApi } from '@line/bot-sdk';

const token = process.env.LINE_MESSAGING_CHANNEL_ACCESS_TOKEN;
const base = process.env.NEXT_PUBLIC_APP_URL;
const liffId = process.env.NEXT_PUBLIC_LIFF_ID;
if (!token || !base || !liffId)
  throw new Error('need LINE_MESSAGING_CHANNEL_ACCESS_TOKEN + NEXT_PUBLIC_APP_URL + NEXT_PUBLIC_LIFF_ID');

const imagePath = process.argv[2];
const oldRichMenuId = process.argv[3];
if (!imagePath) throw new Error('usage: tsx scripts/setup-combined-rich-menu.ts <image.png> [old-richmenu-id]');
if (!existsSync(imagePath)) throw new Error(`image file not found: ${imagePath}`);

const client = new messagingApi.MessagingApiClient({ channelAccessToken: token });
const blobClient = new messagingApi.MessagingApiBlobClient({ channelAccessToken: token });

const funnel = (state: string) =>
  `https://liff.line.me/${liffId}?liff.state=${encodeURIComponent(state)}`;

const W = 2500,
  H = 1686,
  COL = Math.floor(W / 3),
  ROW = Math.floor(H / 2);

const { richMenuId } = await client.createRichMenu({
  size: { width: W, height: H },
  selected: true,
  name: 'koolman-combined-v1',
  chatBarText: 'เมนูแอดมิน+พนักงาน',
  areas: [
    // Top row — employee functions
    { bounds: { x: 0, y: 0, width: COL, height: ROW }, action: { type: 'uri', uri: funnel('?dest=check-in') } },
    { bounds: { x: COL, y: 0, width: COL, height: ROW }, action: { type: 'uri', uri: funnel('?dest=leave') } },
    { bounds: { x: COL * 2, y: 0, width: W - COL * 2, height: ROW }, action: { type: 'uri', uri: `${base}/liff/home` } },
    // Bottom row — admin functions
    { bounds: { x: 0, y: ROW, width: COL, height: H - ROW }, action: { type: 'uri', uri: funnel('?dest=admin-inbox') } },
    { bounds: { x: COL, y: ROW, width: COL, height: H - ROW }, action: { type: 'uri', uri: funnel('?dest=admin-advance-slip') } },
    { bounds: { x: COL * 2, y: ROW, width: W - COL * 2, height: H - ROW }, action: { type: 'uri', uri: `${base}/admin` } },
  ],
});

const buf = readFileSync(imagePath);
await blobClient.setRichMenuImage(
  richMenuId,
  new Blob([buf], { type: imagePath.endsWith('.png') ? 'image/png' : 'image/jpeg' }),
);
console.log('COMBINED_RICH_MENU_ID=', richMenuId);

// ── Optional rotation ──────────────────────────────────────────────────
if (oldRichMenuId) {
  if (process.env.DATABASE_URL) {
    const { PrismaClient } = await import('@prisma/client');
    const prisma = new PrismaClient();
    // Combined-eligible: paired (lineUserId) AND admin-tier AND has Employee.
    const rows = await prisma.$queryRaw<{ lineUserId: string }[]>`
      SELECT u."lineUserId" FROM "User" u
      WHERE u."lineUserId" IS NOT NULL AND u."archivedAt" IS NULL
        AND EXISTS (SELECT 1 FROM "Employee" e WHERE e."userId" = u.id)
        AND EXISTS (
          SELECT 1 FROM "UserRoleAssignment" a
          JOIN "RoleDefinition" r ON r.id = a."roleId"
          WHERE a."userId" = u.id AND r."archivedAt" IS NULL
            AND (r."isSuperadmin" = true OR r.key = 'admin'))`;
    await prisma.$disconnect();
    for (const { lineUserId } of rows) {
      await client.linkRichMenuIdToUser(lineUserId, richMenuId);
      console.log('relinked', lineUserId);
    }
  } else {
    console.warn('DATABASE_URL not set — skipped relinking combined-eligible users');
  }
  await client.deleteRichMenu(oldRichMenuId);
  console.log('deleted old menu', oldRichMenuId);
}
```

- [ ] **Step 2: Typecheck + lint the script**

Run: `npx tsc --noEmit && npx biome check --write scripts/setup-combined-rich-menu.ts`
Expected: clean (script is not imported by app code; it only needs to compile).

- [ ] **Step 3: Commit**

```bash
git add scripts/setup-combined-rich-menu.ts
git commit -m "chore(line): setup script for the combined admin+employee rich menu

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Wire `syncRichMenuForUser` into all capability/binding sites

**Files:**
- Modify: `src/lib/auth/link-line-to-admin.ts`
- Modify: `src/lib/auth/link-line-to-employee.ts`
- Modify: `src/lib/auth/merge-admin-into-employee.ts`
- Modify: `src/app/(admin)/admin/employees/actions.ts`

**Interfaces:**
- Consumes: `syncRichMenuForUser` (Task 2).

- [ ] **Step 1: Admin bind — swap to the resolver**

In `src/lib/auth/link-line-to-admin.ts`, change the import (line ~25) from:

```ts
import { linkAdminRichMenu } from '@/lib/line/rich-menu';
```

to:

```ts
import { syncRichMenuForUser } from '@/lib/line/rich-menu';
```

Then replace the post-commit block (around line 165-173) from:

```ts
    // Best-effort rich menu link after commit — never fails the pairing.
    try {
      await linkAdminRichMenu(lineUserId);
    } catch (richErr) {
      console.error('[link-line-to-admin] rich menu link failed (non-fatal)', {
        lineUserId,
        error: String(richErr),
      });
    }
```

with:

```ts
    // Best-effort: apply the capability-driven menu (admin, or combined if
    // this admin is also an employee). syncRichMenuForUser never throws.
    await syncRichMenuForUser(userId);
```

- [ ] **Step 2: Employee bind — apply menu after the bind**

In `src/lib/auth/link-line-to-employee.ts`:

(a) Add the import alongside the other imports:

```ts
import { syncRichMenuForUser } from '@/lib/line/rich-menu';
```

(b) In the transaction's success return (the `return { kind: 'ok' as const, employee: {...} }` block), add `userId`:

```ts
      return {
        kind: 'ok' as const,
        userId: updatedUser.id,
        employee: { id: emp.id, firstName: emp.firstName, lastName: emp.lastName },
      };
```

(c) After the transaction, in the `if (result.kind === 'ok')` branch, apply the menu before returning:

```ts
    if (result.kind === 'ok') {
      // Best-effort: employee-only → OA default (unlink); employee who is
      // also an admin → combined. Never throws.
      await syncRichMenuForUser(result.userId);
      return { ok: true, employee: result.employee };
    }
```

- [ ] **Step 3: Merge — apply menu to the surviving (employee) user**

In `src/lib/auth/merge-admin-into-employee.ts`:

(a) Add the import:

```ts
import { syncRichMenuForUser } from '@/lib/line/rich-menu';
```

(b) After the `await prisma.$transaction(...)` block closes (just before `return { ok: true }`), add:

```ts
  // The surviving employee user now also holds the admin role → combined menu.
  // Best-effort; never throws.
  await syncRichMenuForUser(employeeUserId);
```

- [ ] **Step 4: Grant admin — apply menu after the role is added**

In `src/app/(admin)/admin/employees/actions.ts`:

(a) Add the import alongside the others (verify `prisma` is already imported — it is, used elsewhere in this file):

```ts
import { syncRichMenuForUser } from '@/lib/line/rich-menu';
```

(b) In `grantAdminAccess`, immediately after `await assignAdminRole(employeeId);` (line ~622), add:

```ts
  // The employee just gained admin → combined menu (if LINE-bound). Best-effort.
  const linked = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { userId: true },
  });
  if (linked) await syncRichMenuForUser(linked.userId);
```

- [ ] **Step 5: Typecheck, lint, full test suite**

Run:
```bash
npx tsc --noEmit
npx biome check --write src/lib/auth/link-line-to-admin.ts src/lib/auth/link-line-to-employee.ts src/lib/auth/merge-admin-into-employee.ts "src/app/(admin)/admin/employees/actions.ts"
npx vitest run
```
Expected: tsc clean, biome clean, all tests green (existing + the new rich-menu tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/auth/link-line-to-admin.ts src/lib/auth/link-line-to-employee.ts src/lib/auth/merge-admin-into-employee.ts "src/app/(admin)/admin/employees/actions.ts"
git commit -m "feat(line): apply capability rich menu on bind, merge, grant-admin

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Out of scope (later phases / ops)

- **Phase 2** — bidirectional account-sync (employee-initiated merge; web-session redeem; confirm-both-identities screen).
- **Phase 3** — binding collision becomes a doorway to sync; entry-point/nudge cleanup.
- **Revoke-admin / archive-employee menu refresh** — also capability changes; fold into a follow-up once Phase 2's surfaces land (low urgency: those paths are rarer and the menu self-corrects on next bind/merge). If desired now, add `syncRichMenuForUser(userId)` after `unlinkLineFromEmployee` is NOT needed (that nulls lineUserId), but after a revoke-admin role removal it is.
- **Ops:** design the combined menu image, run `setup-combined-rich-menu.ts`, set `COMBINED_RICH_MENU_ID` in Vercel.

## Self-review notes

- Spec coverage: this plan implements the "Capability-driven rich menu" section + the "merged person loses employee buttons" fix. Bidirectional sync and collision-doorway are explicitly deferred to Phases 2–3 (separate plans).
- The three menu types are delivered: combined (linked), admin (linked), employee (unlink → OA default).
- `syncRichMenuForUser` is the single name used across all four call sites (Task 4) and matches its definition (Task 2).
