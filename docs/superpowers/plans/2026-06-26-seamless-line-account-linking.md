# Seamless LINE Account Linking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make admin/employee LINE linking work in any order by making the merge wizard explicitly-targeted (admin picks the employee) and relocating the LINE binding onto the employee row, eliminating the self-paired-admin dead-end.

**Architecture:** The merge token carries both `adminUserId` and `employeeUserId` (signed JWT), so the employee is *stated*, not inferred from the LINE session. The merge mutation gains one rule — the scanning LINE always ends up on the employee row (bound if fresh, relocated if it was on the admin row, refused if it belongs to a stranger). Everything stays non-destructive: the admin row keeps its email login and roles.

**Tech Stack:** Next.js (App Router, Server Actions), Prisma, Supabase auth (`custom:line` OIDC), `jose` JWT, Vitest (unit + integration), next-intl (6 locales).

## Global Constraints

- **Non-destructive:** the merge NEVER archives the admin row, NEVER clears the admin's `email` / `authUserId`, and NEVER removes role assignments from the admin row. Roles are **copied** onto the employee, never moved.
- **The invariant:** whenever a human is/becomes an employee, `User.lineUserId` lives on the **employee row**. The merge enforces this.
- **Lightweight two-row model:** no single-row consolidation, no repointing of `authUserId`/attribution. The only identity column the merge may move is `lineUserId`.
- **No step-up re-auth:** a logged-in admin web session is sufficient to start a merge.
- **Token:** HS256, scope `admin-merge`, 1-hour TTL, carries `sub`=adminUserId and `emp`=employeeUserId. No new DB column (the signed token is the source of truth).
- **Audit:** every successful merge writes a `user.account-merge` audit row, now including the LINE action taken.
- **Server-action error messages are inline Thai strings** (existing convention in these files); only NEW user-facing UI strings go through `messages/*.json` across all 6 locales: `th, en, my, lo, zh-CN, km`.
- **Feature flag:** `ADMIN_LINE_LINK_ENABLED` (`src/lib/auth/admin-line-feature.ts`) is currently `false`; it gates the runtime flow. Tests that exercise `resolveMergeParties`/`linkMergeAccounts` mock it to `true`. Re-enabling the flag in prod is OUT OF SCOPE for this plan.

---

### Task 1: Targeted merge token + employee picker (initiation side)

**Files:**
- Modify: `src/lib/pairing/token.ts:166-208` (mintMergeToken, verifyMergeToken)
- Modify: `src/lib/pairing/merge-token.test.ts` (round-trip test)
- Modify: `src/lib/auth/start-admin-merge.ts` (accept `employeeUserId`; add `listMergeableEmployees`)
- Modify: `src/app/(admin)/admin/_components/merge-prompt-card.tsx` (picker step)
- Modify: `messages/th.json`, `messages/en.json`, `messages/my.json`, `messages/lo.json`, `messages/zh-CN.json`, `messages/km.json` (new `mergeWizard` keys)

**Interfaces:**
- Produces: `mintMergeToken(adminUserId: string, employeeUserId: string): Promise<{ token: string; expiresAt: Date }>`
- Produces: `verifyMergeToken(token: string): Promise<{ adminUserId: string; employeeUserId: string }>`
- Produces: `startAdminMerge(input: { employeeUserId: string }): Promise<{ ok: true; url: string; qrDataUrl: string; expiresAt: Date } | { ok: false; message: string }>`
- Produces: `listMergeableEmployees(): Promise<{ userId: string; name: string }[]>`

- [ ] **Step 1: Update the merge-token round-trip test to expect both ids**

Replace the body of `src/lib/pairing/merge-token.test.ts` with:

```ts
import { describe, expect, it } from 'vitest';
import { mintMergeToken, verifyMergeToken } from './token';

describe('merge token', () => {
  it('round-trips the admin and employee user ids', async () => {
    const { token, expiresAt } = await mintMergeToken('admin-123', 'emp-456');
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
    const { adminUserId, employeeUserId } = await verifyMergeToken(token);
    expect(adminUserId).toBe('admin-123');
    expect(employeeUserId).toBe('emp-456');
  });

  it('rejects an admin-pair-scoped token', async () => {
    const { mintAdminPairingToken } = await import('./token');
    const { token } = await mintAdminPairingToken('admin-123');
    await expect(verifyMergeToken(token)).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/pairing/merge-token.test.ts`
Expected: FAIL — `mintMergeToken` rejects a 2nd argument / `employeeUserId` is `undefined`.

- [ ] **Step 3: Make the token carry `employeeUserId`**

In `src/lib/pairing/token.ts`, replace `mintMergeToken` (lines 170-187) and `verifyMergeToken` (lines 193-208) with:

