# Admin LINE Experience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admins pair their personal LINE account, get push notifications for actionable requests (leave / advance / dispute), and act on them from mobile LIFF pages — including attaching the bank-transfer slip after paying an advance (two-step: approve → pay → slip → worker gets "paid" push).

**Architecture:** Reuse the entire existing LINE pipeline (Inngest `notification.send` → `line-push-notification` → Flex templates). The only genuinely new primitives: (1) admin pairing writes `User.lineUserId` on the admin's existing row WITHOUT touching `authUserId` (admin keeps email login; in LIFF, `requireRole` gains a fallback that resolves the session's `custom:line` identity → `User.lineUserId`, which makes ALL existing admin server actions work in LIFF unchanged); (2) a per-user admin rich menu linked at pair time; (3) `/liff/admin/*` mobile pages that call the existing approve/reject server actions; (4) `CashAdvance.paidAt` + a `markAdvancePaid` action + `advance.paid` worker notification.

**Tech Stack:** Next.js App Router, Prisma/Supabase, Inngest, `@line/bot-sdk`, jose (JWT), next-intl (6 locales), Vitest.

**Spec:** `docs/superpowers/specs/2026-06-11-admin-line-experience-design.md`

**Environment gotchas (read first):**
- Prepend `/opt/homebrew/bin` to PATH (node v24 + pnpm). Run everything with `export PATH=/opt/homebrew/bin:$PATH`.
- Tests: `pnpm test` (vitest). Typecheck: `pnpm typecheck`. Lint: biome via lint-staged on commit.
- Migrations are plain SQL folders in `prisma/migrations/NNNN_name/migration.sql`; they auto-apply on deploy push. After editing `prisma/schema.prisma`, run `pnpm prisma generate` (do NOT run `prisma migrate dev` against prod env).
- The i18n parity test (`src/lib/i18n/messages.test.ts`) fails if a key exists in `th.json` but not all of `en/my/lo/km/zh-CN`. Every new key must be added to all 6 files (th + en human-quality; my/lo/km/zh-CN AI-draft, matching the project's existing convention).
- Spec deviation already agreed in design: no change to `src/lib/liff/init.ts` is needed — the existing "sign out non-LINE session, then LINE OIDC" behavior is correct for admins too, because admin resolution happens server-side via the new `requireRole` fallback.

---

### Task 1: Schema migration — `paidAt`, admin pairing token columns, `liff.admin` permission backfill

**Files:**
- Modify: `prisma/schema.prisma` (User + CashAdvance models)
- Create: `prisma/migrations/0029_admin_line_pairing_and_paid_at/migration.sql`
- Modify: `src/lib/auth/permissions.ts`
- Modify: `src/lib/auth/roles.ts` (admin role permissions array, after `'liff.profile-edit'` group pattern)

- [ ] **Step 1: Edit schema.** In `model User`, after the `lineUserId` line add:

```prisma
  /// Single-use admin LINE-pairing token (JWT, scope='admin-pair').
  /// Mirrors Employee.inviteToken but lives on User because admins have
  /// no Employee row. Nulled on successful pair (consume) or regenerate.
  lineInviteToken     String?   @unique
  lineInviteExpiresAt DateTime?
```

In `model CashAdvance`, after `receiptUrl String?` add:

```prisma
  /// Two-step payment: set the FIRST time a transfer slip is attached
  /// after approval. receiptUrl + paidAt together mean "money sent".
  /// Slip re-upload replaces receiptUrl but never overwrites paidAt.
  paidAt              DateTime?
```

- [ ] **Step 2: Write the migration SQL** at `prisma/migrations/0029_admin_line_pairing_and_paid_at/migration.sql`:

```sql
-- Admin LINE pairing + two-step advance payment (spec 2026-06-11-admin-line-experience)

ALTER TABLE "User" ADD COLUMN "lineInviteToken" TEXT;
ALTER TABLE "User" ADD COLUMN "lineInviteExpiresAt" TIMESTAMP(3);
CREATE UNIQUE INDEX "User_lineInviteToken_key" ON "User"("lineInviteToken");

ALTER TABLE "CashAdvance" ADD COLUMN "paidAt" TIMESTAMP(3);

-- Permission backfill: roles.ts changes only affect fresh seeds (established
-- pattern — see 0015/0026/0028). Grant the new liff.admin key to the system
-- admin role. Superadmin needs nothing (isSuperadmin short-circuit).
UPDATE "RoleDefinition"
SET "permissions" = array_append("permissions", 'liff.admin')
WHERE "key" = 'admin'
  AND "isSystem" = true
  AND NOT ('liff.admin' = ANY ("permissions"));
```

> NOTE: before committing, open one of `0015_void_permissions_backfill` / `0026_report_read_backfill` / `0028_payroll_permissions_backfill` and confirm the actual table/column names used there (`RoleDefinition` vs `"Role"`, `permissions` array type, `isSystem` column). Copy that file's exact UPDATE shape — it is the proven template for this DB.

- [ ] **Step 3: Add the permission key.** In `src/lib/auth/permissions.ts`, in the LIFF section after `'liff.profile-edit'`:

```ts
  'liff.admin': 'ใช้งานหน้าแอดมินใน LINE (อนุมัติคำขอ/แนบสลิป)',
```

and append `'liff.admin'` to the `liff` group in `PERMISSION_GROUPS`.

- [ ] **Step 4: Grant in roles.ts.** In `SYSTEM_ROLES.admin.permissions`, add `'liff.admin'` in the LIFF/approval area with a one-line comment that the 0029 migration backfills existing installs.

- [ ] **Step 5: Regenerate client + typecheck.**

Run: `export PATH=/opt/homebrew/bin:$PATH && pnpm prisma generate && pnpm typecheck`
Expected: clean. (`src/lib/auth/perm-coverage.test.ts` may assert every permission appears in a group — run `pnpm test -- perm-coverage` and fix per its message if it fails.)

- [ ] **Step 6: Commit** — `git add -A && git commit -m "feat(db): admin LINE pairing columns, CashAdvance.paidAt, liff.admin permission backfill"`

---

### Task 2: `requireRole` LINE-identity fallback (admin auto-login in LIFF)

**Files:**
- Modify: `src/lib/auth/require-role.ts`
- Test: `src/lib/auth/require-role-line-fallback.test.ts` (new; if existing require-role tests live elsewhere, follow their mocking pattern)

This is the keystone: an admin's LIFF Supabase session has a LINE-minted `auth.users.id` that does NOT match `User.authUserId` (which holds their email auth id). Today `requireRole` 404s. The fallback resolves the session's `custom:line` identity `sub` → `User.lineUserId`.

- [ ] **Step 1: Write the failing test.** Mock `@/lib/supabase/server` and `@/lib/db/prisma` (mirror mocking style from `src/lib/auth/check-permission.test.ts`). Cases:

```ts
import { describe, expect, it, vi } from 'vitest';

// 1. Session auth id matches no User.authUserId, but session has a
//    custom:line identity whose id matches a User.lineUserId with an
//    active admin role assignment → requireRole(['Admin']) resolves
//    that user (no notFound).
// 2. Same setup but the line identity matches no User → notFound thrown.
// 3. Session with NO custom:line identity and no authUserId match →
//    notFound (unchanged behavior — email users never fall back).
// 4. Worker fast path: authUserId matches directly → lineUserId lookup
//    is never queried (assert findUnique called once).
```

(Write these four as real tests with prisma `findUnique` mocked per-call; `notFound()` from `next/navigation` throws — assert with `expect(...).rejects.toThrow()`.)

- [ ] **Step 2: Run it to fail.** `pnpm test -- require-role-line-fallback` → cases 1 fails (notFound thrown), others may pass.

- [ ] **Step 3: Implement.** In `require-role.ts`, replace the single lookup with:

```ts
  const includeShape = {
    employee: true,
    roleAssignments: {
      select: {
        role: { select: { key: true, isSuperadmin: true, archivedAt: true } },
      },
    },
  } as const;

  let user = await prisma.user.findUnique({
    where: { authUserId: authUser.id },
    include: includeShape,
  });

  // LIFF fallback: an admin paired via /liff/pair-admin keeps their
  // email auth.users id on User.authUserId, while the LIFF session is a
  // separate LINE-minted auth user. Resolve by the session's verified
  // custom:line identity → User.lineUserId. Workers never reach here
  // (their pairing binds authUserId to the LINE auth user directly).
  if (!user) {
    const lineSub = (authUser.identities ?? []).find((i) => i.provider === 'custom:line')?.id;
    if (lineSub) {
      user = await prisma.user.findUnique({
        where: { lineUserId: lineSub },
        include: includeShape,
      });
    }
  }

  if (!user) notFound();
```

Everything downstream (tier computation, archived check) is unchanged. Keep `authUserId: authUser.id` in the returned shape — it is the **session** auth id, which is what storage-path checks must compare against.

- [ ] **Step 4: Run tests.** `pnpm test -- require-role` → all pass. Also `pnpm test -- check-permission` (requirePermission composes on requireRole).

- [ ] **Step 5: Commit** — `feat(auth): requireRole resolves paired admins via custom:line identity in LIFF`

---

### Task 3: Admin pairing token + `linkLineToAdmin` action + `/liff/pair-admin/[token]` page + admin settings UI

**Files:**
- Modify: `src/lib/pairing/token.ts`
- Create: `src/lib/auth/link-line-to-admin.ts`
- Create: `src/app/(liff)/liff/pair-admin/[token]/page.tsx` (+ client component, mirroring `src/app/(liff)/liff/pair/[token]/` — read that folder first and copy its structure)
- Create: `src/app/(admin)/admin/settings/line/page.tsx` + `src/app/(admin)/admin/settings/line/line-pairing-card.tsx` (client)
- Create: `src/lib/auth/admin-line-pairing-actions.ts` (mint link / unpair server actions)
- Test: `src/lib/pairing/token.test.ts` additions (or new file if none exists)

- [ ] **Step 1: Failing test for the token functions** — mint with scope `admin-pair`, verify round-trips userId; verifying an `employee-pair` token with the admin verifier throws (scope mismatch), and vice versa.

- [ ] **Step 2: Implement in `token.ts`** (parallel to the employee pair functions, sharing `getSecret`/ISSUER/AUDIENCE):

```ts
const ADMIN_SCOPE = 'admin-pair';
const ADMIN_TTL_SECONDS = 60 * 60; // 1h — admin pairs immediately, short window

export async function mintAdminPairingToken(userId: string): Promise<{ token: string; expiresAt: Date }> {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + ADMIN_TTL_SECONDS;
  const token = await new SignJWT({ scope: ADMIN_SCOPE })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer(ISSUER).setAudience(AUDIENCE).setSubject(userId)
    .setIssuedAt(now).setExpirationTime(exp).sign(getSecret());
  return { token, expiresAt: new Date(exp * 1000) };
}

export async function verifyAdminPairingToken(token: string): Promise<{ userId: string }> {
  const { payload } = await jwtVerify(token, getSecret(), {
    issuer: ISSUER, audience: AUDIENCE, algorithms: ['HS256'],
  });
  if (payload.scope !== ADMIN_SCOPE) throw new Error('Wrong token scope');
  if (typeof payload.sub !== 'string') throw new Error('Missing sub claim');
  return { userId: payload.sub };
}
```

Run the tests → pass. Commit: `feat(pairing): admin-pair JWT mint/verify`.

- [ ] **Step 3: Server actions for the admin web panel** — `src/lib/auth/admin-line-pairing-actions.ts`:

```ts
'use server';

import { auditLog } from '@/lib/audit/log';
import { requireRole } from '@/lib/auth/require-role';
import { prisma } from '@/lib/db/prisma';
import { appBaseUrl } from '@/lib/line/flex-templates';
import { unlinkAdminRichMenu } from '@/lib/line/rich-menu';
import { mintAdminPairingToken } from '@/lib/pairing/token';

/** Mint (or re-mint) the caller's own single-use LINE pairing link. */
export async function createMyLinePairingLink(): Promise<
  { ok: true; url: string; expiresAt: string } | { ok: false; message: string }
> {
  const { user } = await requireRole(['Admin']); // Superadmin auto-elevates
  if (user.lineUserId) return { ok: false, message: 'บัญชีนี้เชื่อมต่อ LINE แล้ว' };
  const { token, expiresAt } = await mintAdminPairingToken(user.id);
  await prisma.user.update({
    where: { id: user.id },
    data: { lineInviteToken: token, lineInviteExpiresAt: expiresAt },
  });
  auditLog({
    actorId: user.id, action: 'user.admin-line-invite',
    entityType: 'User', entityId: user.id, after: { expiresAt: expiresAt.toISOString() },
  });
  return { ok: true, url: `${appBaseUrl()}/liff/pair-admin/${token}`, expiresAt: expiresAt.toISOString() };
}

/** Unpair the caller's own LINE account (clears binding + rich menu). */
export async function unpairMyLine(): Promise<{ ok: true } | { ok: false; message: string }> {
  const { user } = await requireRole(['Admin']);
  if (!user.lineUserId) return { ok: false, message: 'ยังไม่ได้เชื่อมต่อ LINE' };
  await unlinkAdminRichMenu(user.lineUserId); // best-effort inside (never throws)
  await prisma.user.update({
    where: { id: user.id },
    data: { lineUserId: null, lineInviteToken: null, lineInviteExpiresAt: null },
  });
  auditLog({
    actorId: user.id, action: 'user.admin-line-unlink',
    entityType: 'User', entityId: user.id, before: { lineUserId: user.lineUserId },
  });
  return { ok: true };
}
```

(Check `auditLog`'s exact signature in `src/lib/audit/log.ts` and existing `action` string conventions before writing; adjust to match.) `unlinkAdminRichMenu` arrives in Task 4 — stub it as a no-op export there first if implementing this task before Task 4, or reorder (Task 4 has no dependency on Task 3; either order works, just keep imports satisfied).

- [ ] **Step 4: `linkLineToAdmin` server action** — `src/lib/auth/link-line-to-admin.ts`. Mirror `link-line-to-employee.ts`'s structure (session check → JWT verify → transaction with single-use + collision checks → audit) with these differences:

```ts
// Differences from linkLineToEmployee:
//  - verifyAdminPairingToken → { userId } (the admin's own User.id).
//  - Single-use check: User.lineInviteToken === input token, not expired.
//  - Target row must have an active admin-tier role assignment
//    (role.isSuperadmin OR role.key === 'admin' — same predicate as
//    notifyAdminsInApp) and archivedAt: null. Reject otherwise
//    with code 'not-admin'.
//  - Bind: set lineUserId = LINE sub from the session identities.
//    Do NOT touch authUserId (email login must keep working).
//  - Collision: if another User row already has this lineUserId →
//    'line-account-in-use' (a LINE account binds to at most one User —
//    an admin who is also a worker must use a second LINE account;
//    surface that in the error message).
//  - Consume: null lineInviteToken/lineInviteExpiresAt.
//  - Audit action: 'user.admin-line-link'.
//  - After the tx commits: await linkAdminRichMenu(lineUserId) wrapped in
//    try/catch — rich-menu failure logs but never fails the pairing
//    (spec §7). Return { ok: true, displayName: user.email ?? '' }.
```

Write it in full following the employee file as the template (error-code union, Prisma P2002 decode, header capture for audit). Keep the result message strings in Thai matching existing tone; the pair-admin page is admin-facing so Thai-only literals are fine (workers' 6-locale rule doesn't apply, matching the untranslated admin panel).

- [ ] **Step 5: LIFF page `/liff/pair-admin/[token]`.** Read `src/app/(liff)/liff/pair/[token]/page.tsx` and its client component; create the admin variant: client component runs `liffBootstrap()`, then calls `linkLineToAdmin({ pairingToken })`, renders success ("เชื่อมต่อสำเร็จ — เมนูแอดมินจะปรากฏในแชท OA") or the error message. No locale modal needed.

- [ ] **Step 6: Admin settings page.** `src/app/(admin)/admin/settings/line/page.tsx` (server): `requireRole(['Admin'])`, show paired status (`user.lineUserId != null`) and render `LinePairingCard` (client) with two flows: "สร้างลิงก์เชื่อมต่อ LINE" → calls `createMyLinePairingLink()` → shows the URL + copy button + hint "เปิดลิงก์นี้บนมือถือในแอป LINE"; when paired, show "ยกเลิกการเชื่อมต่อ" → `unpairMyLine()` with the project's existing confirm-dialog component (grep `ConfirmDialog` usage in `src/app/(admin)` and reuse). Add a nav link wherever other `/admin/settings/*` pages register (grep `settings/holiday` or similar for the settings index/sidebar and follow it).

- [ ] **Step 7: Typecheck + tests + manual sanity.** `pnpm typecheck && pnpm test -- pairing` → pass.

- [ ] **Step 8: Commit** — `feat(admin): self-serve LINE pairing (mint link, LIFF bind, unpair)`

---

### Task 4: Rich menu module + setup script

**Files:**
- Create: `src/lib/line/rich-menu.ts`
- Create: `scripts/setup-admin-rich-menu.ts`
- Modify: `.env.example` (if present — add `ADMIN_RICH_MENU_ID`)

- [ ] **Step 1: `src/lib/line/rich-menu.ts`:**

```ts
/**
 * Per-user admin rich menu link/unlink.
 *
 * The menu object itself is created once by scripts/setup-admin-rich-menu.ts
 * (OA-Manager menus CANNOT be linked per-user via API). Its id lives in
 * ADMIN_RICH_MENU_ID. Both helpers are best-effort: a rich-menu failure
 * must never break pairing/unpairing (spec §7) — they log and return.
 */

import { getLineMessagingClient } from './messaging-client';

export async function linkAdminRichMenu(lineUserId: string): Promise<void> {
  const richMenuId = process.env.ADMIN_RICH_MENU_ID;
  if (!richMenuId) {
    console.warn('[rich-menu] ADMIN_RICH_MENU_ID not set — skipping link');
    return;
  }
  try {
    await getLineMessagingClient().linkRichMenuIdToUser(lineUserId, richMenuId);
  } catch (err) {
    console.error('[rich-menu] link failed (non-fatal)', { lineUserId, err: String(err) });
  }
}

export async function unlinkAdminRichMenu(lineUserId: string): Promise<void> {
  try {
    await getLineMessagingClient().unlinkRichMenuIdFromUser(lineUserId);
  } catch (err) {
    console.error('[rich-menu] unlink failed (non-fatal)', { lineUserId, err: String(err) });
  }
}
```

(Verify method names against `@line/bot-sdk` types in `node_modules/@line/bot-sdk/dist/messaging-api/api/messagingApiClient.d.ts` — they are `linkRichMenuIdToUser(userId, richMenuId)` / `unlinkRichMenuIdFromUser(userId)` in current SDK.)

- [ ] **Step 2: Setup script** `scripts/setup-admin-rich-menu.ts` (run manually with `pnpm tsx scripts/setup-admin-rich-menu.ts <image.png>`; check how other scripts in `scripts/` load env — copy their dotenv pattern):

```ts
/**
 * One-off: create the ADMIN rich menu + upload its image, print the id.
 * Usage: pnpm tsx scripts/setup-admin-rich-menu.ts ./admin-menu.png
 * Then set ADMIN_RICH_MENU_ID=<printed id> in the deploy env.
 *
 * Image: 2500x1686 px (full) — three equal columns. JPEG/PNG ≤ 1MB.
 */
import { readFileSync } from 'node:fs';
import { messagingApi } from '@line/bot-sdk';

const token = process.env.LINE_MESSAGING_CHANNEL_ACCESS_TOKEN;
const base = process.env.NEXT_PUBLIC_APP_URL;
if (!token || !base) throw new Error('need LINE_MESSAGING_CHANNEL_ACCESS_TOKEN + NEXT_PUBLIC_APP_URL');

const client = new messagingApi.MessagingApiClient({ channelAccessToken: token });
const blobClient = new messagingApi.MessagingApiBlobClient({ channelAccessToken: token });

const W = 2500, H = 1686, COL = Math.floor(W / 3);
const { richMenuId } = await client.createRichMenu({
  size: { width: W, height: H },
  selected: true,
  name: 'koolman-admin-v1',
  chatBarText: 'เมนูแอดมิน',
  areas: [
    { bounds: { x: 0, y: 0, width: COL, height: H }, action: { type: 'uri', uri: `${base}/liff/admin/inbox` } },
    { bounds: { x: COL, y: 0, width: COL, height: H }, action: { type: 'uri', uri: `${base}/liff/admin/advance?filter=awaiting-slip` } },
    { bounds: { x: COL * 2, y: 0, width: W - COL * 2, height: H }, action: { type: 'uri', uri: `${base}/admin` } },
  ],
});

const imagePath = process.argv[2];
if (!imagePath) throw new Error('usage: tsx scripts/setup-admin-rich-menu.ts <image.png>');
const buf = readFileSync(imagePath);
await blobClient.setRichMenuImage(richMenuId, new Blob([buf], { type: imagePath.endsWith('.png') ? 'image/png' : 'image/jpeg' }), );
console.log('ADMIN_RICH_MENU_ID=', richMenuId);
```

> **USER HANDOFF (tell the user now):** the rich menu image is needed before deploy. 2500×1686 px, PNG/JPEG ≤ 1 MB, three equal vertical columns labeled (left→right): **กล่องงานรออนุมัติ**, **รอแนบสลิป**, **เปิดเว็บแอดมิน**.

- [ ] **Step 3: Typecheck, commit** — `feat(line): admin rich menu link/unlink + setup script`

---

### Task 5: New notification kinds (events + Flex templates + i18n)

**Files:**
- Modify: `src/lib/inngest/events.ts`
- Modify: `src/lib/line/flex-templates.ts`
- Modify: `messages/th.json`, `messages/en.json`, `messages/my.json`, `messages/lo.json`, `messages/km.json`, `messages/zh-CN.json` (the `notifications` namespace)
- Test: `src/lib/line/flex-templates.test.ts` (extend)

- [ ] **Step 1: Extend `NotificationKind` + payload union** in `events.ts`:

```ts
  | 'advance.paid'
  | 'admin.leave-submitted'
  | 'admin.advance-submitted'
  | 'admin.dispute-submitted'
```

```ts
  | {
      kind: 'advance.paid';
      cashAdvanceId: string;
      employeeFirstName: string;
      /** Formatted string ("12,500.00") — same Decimal convention. */
      amount: string;
    }
  | {
      kind: 'admin.leave-submitted';
      leaveRequestId: string;
      employeeName: string;
      leaveTypeName: string;
      startDate: string; // YYYY-MM-DD
      endDate: string;
    }
  | {
      kind: 'admin.advance-submitted';
      cashAdvanceId: string;
      employeeName: string;
      amount: string;
    }
  | {
      kind: 'admin.dispute-submitted';
      attendanceId: string;
      employeeName: string;
      date: string; // YYYY-MM-DD
      reason: string;
    };
```

- [ ] **Step 2: Idempotency.** Change `sendNotification` so the event id includes the recipient — required for admin fan-out (same entity → N admins must NOT dedupe to one event), harmless for worker kinds (one recipient → identical semantics):

```ts
  await inngest.send({
    id: `${notificationIdempotencyKey(payload)}:${recipientUserId}`,
    ...
```

and extend `notificationIdempotencyKey`'s switch:

```ts
    case 'advance.paid':
    case 'admin.advance-submitted':
      return `notif:${payload.kind}:${payload.cashAdvanceId}`;
    case 'admin.leave-submitted':
      return `notif:${payload.kind}:${payload.leaveRequestId}`;
    case 'admin.dispute-submitted':
      return `notif:${payload.kind}:${payload.attendanceId}`;
```

Note in a comment: `advance.paid` re-fires on slip re-upload are deduped within Inngest's ~24h window — intentional (replacing a slip shouldn't re-ping the worker).

- [ ] **Step 3: Failing template tests.** In `flex-templates.test.ts`, following the existing test style, add cases asserting: each new kind returns a FlexMessage with non-empty `altText`; `admin.leave-submitted` action URI ends with `/liff/admin/leave/<id>`; `admin.advance-submitted` → `/liff/admin/advance/<id>`; `admin.dispute-submitted` → `/liff/admin/inbox`; `advance.paid` → `/liff/advance/<id>` and a GREEN header. Run → fails (TS error on non-exhaustive switch is the expected first failure).

- [ ] **Step 4: Implement template cases** in `buildFlexMessage` (add `const ORANGE = '#d97706';` near the color consts):

```ts
    case 'advance.paid':
      altText = t('advancePaid.alt', { amount: payload.amount });
      bubble = approvedRejectedBubble({
        accent: GREEN,
        headerEmoji: '💸',
        headerText: t('advancePaid.header'),
        title: `฿${payload.amount}`,
        subtitle: t('advancePaid.subtitle'),
        details: [],
        actionLabel: t('action.viewSlip'),
        actionUri: `${appBaseUrl}/liff/advance/${payload.cashAdvanceId}`,
      });
      break;

    case 'admin.leave-submitted':
      altText = t('adminLeaveSubmitted.alt', { name: payload.employeeName });
      bubble = approvedRejectedBubble({
        accent: ORANGE,
        headerEmoji: '📥',
        headerText: t('adminLeaveSubmitted.header'),
        title: payload.employeeName,
        subtitle: payload.leaveTypeName,
        details: [
          { label: t('label.dates'), value: fmtDateRange(payload.startDate, payload.endDate, locale) },
        ],
        actionLabel: t('action.review'),
        actionUri: `${appBaseUrl}/liff/admin/leave/${payload.leaveRequestId}`,
      });
      break;

    case 'admin.advance-submitted':
      altText = t('adminAdvanceSubmitted.alt', { name: payload.employeeName, amount: payload.amount });
      bubble = approvedRejectedBubble({
        accent: ORANGE,
        headerEmoji: '📥',
        headerText: t('adminAdvanceSubmitted.header'),
        title: `฿${payload.amount}`,
        subtitle: payload.employeeName,
        details: [],
        actionLabel: t('action.review'),
        actionUri: `${appBaseUrl}/liff/admin/advance/${payload.cashAdvanceId}`,
      });
      break;

    case 'admin.dispute-submitted':
      altText = t('adminDisputeSubmitted.alt', { name: payload.employeeName });
      bubble = approvedRejectedBubble({
        accent: ORANGE,
        headerEmoji: '📥',
        headerText: t('adminDisputeSubmitted.header'),
        title: payload.employeeName,
        subtitle: fmtDate(payload.date, locale),
        details: [{ label: t('label.reason'), value: payload.reason }],
        actionLabel: t('action.review'),
        actionUri: `${appBaseUrl}/liff/admin/inbox`,
      });
      break;
```

- [ ] **Step 5: i18n keys** — add to the `notifications` namespace in ALL 6 message files (th + en below; my/lo/km/zh-CN AI-drafted equivalents, same keys):

th:
```json
"advancePaid": { "header": "โอนเงินค่าเบิกแล้ว", "subtitle": "แตะเพื่อดูสลิปการโอน", "alt": "💸 โอนเงินค่าเบิก ฿{amount} แล้ว" },
"adminLeaveSubmitted": { "header": "คำขอลาใหม่", "alt": "📥 {name} ยื่นคำขอลา" },
"adminAdvanceSubmitted": { "header": "คำขอเบิกใหม่", "alt": "📥 {name} ขอเบิก ฿{amount}" },
"adminDisputeSubmitted": { "header": "รายการลงเวลารอตรวจสอบ", "alt": "📥 {name} มีรายการลงเวลารอตรวจสอบ" },
"label": { "dates": "วันที่" },
"action": { "review": "ตรวจสอบ", "viewSlip": "ดูสลิป" }
```
(`label`/`action` already exist — MERGE the new sub-keys into the existing objects, don't duplicate.)

en:
```json
"advancePaid": { "header": "Advance paid", "subtitle": "Tap to view the transfer slip", "alt": "💸 Advance ฿{amount} has been transferred" },
"adminLeaveSubmitted": { "header": "New leave request", "alt": "📥 {name} submitted a leave request" },
"adminAdvanceSubmitted": { "header": "New advance request", "alt": "📥 {name} requested ฿{amount}" },
"adminDisputeSubmitted": { "header": "Attendance dispute", "alt": "📥 {name} has an attendance entry to review" },
"label": { "dates": "Dates" },
"action": { "review": "Review", "viewSlip": "View slip" }
```

- [ ] **Step 6: Run tests** — `pnpm test -- flex-templates && pnpm test -- messages` → pass (parity test green across 6 locales).

- [ ] **Step 7: Commit** — `feat(notifications): advance.paid + admin needs-action kinds with Flex templates (6 locales)`

---

### Task 6: Admin LINE fan-out + wire into the four submit sites

**Files:**
- Create: `src/lib/notifications/admin-line.ts`
- Modify: `src/lib/leave/actions.ts` (~line 276), `src/lib/advance/actions.ts` (~line 143), `src/lib/advance/admin.ts` (~line 411), `src/lib/attendance/check-in.ts` (~line 302)
- Test: `src/lib/notifications/admin-line.test.ts`

- [ ] **Step 1: Failing test.** Mock prisma + `sendNotification`; assert: (a) only users matching the admin predicate **with `lineUserId != null`** get `sendNotification` calls, one each; (b) zero paired admins → zero calls, no throw; (c) a prisma error is swallowed (fire-and-forget, mirrors `notifyAdminsInApp`).

- [ ] **Step 2: Implement:**

```ts
'use server';

/**
 * LINE-push fan-out to paired admins — the LINE sibling of
 * notifyAdminsInApp (same recipient predicate + lineUserId required).
 * Fire-and-forget: failures log, never propagate to the worker's submit.
 */

import { prisma } from '@/lib/db/prisma';
import { type NotificationPayload, sendNotification } from '@/lib/inngest/events';

type AdminLinePayload = Extract<
  NotificationPayload,
  { kind: 'admin.leave-submitted' | 'admin.advance-submitted' | 'admin.dispute-submitted' }
>;

export async function notifyAdminsOnLine(payload: AdminLinePayload): Promise<void> {
  try {
    const recipients = await prisma.user.findMany({
      where: {
        archivedAt: null,
        lineUserId: { not: null },
        roleAssignments: {
          some: {
            role: { archivedAt: null, OR: [{ isSuperadmin: true }, { key: 'admin' }] },
          },
        },
      },
      select: { id: true },
    });
    await Promise.all(recipients.map((r) => sendNotification(r.id, payload)));
  } catch (err) {
    console.error('[notifyAdminsOnLine] failed (non-fatal)', {
      kind: payload.kind,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
```

- [ ] **Step 3: Wire the four call sites.** Directly after each existing `void notifyAdminsInApp({...})`, add the LINE sibling with the SAME field values already in scope at that site:

leave/actions.ts: `void notifyAdminsOnLine({ kind: 'admin.leave-submitted', leaveRequestId, employeeName, leaveTypeName, startDate, endDate });`
advance/actions.ts: `void notifyAdminsOnLine({ kind: 'admin.advance-submitted', cashAdvanceId, employeeName, amount });`
advance/admin.ts (adminCreateCashAdvance): same as above with `created.id`.
attendance/check-in.ts: `void notifyAdminsOnLine({ kind: 'admin.dispute-submitted', attendanceId, employeeName, date, reason });`

(At each site read the surrounding bell call and reuse its exact local variable names/expressions — e.g. `employeeBellName(employee)`, `formatAmount(...)`.)

- [ ] **Step 4: Tests + typecheck** — `pnpm test -- admin-line && pnpm typecheck` → pass.

- [ ] **Step 5: Commit** — `feat(notifications): LINE push fan-out to paired admins on leave/advance/dispute submission`

---

### Task 7: `markAdvancePaid` action (slip attach, two-step payment)

**Files:**
- Modify: `src/lib/advance/admin.ts` (append)
- Test: `src/lib/advance/mark-paid.test.ts`

- [ ] **Step 1: Failing tests** (mock prisma tx like `void-guards.test.ts` does, or test the pure guard logic if the file's style extracts it): (a) Approved row + valid key → sets `receiptUrl` and `paidAt`; (b) second call (row already has `paidAt`) → replaces `receiptUrl`, `paidAt` unchanged; (c) Pending/Rejected row → `not-approved` error; (d) storage key not starting with `${sessionAuthUserId}/advance-receipts/` and not http(s) → `forbidden`; (e) success fires `sendNotification` with kind `advance.paid`.

- [ ] **Step 2: Implement** (append to `advance/admin.ts`, following the file's existing approve/reject shape — headers capture, holder-object for the notif payload, `auditLogTx`):

```ts
export type MarkPaidResult =
  | { ok: true }
  | { ok: false; code: 'forbidden' | 'not-found' | 'not-approved' | 'db-error'; message: string };

/**
 * Two-step payment, step 2: admin transferred the money and attaches the
 * slip. Requires status=Approved (slip before approval makes no sense;
 * the approve flow's optional receiptUrl still exists for the legacy
 * one-shot web path). paidAt is set ONCE; re-upload replaces the image only.
 */
export async function markAdvancePaid(input: {
  cashAdvanceId: string;
  receiptKey: string;
}): Promise<MarkPaidResult> {
  const { user, authUserId } = await requirePermission('advance.approve');

  const key = input.receiptKey.trim();
  if (!/^https?:\/\//i.test(key) && !key.startsWith(`${authUserId}/advance-receipts/`)) {
    return { ok: false, code: 'forbidden', message: 'ลิงก์สลิปไม่ถูกต้อง' };
  }

  const headerList = await headers();
  const ip = headerList.get('x-forwarded-for')?.split(',')[0]?.trim() ?? headerList.get('x-real-ip') ?? undefined;
  const userAgent = headerList.get('user-agent') ?? undefined;

  const notifBox: { data: { recipientUserId: string; employeeFirstName: string; amount: string } | null } = { data: null };

  try {
    const result = await prisma.$transaction<MarkPaidResult>(async (tx) => {
      const row = await tx.cashAdvance.findUnique({
        where: { id: input.cashAdvanceId },
        select: {
          id: true, status: true, amount: true, paidAt: true, receiptUrl: true,
          employee: { select: { firstName: true, userId: true } },
        },
      });
      if (!row) return { ok: false as const, code: 'not-found' as const, message: 'ไม่พบคำขอเบิก' };
      if (row.status !== 'Approved') {
        return { ok: false as const, code: 'not-approved' as const, message: 'แนบสลิปได้เฉพาะคำขอที่อนุมัติแล้ว' };
      }

      const firstAttach = row.paidAt === null;
      await tx.cashAdvance.update({
        where: { id: row.id },
        data: { receiptUrl: key, ...(firstAttach ? { paidAt: new Date() } : {}) },
      });

      await auditLogTx(tx, {
        actorId: user.id,
        action: 'advance.mark-paid',
        entityType: 'CashAdvance',
        entityId: row.id,
        before: { receiptUrl: row.receiptUrl, paidAt: row.paidAt?.toISOString() ?? null },
        after: { receiptUrl: key, paidAt: firstAttach ? 'now' : row.paidAt?.toISOString() },
        metadata: { ip, userAgent, source: 'liff-admin' },
      });

      if (firstAttach) {
        notifBox.data = {
          recipientUserId: row.employee.userId,
          employeeFirstName: row.employee.firstName,
          amount: formatAmount(row.amount),
        };
      }
      return { ok: true as const };
    });

    if (result.ok && notifBox.data) {
      await sendNotification(notifBox.data.recipientUserId, {
        kind: 'advance.paid',
        cashAdvanceId: input.cashAdvanceId,
        employeeFirstName: notifBox.data.employeeFirstName,
        amount: notifBox.data.amount,
      });
    }
    return result;
  } catch (err) {
    console.error('[markAdvancePaid] tx failed', err);
    return { ok: false, code: 'db-error', message: 'ระบบขัดข้อง กรุณาลองใหม่อีกครั้ง' };
  }
}
```

- [ ] **Step 3: Tests pass, commit** — `feat(advance): markAdvancePaid — slip attach sets paidAt + advance.paid worker push`

---

### Task 8: LIFF admin pages — gate, inbox, leave detail, advance detail + slip upload

**Files:**
- Create: `src/lib/auth/require-liff-admin.ts`
- Create: `src/app/(liff)/liff/admin/layout.tsx`
- Create: `src/app/(liff)/liff/admin/inbox/page.tsx`
- Create: `src/app/(liff)/liff/admin/leave/[id]/page.tsx` + `leave-review-actions.tsx` (client)
- Create: `src/app/(liff)/liff/admin/advance/page.tsx` (list incl. `?filter=awaiting-slip`)
- Create: `src/app/(liff)/liff/admin/advance/[id]/page.tsx` + `advance-review-actions.tsx` (client, incl. slip upload)
- Test: `src/lib/auth/require-liff-admin.test.ts`

All pages are Thai-only literals (admin-facing — matches the untranslated admin panel; no message-file keys needed). Visual style: copy the card/list classes from `src/app/(liff)/liff/advance/page.tsx` shown patterns (`max-w-md`, `rounded-xl border border-gray-200 bg-white p-4 shadow-sm`).

- [ ] **Step 1: `requireLiffAdmin` (TDD).** Test: passes for a user whose assignments grant `liff.admin` (or isSuperadmin); `notFound` for staff. Implementation is a thin composition:

```ts
import { notFound } from 'next/navigation';
import { getUserAssignments, canDo } from '@/lib/auth/check-permission'; // verify export names in that file
import { requireRole, type RequireRoleResult } from '@/lib/auth/require-role';

/** Gate for /liff/admin/* — admin-tier session (LIFF LINE-identity
 *  fallback applies) that also holds the liff.admin permission. */
export async function requireLiffAdmin(): Promise<RequireRoleResult> {
  const result = await requireRole(['Admin']);
  const assignments = await getUserAssignments(result.user.id);
  if (!canDo(assignments, 'liff.admin')) notFound();
  return result;
}
```

(Open `check-permission.ts` first — if it already exposes a `requirePermission('liff.admin')` helper that composes requireRole, just re-export a wrapper around that instead; match its real API.)

- [ ] **Step 2: Layout** `src/app/(liff)/liff/admin/layout.tsx` — a slim tab bar so plan-B pages slot in later:

```tsx
import Link from 'next/link';

/** /liff/admin shell — tab nav grows in plan B (attendance overview, stats). */
export default function LiffAdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-md">
      <nav className="flex gap-1 px-4 pt-2 text-sm">
        <Link href="/liff/admin/inbox" className="rounded-full px-3 py-1.5 font-medium text-gray-700 hover:bg-gray-100">รออนุมัติ</Link>
        <Link href="/liff/admin/advance?filter=awaiting-slip" className="rounded-full px-3 py-1.5 font-medium text-gray-700 hover:bg-gray-100">รอแนบสลิป</Link>
      </nav>
      {children}
    </div>
  );
}
```

- [ ] **Step 3: Inbox page** — server component; `await requireLiffAdmin()`; three parallel queries (mirror where-clauses from the corresponding admin web pages — open `src/app/(admin)/admin/leave/page.tsx` and `src/app/(admin)/admin/advance/page.tsx` to copy their pending filters exactly, including `deletedAt: null`):
  - `prisma.leaveRequest.findMany({ where: { status: 'Pending', deletedAt: null }, include: employee names + leaveType, orderBy createdAt desc })`
  - `prisma.cashAdvance.findMany({ where: { status: 'Pending', deletedAt: null }, ... })`
  - disputed attendance (copy the dispute-pending where-clause from the admin attendance dispute page)

  Render three sections ("คำขอลา", "คำขอเบิก", "ลงเวลารอตรวจสอบ"), each item a `<Link>` card to `/liff/admin/leave/[id]`, `/liff/admin/advance/[id]`, or (disputes, v1) the admin web dispute page URL. Empty state: "ไม่มีงานค้าง 🎉".

- [ ] **Step 4: Leave detail + actions.** Server page loads the LeaveRequest with employee/type/quota context — reuse the same data helpers the web review modal uses (open `src/app/(admin)/admin/leave/leave-review-modal.tsx` and its page to find them, e.g. the approval-preview helper `src/lib/leave/approval-preview.ts`). Render: employee name, type, date range, reason, duration preview, status. If `Pending`, mount `LeaveReviewActions` (client): note textarea + อนุมัติ / ปฏิเสธ buttons calling `approveLeaveRequest` / `rejectLeaveRequest` from `@/lib/leave/admin` (check their exact input signatures at the top of that file) inside `useTransition`, with the existing confirm-dialog component; on success `router.refresh()` and show the settled state. Already-decided rows render read-only with the decision badge.

- [ ] **Step 5: Advance list + detail + slip.**
  - List page: `requireLiffAdmin()`; `filter=awaiting-slip` → `{ status: 'Approved', paidAt: null, deletedAt: null }`; default → `{ status: 'Pending', deletedAt: null }`. Cards show amount, employee, requestedAt.
  - Detail page: load row + employee + balance context (`advanceBalanceFor`). Three states:
    1. `Pending` → `AdvanceReviewActions` client: อนุมัติ / ปฏิเสธ → `approveCashAdvance({ cashAdvanceId })` / `rejectCashAdvance({ cashAdvanceId })` (no receipt at this step — two-step flow).
    2. `Approved && paidAt === null` → slip upload block: `<input type="file" accept="image/*" capture="environment">` → `compressToJpeg(file)` → `uploadAdvanceReceipt(supabase, blob, session.user.id, cashAdvanceId)` (browser Supabase client from `@/lib/supabase/browser`; the LIFF session's `auth.uid()` satisfies the storage RLS and matches the server check) → `markAdvancePaid({ cashAdvanceId, receiptKey: key })` → refresh. Show upload progress + error toast on failure.
    3. `paidAt !== null` → show the slip image via signed URL (server-side: use the helper in `src/lib/storage/signed-urls.ts` — open it for the exact function name/TTL convention; admin web's receipt viewer is the reference consumer) + "แนบสลิปใหม่" re-upload button (same client flow; paidAt is preserved server-side).

- [ ] **Step 6: Typecheck + tests + commit** — `feat(liff): admin inbox, leave/advance review, slip attach pages`

---

### Task 9: Worker advance detail — show slip + paid state

**Files:**
- Modify: `src/app/(liff)/liff/advance/[id]/page.tsx`
- Modify: 6 message files — `advance` namespace

- [ ] **Step 1:** Open the worker detail page; add to its query `paidAt: true, receiptUrl: true`. When `paidAt != null`: render a "โอนเงินแล้ว" (t `detail.paid`) badge with the paid date and, when `receiptUrl` is a storage key, the slip image via the same signed-URL helper as Task 8 step 5 (server component → signed URL → `<img>` in a rounded card). Keys for 6 locales: `advance.detail.paid` ("โอนเงินแล้ว" / "Paid"), `advance.detail.slip` ("สลิปการโอน" / "Transfer slip").

- [ ] **Step 2:** `pnpm test -- messages && pnpm typecheck` → pass. Commit — `feat(liff): worker advance detail shows paid status + transfer slip`

---

### Task 10: Integration verification + docs

- [ ] **Step 1: Full suite.** `export PATH=/opt/homebrew/bin:$PATH && pnpm test && pnpm typecheck && pnpm lint` → all green (4 deferred E2E skips are expected per project memory; do NOT run E2E against port 3000 if another app is on it).
- [ ] **Step 2: E2E smoke (optional but preferred).** If `test:e2e` patterns allow, add `e2e/liff-admin.spec.ts` covering: unauthenticated hit of `/liff/admin/inbox` → 404; (deeper LIFF-auth E2E is impractical without LINE — unit coverage carries the auth logic).
- [ ] **Step 3: Deployment checklist** — append to the spec doc a "Rollout" section:
  1. Push → migrations 0029 auto-apply (fail-loud pipeline).
  2. User supplies rich-menu image → run `pnpm tsx scripts/setup-admin-rich-menu.ts <image>` with prod env → set `ADMIN_RICH_MENU_ID` in Vercel env → redeploy.
  3. Each admin: /admin/settings/line → create link → open on phone in LINE → paired; verify the rich menu appears and a test leave submission pushes to their LINE.
- [ ] **Step 4: Commit + report.**

---

## Self-review notes (already applied)

- Spec §1 pairing → Tasks 1–3; §2 rich menu → Task 4; §3 LIFF pages → Task 8; §4 notifications → Tasks 5–6; §5 data/permission → Task 1; §6 two-step → Task 7 + 8.5 + 9; §7 edge cases → non-fatal rich menu (T4), status guards (T7/existing actions), re-upload preserves paidAt (T7); §8 testing → per-task TDD + Task 10.
- Type consistency: `notifyAdminsOnLine` payloads = `Extract<NotificationPayload, ...>` so Task 5's types are the single source; `markAdvancePaid` input `{ cashAdvanceId, receiptKey }` used identically in Task 8.
- Deliberate deviation from spec: no `src/lib/liff/init.ts` change (the requireRole fallback supersedes it) — noted in the header.