```ts
export async function mintMergeToken(
  adminUserId: string,
  employeeUserId: string,
): Promise<{
  token: string;
  expiresAt: Date;
}> {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + MERGE_TTL_SECONDS;

  const token = await new SignJWT({ scope: MERGE_SCOPE, emp: employeeUserId })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setSubject(adminUserId)
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .sign(getSecret());

  return { token, expiresAt: new Date(exp * 1000) };
}

export async function verifyMergeToken(
  token: string,
): Promise<{ adminUserId: string; employeeUserId: string }> {
  const { payload } = await jwtVerify(token, getSecret(), {
    issuer: ISSUER,
    audience: AUDIENCE,
    algorithms: ['HS256'],
  });

  if (payload.scope !== MERGE_SCOPE) {
    throw new Error('Wrong token scope');
  }
  if (typeof payload.sub !== 'string') {
    throw new Error('Missing sub claim');
  }
  if (typeof payload.emp !== 'string') {
    throw new Error('Missing emp claim');
  }

  return { adminUserId: payload.sub, employeeUserId: payload.emp };
}
```

- [ ] **Step 4: Run the token test to verify it passes**

Run: `npx vitest run src/lib/pairing/merge-token.test.ts`
Expected: PASS (2/2).

- [ ] **Step 5: Thread `employeeUserId` through `startAdminMerge` and add `listMergeableEmployees`**

In `src/lib/auth/start-admin-merge.ts`, replace the `startAdminMerge` signature/body (lines 19-60) so it accepts the picked employee, validates it, and mints with both ids. Add `listMergeableEmployees` below it. Keep `dismissMergePrompt` unchanged.

```ts
export async function startAdminMerge(input: { employeeUserId: string }): Promise<
  { ok: true; url: string; qrDataUrl: string; expiresAt: Date } | { ok: false; message: string }
> {
  const { user } = await requireRole(['Admin']);
  if (!ADMIN_LINE_LINK_ENABLED) {
    return { ok: false, message: 'ฟีเจอร์เชื่อมบัญชีถูกปิดใช้งานชั่วคราว' };
  }

  // requireRole returns a stripped User; re-fetch the employee relation to
  // guarantee we are dealing with a pure admin (no Employee row).
  const fresh = await prisma.user.findUnique({
    where: { id: user.id },
    select: { employee: { select: { id: true } } },
  });
  if (fresh?.employee) {
    return { ok: false, message: 'บัญชีนี้เป็นพนักงานอยู่แล้ว ไม่จำเป็นต้องเชื่อมบัญชี' };
  }

  // The admin explicitly picks WHICH employee they are. Validate it exists and
  // actually has an Employee record before minting the targeted token.
  const target = await prisma.user.findUnique({
    where: { id: input.employeeUserId },
    select: { employee: { select: { id: true } } },
  });
  if (!target?.employee) {
    return { ok: false, message: 'ไม่พบบัญชีพนักงานที่เลือก' };
  }

  const { token, expiresAt } = await mintMergeToken(user.id, input.employeeUserId);

  await prisma.user.update({
    where: { id: user.id },
    data: { mergeToken: token, mergeTokenExpiresAt: expiresAt },
  });

  // Merge MUST run inside the LIFF browser (needs LINE ID token), so we use
  // liff.line.me + liff.state — same pattern as createMyLinePairingLink.
  // The /liff/merge endpoint unwraps ?merge= client-side after liff.init().
  const liffId = process.env.NEXT_PUBLIC_LIFF_ID;
  const url = liffId
    ? `https://liff.line.me/${liffId}?liff.state=${encodeURIComponent(`?merge=${token}`)}`
    : `${appBaseUrl()}/liff/merge/${token}`; // dev fallback when LIFF id unset

  // QR for the desktop-admin case: scan with phone's LINE scanner.
  const qrDataUrl = await QRCode.toDataURL(url, {
    width: 256,
    margin: 2,
    errorCorrectionLevel: 'M',
  });

  return { ok: true, url, qrDataUrl, expiresAt };
}

/**
 * Active employees an admin can target when linking their own account. Returns
 * the employee's USER id (the merge operates on User rows) + a display name.
 */
export async function listMergeableEmployees(): Promise<{ userId: string; name: string }[]> {
  await requireRole(['Admin']);
  const employees = await prisma.employee.findMany({
    where: { status: 'Active' },
    orderBy: [{ firstName: 'asc' }],
    select: { userId: true, firstName: true, lastName: true, nickname: true },
  });
  return employees.map((e) => ({
    userId: e.userId,
    name: e.nickname?.trim() || `${e.firstName} ${e.lastName}`.trim(),
  }));
}
```

- [ ] **Step 6: Add the picker step to `MergePromptCard`**

In `src/app/(admin)/admin/_components/merge-prompt-card.tsx`, replace the import of the actions (line 23) and the `State`/handlers/JSX so a click first loads the employee list, the admin selects one, then "Generate QR" mints the targeted token.

Replace line 23:

```ts
import {
  dismissMergePrompt,
  listMergeableEmployees,
  startAdminMerge,
} from '@/lib/auth/start-admin-merge';
```

Replace the `State` type + state + handlers (lines 32-60) with:

```ts
  type State =
    | { phase: 'idle' }
    | { phase: 'picker'; employees: { userId: string; name: string }[]; selected: string }
    | { phase: 'qr'; url: string; qrDataUrl: string }
    | { phase: 'dismissed' }
    | { phase: 'error'; message: string };

  const [state, setState] = useState<State>({ phase: 'idle' });
  const [isPendingLink, startLinkTransition] = useTransition();
  const [isPendingDismiss, startDismissTransition] = useTransition();

  if (state.phase === 'dismissed') return null;

  function openPicker() {
    startLinkTransition(async () => {
      const employees = await listMergeableEmployees();
      setState({ phase: 'picker', employees, selected: employees[0]?.userId ?? '' });
    });
  }

  function generateQr(employeeUserId: string) {
    startLinkTransition(async () => {
      const result = await startAdminMerge({ employeeUserId });
      if (result.ok) {
        setState({ phase: 'qr', url: result.url, qrDataUrl: result.qrDataUrl });
      } else {
        setState({ phase: 'error', message: result.message });
      }
    });
  }

  function handleDismiss() {
    startDismissTransition(async () => {
      await dismissMergePrompt();
      setState({ phase: 'dismissed' });
    });
  }
```

Replace the `error`/`qr` JSX block inside `min-w-0 flex-1` (lines 69-86) and the button block (lines 88-98) so the picker renders. The inner `<div className="min-w-0 flex-1">` content becomes:

```tsx
          <p className="text-sm font-semibold text-primary-900">{t('cardTitle')}</p>
          <p className="mt-0.5 text-sm text-primary-700">{t('cardBody')}</p>

          {state.phase === 'error' && (
            <p className="mt-2 text-sm font-medium text-red-600">{state.message}</p>
          )}

          {state.phase === 'picker' && (
            <div className="mt-3 space-y-2">
              {state.employees.length === 0 ? (
                <p className="text-sm text-primary-700">{t('pickerEmpty')}</p>
              ) : (
                <>
                  <label className="block text-xs text-primary-600" htmlFor="merge-employee">
                    {t('pickerLabel')}
                  </label>
                  <select
                    id="merge-employee"
                    value={state.selected}
                    onChange={(e) => setState({ ...state, selected: e.target.value })}
                    className="w-full rounded-md border border-primary-200 bg-white px-3 py-2 text-sm"
                  >
                    {state.employees.map((emp) => (
                      <option key={emp.userId} value={emp.userId}>
                        {emp.name}
                      </option>
                    ))}
                  </select>
                </>
              )}
            </div>
          )}

          {state.phase === 'qr' && (
            <div className="mt-3 space-y-2">
              <p className="text-xs text-primary-600">{t('scanHint')}</p>
              <img
                src={state.qrDataUrl}
                alt="QR code"
                width={160}
                height={160}
                className="rounded-lg border border-primary-200"
              />
              <p className="break-all text-xs text-ink-3">{state.url}</p>
            </div>
          )}
```

The button column (the `<div className="flex shrink-0 items-center gap-2">` block) becomes:

```tsx
        <div className="flex shrink-0 items-center gap-2">
          {state.phase === 'idle' && (
            <Button
              variant="primary"
              size="sm"
              onClick={openPicker}
              disabled={isPendingLink || isPendingDismiss}
            >
              {isPendingLink ? t('working') : t('cardCta')}
            </Button>
          )}
          {state.phase === 'picker' && state.employees.length > 0 && (
            <Button
              variant="primary"
              size="sm"
              onClick={() => generateQr(state.selected)}
              disabled={isPendingLink || !state.selected}
            >
              {isPendingLink ? t('working') : t('pickerCta')}
            </Button>
          )}
          {dismissible && state.phase !== 'qr' && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleDismiss}
              disabled={isPendingDismiss || isPendingLink}
            >
              {t('dismiss')}
            </Button>
          )}
        </div>
```

- [ ] **Step 7: Add the new `mergeWizard` strings to all 6 locales**

In each of `messages/th.json`, `messages/en.json`, `messages/my.json`, `messages/lo.json`, `messages/zh-CN.json`, `messages/km.json`, add four keys inside the existing `"mergeWizard"` object. Use these values (translate the non-Thai/English ones to match the locale's existing tone; English shown for `en`):

`th.json`:
```json
    "pickerLabel": "เลือกพนักงานที่เป็นตัวคุณ",
    "pickerCta": "สร้าง QR",
    "pickerEmpty": "ไม่พบพนักงานที่ใช้งานอยู่",
    "pickerPlaceholder": "— เลือกพนักงาน —"
```

`en.json`:
```json
    "pickerLabel": "Select the employee that is you",
    "pickerCta": "Generate QR",
    "pickerEmpty": "No active employees found",
    "pickerPlaceholder": "— Select an employee —"
```

(For `my`, `lo`, `zh-CN`, `km`: add the same four keys with locale-appropriate translations.)

- [ ] **Step 8: Typecheck, lint, and run the unit test**

Run: `npx tsc --noEmit && npx biome check src/lib/pairing/token.ts src/lib/auth/start-admin-merge.ts "src/app/(admin)/admin/_components/merge-prompt-card.tsx" && npx vitest run src/lib/pairing/merge-token.test.ts`
Expected: tsc clean, biome clean, token test 2/2 PASS.
Manual check (note for reviewer — not automated): the picker renders an employee dropdown after clicking the card CTA, and "Generate QR" produces a QR.

- [ ] **Step 9: Commit**

```bash
git add src/lib/pairing/token.ts src/lib/pairing/merge-token.test.ts src/lib/auth/start-admin-merge.ts "src/app/(admin)/admin/_components/merge-prompt-card.tsx" messages/
git commit -m "feat(line): targeted merge token + employee picker (initiation side)"
```

---

### Task 2: Relocation rule in `mergeAdminIntoEmployee`

**Files:**
- Modify: `src/lib/auth/merge-admin-into-employee.ts` (add `lineUserId` param + relocation)
- Modify: `src/lib/auth/link-merge-accounts.ts:104-114` (pass `lineUserId` through; minimal — see Step 5)
- Modify: `tests/integration/merge-admin-into-employee.integration.test.ts` (update calls + add relocation tests)

**Interfaces:**
- Consumes: nothing new.
- Produces: `mergeAdminIntoEmployee(input: { adminUserId: string; employeeUserId: string; lineUserId: string }): Promise<{ ok: true } | { ok: false; code: 'same-user' | 'admin-not-pure' | 'employee-no-record' | 'not-found' | 'line-conflict' }>`

- [ ] **Step 1: Write failing relocation tests**

Append these tests to `tests/integration/merge-admin-into-employee.integration.test.ts` (inside the top-level file, after the existing `describe`). Add small explicit seed helpers so each scenario is self-contained:

```ts
async function seedSelfPaired(opts: { adminLine: string | null; empLine: string | null }) {
  const adminRole = await prisma.roleDefinition.findUniqueOrThrow({ where: { key: 'admin' } });
  const staffRole = await prisma.roleDefinition.findUniqueOrThrow({ where: { key: 'staff' } });
  const branch = await prisma.branch.create({ data: { name: 'B2' } });
  const ua = await prisma.user.create({
    data: { email: 'boss2@x.co', authUserId: crypto.randomUUID(), lineUserId: opts.adminLine },
  });
  await prisma.userRoleAssignment.create({
    data: { userId: ua.id, roleId: adminRole.id, branchId: null },
  });
  const ue = await prisma.user.create({
    data: { authUserId: crypto.randomUUID(), lineUserId: opts.empLine },
  });
  await prisma.userRoleAssignment.create({
    data: { userId: ue.id, roleId: staffRole.id, branchId: null },
  });
  await prisma.employee.create({
    data: {
      userId: ue.id,
      firstName: 'C',
      lastName: 'D',
      branchId: branch.id,
      salaryType: 'Monthly',
      baseSalary: 20000,
      status: 'Active',
      hiredAt: new Date('2026-01-01'),
    },
  });
  return { ua, ue };
}

describe('mergeAdminIntoEmployee — LINE relocation', () => {
  it('relocates the LINE from a self-paired admin onto the employee row', async () => {
    const { ua, ue } = await seedSelfPaired({ adminLine: 'L', empLine: null });
    const res = await mergeAdminIntoEmployee({
      adminUserId: ua.id,
      employeeUserId: ue.id,
      lineUserId: 'L',
    });
    expect(res.ok).toBe(true);
    const uaAfter = await prisma.user.findUniqueOrThrow({ where: { id: ua.id } });
    const ueAfter = await prisma.user.findUniqueOrThrow({ where: { id: ue.id } });
    expect(ueAfter.lineUserId).toBe('L'); // LINE now on the employee row
    expect(uaAfter.lineUserId).toBeNull(); // removed from the admin row
    expect(uaAfter.email).toBe('boss2@x.co'); // email login preserved
    expect(uaAfter.archivedAt).toBeNull();
  });

  it('binds a fresh LINE to the employee row', async () => {
    const { ua, ue } = await seedSelfPaired({ adminLine: null, empLine: null });
    const res = await mergeAdminIntoEmployee({
      adminUserId: ua.id,
      employeeUserId: ue.id,
      lineUserId: 'L-fresh',
    });
    expect(res.ok).toBe(true);
    const ueAfter = await prisma.user.findUniqueOrThrow({ where: { id: ue.id } });
    expect(ueAfter.lineUserId).toBe('L-fresh');
  });

  it('refuses when the scanning LINE belongs to a third party', async () => {
    const { ua, ue } = await seedSelfPaired({ adminLine: null, empLine: null });
    await prisma.user.create({ data: { lineUserId: 'L-stranger' } });
    const res = await mergeAdminIntoEmployee({
      adminUserId: ua.id,
      employeeUserId: ue.id,
      lineUserId: 'L-stranger',
    });
    expect(res).toEqual({ ok: false, code: 'line-conflict' });
    const ueAfter = await prisma.user.findUniqueOrThrow({ where: { id: ue.id } });
    expect(ueAfter.lineUserId).toBeNull(); // no mutation
    const ueRoles = await prisma.userRoleAssignment.findMany({ where: { userId: ue.id } });
    expect(ueRoles.map((r) => r.roleId).length).toBe(1); // still only staff
  });

  it('leaves the LINE alone when the employee already holds it', async () => {
    const { ua, ue } = await seedSelfPaired({ adminLine: null, empLine: 'L-emp' });
    const res = await mergeAdminIntoEmployee({
      adminUserId: ua.id,
      employeeUserId: ue.id,
      lineUserId: 'L-emp',
    });
    expect(res.ok).toBe(true);
    const ueAfter = await prisma.user.findUniqueOrThrow({ where: { id: ue.id } });
    expect(ueAfter.lineUserId).toBe('L-emp');
  });
});
```

Also update the THREE existing `mergeAdminIntoEmployee(...)` calls in this file (lines 87, 121, 129) to pass a `lineUserId`:
- line 87 (`seedPair` → `ue` has `lineUserId: 'line-emp'`): `mergeAdminIntoEmployee({ adminUserId: ua.id, employeeUserId: ue.id, lineUserId: 'line-emp' })`
- line 121: same — `lineUserId: 'line-emp'`
- line 129 (lonely user, returns before relocation): `mergeAdminIntoEmployee({ adminUserId: ua.id, employeeUserId: lonely.id, lineUserId: 'line-x' })`

- [ ] **Step 2: Run to verify the new tests fail**

Run: `npx vitest run --config vitest.integration.config.ts tests/integration/merge-admin-into-employee.integration.test.ts`
Expected: FAIL — `lineUserId` arg unknown / relocation not implemented / `line-conflict` not returned.

- [ ] **Step 3: Implement the relocation rule**

In `src/lib/auth/merge-admin-into-employee.ts`, (a) add `'line-conflict'` to the `Result` error union (line 6), (b) add `lineUserId` to the input (lines 24-27), and (c) compute the LINE owner before the transaction and apply the relocation inside it. Replace the file body from the type alias through the end with:

```ts
type Result =
  | { ok: true }
  | {
      ok: false;
      code: 'same-user' | 'admin-not-pure' | 'employee-no-record' | 'not-found' | 'line-conflict';
    };
```

Change the input + add the owner lookup + relocation. The function becomes:

```ts
export async function mergeAdminIntoEmployee(input: {
  adminUserId: string;
  employeeUserId: string;
  lineUserId: string;
}): Promise<Result> {
  const { adminUserId, employeeUserId, lineUserId } = input;
  if (adminUserId === employeeUserId) return { ok: false, code: 'same-user' };

  const [admin, employeeUser, lineOwner] = await Promise.all([
    prisma.user.findUnique({
      where: { id: adminUserId },
      include: { employee: { select: { id: true } }, roleAssignments: { include: { role: true } } },
    }),
    prisma.user.findUnique({
      where: { id: employeeUserId },
      include: { employee: { select: { id: true } } },
    }),
    prisma.user.findUnique({ where: { lineUserId }, select: { id: true } }),
  ]);
  if (!admin || !employeeUser) return { ok: false, code: 'not-found' };
  if (admin.employee !== null) return { ok: false, code: 'admin-not-pure' };
  if (employeeUser.employee === null) return { ok: false, code: 'employee-no-record' };

  // The scanning LINE must be unbound, or belong to the admin or the employee of
  // this pair. Bound to anyone else → a different human; refuse, mutate nothing.
  if (lineOwner && lineOwner.id !== adminUserId && lineOwner.id !== employeeUserId) {
    return { ok: false, code: 'line-conflict' };
  }

  // Only copy admin/superadmin roles — custom or staff roles on the admin
  // user are intentionally not carried over to the employee account.
  const adminRoles = admin.roleAssignments.filter(
    (a) => a.role.key === 'admin' || a.role.isSuperadmin,
  );

  await prisma.$transaction(async (tx) => {
    // 1. Copy admin role assignments onto the employee user (dedupe; NULL
    //    branch can't use compound-unique upsert — guard with findFirst).
    const granted: string[] = [];
    for (const a of adminRoles) {
      const exists = await tx.userRoleAssignment.findFirst({
        where: { userId: employeeUserId, roleId: a.roleId, branchId: a.branchId },
      });
      if (!exists) {
        await tx.userRoleAssignment.create({
          data: { userId: employeeUserId, roleId: a.roleId, branchId: a.branchId },
        });
        granted.push(a.role.key);
      }
    }

    // 2. Enforce the invariant: the LINE binding lives on the employee row.
    //    Skip if the employee already holds its own LINE. We move at most one
    //    `lineUserId` column — never touch email/authUserId (non-destructive).
    let lineAction: 'none' | 'bound' | 'relocated' = 'none';
    if (employeeUser.lineUserId === null) {
      if (lineOwner?.id === adminUserId) {
        // Self-paired admin: clear the admin's LINE first (unique), then set it
        // on the employee row.
        await tx.user.update({ where: { id: adminUserId }, data: { lineUserId: null } });
        await tx.user.update({ where: { id: employeeUserId }, data: { lineUserId } });
        lineAction = 'relocated';
      } else if (lineOwner === null) {
        // Fresh LINE: bind it to the employee row.
        await tx.user.update({ where: { id: employeeUserId }, data: { lineUserId } });
        lineAction = 'bound';
      }
    }

    // 3. Consume the single-use merge token on the admin row. We deliberately do
    //    NOT archive the admin, clear its email/authUserId, or re-point
    //    attribution — the admin account stays fully usable.
    await tx.user.update({
      where: { id: adminUserId },
      data: { mergeToken: null, mergeTokenExpiresAt: null },
    });

    // 4. Audit the privilege grant + any LINE move (the security-sensitive bits).
    await auditLogTx(tx, {
      actorId: adminUserId,
      action: 'user.account-merge',
      entityType: 'User',
      entityId: employeeUserId,
      after: { grantedRoles: granted, fromAdminUserId: adminUserId, lineAction, lineUserId },
      metadata: { adminUserId, employeeUserId },
    });
  });

  return { ok: true };
}
```

Keep the existing docstring at the top of the file; update its numbered list to mention the LINE relocation (step 2 above) so the comment matches the code.

- [ ] **Step 4: Run the relocation tests to verify they pass**

Run: `npx vitest run --config vitest.integration.config.ts tests/integration/merge-admin-into-employee.integration.test.ts`
Expected: PASS — original 3 tests + 4 new relocation tests = 7/7.

- [ ] **Step 5: Keep `link-merge-accounts.ts` compiling by passing `lineUserId`**

This is a minimal stopgap so the project typechecks; Task 3 rewrites the resolver fully. In `src/lib/auth/link-merge-accounts.ts`:
- Add `lineUserId: string;` to the `Parties` type (after `employeeName`).
- In `resolveMergeParties`, change the returned `parties` object (lines 74-79) to also include `lineUserId: lineSub` (the variable already computed at line 35).
- In `linkMergeAccounts` (lines 108-111), pass it through:

```ts
  const res = await mergeAdminIntoEmployee({
    adminUserId: resolved.parties.adminUserId,
    employeeUserId: resolved.parties.employeeUserId,
    lineUserId: resolved.parties.lineUserId,
  });
```

- [ ] **Step 6: Typecheck + lint**

Run: `npx tsc --noEmit && npx biome check src/lib/auth/merge-admin-into-employee.ts src/lib/auth/link-merge-accounts.ts`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/lib/auth/merge-admin-into-employee.ts src/lib/auth/link-merge-accounts.ts tests/integration/merge-admin-into-employee.integration.test.ts
git commit -m "feat(line): relocate LINE onto employee row during merge (any link order)"
```

---

### Task 3: Explicit-pairing party resolution + consent

**Files:**
- Modify: `src/lib/auth/link-merge-accounts.ts` (rewrite `resolveMergeParties`)
- Create: `tests/integration/link-merge-accounts.integration.test.ts`

**Interfaces:**
- Consumes: `verifyMergeToken → { adminUserId, employeeUserId }` (Task 1); `mergeAdminIntoEmployee({ adminUserId, employeeUserId, lineUserId })` (Task 2).
- Produces: `previewMergeAccounts(input: { mergeToken: string })` and `linkMergeAccounts(input: { mergeToken: string })` — signatures UNCHANGED; behavior now token-targeted with one-side consent.

- [ ] **Step 1: Write the failing party-resolution / consent test**

Create `tests/integration/link-merge-accounts.integration.test.ts`:

```ts
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Mocked LINE session the supabase server client returns. Mutate `fakeLineSub`
// per test to simulate which LINE account is scanning.
let fakeLineSub: string | null = null;
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({
        data: {
          user: fakeLineSub
            ? { id: `auth-${fakeLineSub}`, identities: [{ provider: 'custom:line', id: fakeLineSub }] }
            : null,
        },
      }),
    },
  }),
}));
// The feature flag is OFF in source; force it on to exercise the flow.
vi.mock('@/lib/auth/admin-line-feature', () => ({ ADMIN_LINE_LINK_ENABLED: true }));

import { linkMergeAccounts, previewMergeAccounts } from '@/lib/auth/link-merge-accounts';
import { prisma } from '@/lib/db/prisma';
import { mintMergeToken } from '@/lib/pairing/token';

async function resetDb() {
  await prisma.attendance.deleteMany({});
  await prisma.userRoleAssignment.deleteMany({});
  await prisma.employee.deleteMany({});
  await prisma.user.deleteMany({});
  await prisma.branch.deleteMany({});
  await prisma.roleDefinition.deleteMany({});
  await prisma.roleDefinition.create({
    data: { key: 'admin', name: 'Admin', permissions: ['liff.admin'], isSuperadmin: false, isSystem: true },
  });
  await prisma.roleDefinition.create({
    data: { key: 'staff', name: 'Staff', permissions: [], isSuperadmin: false, isSystem: true },
  });
}

beforeEach(resetDb);
afterAll(async () => {
  await prisma.$disconnect();
});

async function seed(opts: { adminLine: string | null; empLine: string | null }) {
  const adminRole = await prisma.roleDefinition.findUniqueOrThrow({ where: { key: 'admin' } });
  const branch = await prisma.branch.create({ data: { name: 'B' } });
  const ua = await prisma.user.create({
    data: { email: 'boss@x.co', authUserId: crypto.randomUUID(), lineUserId: opts.adminLine },
  });
  await prisma.userRoleAssignment.create({ data: { userId: ua.id, roleId: adminRole.id, branchId: null } });
  const ue = await prisma.user.create({
    data: { authUserId: crypto.randomUUID(), lineUserId: opts.empLine },
  });
  await prisma.employee.create({
    data: {
      userId: ue.id,
      firstName: 'A',
      lastName: 'B',
      nickname: 'Em',
      branchId: branch.id,
      salaryType: 'Monthly',
      baseSalary: 20000,
      status: 'Active',
      hiredAt: new Date('2026-01-01'),
    },
  });
  const { token, expiresAt } = await mintMergeToken(ua.id, ue.id);
  await prisma.user.update({ where: { id: ua.id }, data: { mergeToken: token, mergeTokenExpiresAt: expiresAt } });
  return { ua, ue, token };
}

describe('link-merge-accounts — explicit pairing + consent', () => {
  it('previews the token-targeted employee (LINE on the employee row)', async () => {
    const { token } = await seed({ adminLine: null, empLine: 'L-emp' });
    fakeLineSub = 'L-emp';
    const res = await previewMergeAccounts({ mergeToken: token });
    expect(res).toEqual({ ok: true, adminEmail: 'boss@x.co', employeeName: 'Em' });
  });

  it('links when a self-paired admin scans (LINE on the admin row) → relocates', async () => {
    const { ua, ue, token } = await seed({ adminLine: 'L', empLine: null });
    fakeLineSub = 'L';
    const res = await linkMergeAccounts({ mergeToken: token });
    expect(res).toEqual({ ok: true });
    const ueAfter = await prisma.user.findUniqueOrThrow({ where: { id: ue.id } });
    const uaAfter = await prisma.user.findUniqueOrThrow({ where: { id: ua.id } });
    expect(ueAfter.lineUserId).toBe('L');
    expect(uaAfter.lineUserId).toBeNull();
    const ueRoles = await prisma.userRoleAssignment.findMany({
      where: { userId: ue.id },
      include: { role: true },
    });
    expect(ueRoles.some((r) => r.role.key === 'admin')).toBe(true);
  });

  it('rejects a stranger whose LINE belongs to neither party', async () => {
    const { token } = await seed({ adminLine: null, empLine: 'L-emp' });
    await prisma.user.create({ data: { lineUserId: 'L-stranger' } });
    fakeLineSub = 'L-stranger';
    const res = await linkMergeAccounts({ mergeToken: token });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('not-a-party');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run --config vitest.integration.config.ts tests/integration/link-merge-accounts.integration.test.ts`
Expected: FAIL — the current resolver infers the employee from the LINE session, so the self-paired-admin and stranger cases don't behave as asserted.

- [ ] **Step 3: Rewrite `resolveMergeParties`**

In `src/lib/auth/link-merge-accounts.ts`, replace `resolveMergeParties` (lines 23-81) with the explicit-pairing version. The `Parties` type already has `lineUserId` (Task 2). New body:

```ts
async function resolveMergeParties(
  mergeToken: string,
): Promise<{ ok: true; parties: Parties } | { ok: false; code: string; message: string }> {
  if (!ADMIN_LINE_LINK_ENABLED) {
    return { ok: false, code: 'disabled', message: 'ฟีเจอร์เชื่อมบัญชีถูกปิดใช้งานชั่วคราว' };
  }
  const supabase = await createClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();
  if (!authUser) return { ok: false, code: 'no-session', message: 'ไม่พบเซสชัน กรุณาลองใหม่' };

  const lineSub = (authUser.identities ?? []).find((i) => i.provider === 'custom:line')?.id;
  if (!lineSub) return { ok: false, code: 'not-line', message: 'ต้องเข้าสู่ระบบด้วยบัญชี LINE' };

  // Identity is STATED by the signed token, never inferred from the session.
  let adminUserId: string;
  let employeeUserId: string;
  try {
    ({ adminUserId, employeeUserId } = await verifyMergeToken(mergeToken));
  } catch {
    return { ok: false, code: 'invalid-token', message: 'ลิงก์ไม่ถูกต้องหรือหมดอายุ' };
  }

  // The admin must be a live, pure admin still holding this single-use token.
  const admin = await prisma.user.findUnique({
    where: { id: adminUserId },
    select: {
      email: true,
      mergeToken: true,
      mergeTokenExpiresAt: true,
      archivedAt: true,
      employee: { select: { id: true } },
    },
  });
  if (!admin || admin.archivedAt) return { ok: false, code: 'admin-gone', message: 'ไม่พบบัญชีผู้ดูแล' };
  if (admin.employee) {
    return { ok: false, code: 'admin-not-pure', message: 'บัญชีผู้ดูแลนี้เป็นพนักงานอยู่แล้ว' };
  }
  if (admin.mergeToken !== mergeToken) {
    return { ok: false, code: 'consumed', message: 'ลิงก์ถูกใช้ไปแล้ว กรุณาสร้างใหม่' };
  }
  if (!admin.mergeTokenExpiresAt || admin.mergeTokenExpiresAt.getTime() < Date.now()) {
    return { ok: false, code: 'expired', message: 'ลิงก์หมดอายุ กรุณาสร้างใหม่' };
  }

  // The chosen employee must exist and actually be an employee.
  const employee = await prisma.user.findUnique({
    where: { id: employeeUserId },
    select: {
      employee: { select: { firstName: true, lastName: true, nickname: true } },
    },
  });
  if (!employee?.employee) {
    return { ok: false, code: 'not-employee', message: 'บัญชีพนักงานที่เลือกไม่ถูกต้อง' };
  }

  // Consent: the scanning LINE must belong to one side of the stated pair, or be
  // unbound (a fresh LINE the merge will bind to the employee). Bound to anyone
  // else means a stranger scanned the QR — refuse.
  const lineOwner = await prisma.user.findUnique({
    where: { lineUserId: lineSub },
    select: { id: true },
  });
  if (lineOwner && lineOwner.id !== adminUserId && lineOwner.id !== employeeUserId) {
    return { ok: false, code: 'not-a-party', message: 'บัญชี LINE นี้ไม่เกี่ยวข้องกับการเชื่อมบัญชีนี้' };
  }

  const e = employee.employee;
  const employeeName = e.nickname?.trim() || `${e.firstName} ${e.lastName}`.trim();
  return {
    ok: true,
    parties: {
      adminUserId,
      adminEmail: admin.email,
      employeeUserId,
      employeeName,
      lineUserId: lineSub,
    },
  };
}
```

`previewMergeAccounts` and `linkMergeAccounts` are unchanged from their Task-2 state (they already read `resolved.parties` and pass `lineUserId`).

- [ ] **Step 4: Run the new integration test to verify it passes**

Run: `npx vitest run --config vitest.integration.config.ts tests/integration/link-merge-accounts.integration.test.ts`
Expected: PASS (3/3).

- [ ] **Step 5: Full typecheck, lint, and both suites**

Run: `npx tsc --noEmit && npx biome check src/lib/auth/link-merge-accounts.ts && npx vitest run && npx vitest run --config vitest.integration.config.ts`
Expected: tsc clean, biome clean, unit suite green, integration suite green (merge + link-merge tests included).

- [ ] **Step 6: Commit**

```bash
git add src/lib/auth/link-merge-accounts.ts tests/integration/link-merge-accounts.integration.test.ts
git commit -m "feat(line): explicit-pairing merge resolution + one-side consent"
```

---

## Self-Review

**1. Spec coverage:**
- Explicit pairing (token carries `employeeUserId`; admin picks employee) → Task 1 (token + picker) + Task 3 (resolver reads token). ✅
- Relocation rule (employee-row / unbound / admin-row / third-party) → Task 2. ✅
- One-side consent → Task 3 (`not-a-party`). ✅
- Non-destructive guarantees (admin keeps email/auth/roles; only `lineUserId` moves) → Task 2 implementation + assertions. ✅
- Audit includes LINE action → Task 2 audit payload. ✅
- Scenario matrix rows → covered across Task 2 (direct) + Task 3 (e2e): employee-first, admin-no-LINE, self-paired-admin relocate, fresh bind, third-party refuse, idempotent (the "employee already holds it" no-op). ✅
- Dependencies (flag re-enable, combined-menu branch) → explicitly OUT OF SCOPE per Global Constraints. ✅

**2. Placeholder scan:** No TBD/TODO; every code step shows complete code; every run step has an exact command + expected result. ✅

**3. Type consistency:**
- `mintMergeToken(adminUserId, employeeUserId)` / `verifyMergeToken → { adminUserId, employeeUserId }` consistent across Tasks 1 and 3. ✅
- `mergeAdminIntoEmployee({ adminUserId, employeeUserId, lineUserId })` defined in Task 2, called with all three args in Task 2 Step 5 and used by Task 3's `linkMergeAccounts`. ✅
- `Parties.lineUserId` added in Task 2, consumed in Task 3. ✅
- `startAdminMerge({ employeeUserId })` / `listMergeableEmployees()` defined and consumed in the same Task 1 (card). ✅

**Note for the executor:** between Task 1 and Task 3 the resolver still infers the employee (Task 2's Step 5 keeps it compiling); the full behavior only lands after Task 3. Run tasks in order 1 → 2 → 3.
