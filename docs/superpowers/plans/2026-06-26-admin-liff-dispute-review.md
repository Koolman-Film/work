# Admin LIFF — Disputed Check-in Review (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a paired admin review a disputed (flagged) check-in fully from their phone — see the selfie + location + reason, approve or reject — instead of being bounced to the web.

**Architecture:** A new `/liff/admin/dispute/[id]` LIFF route that mirrors the existing `/liff/admin/leave/[id]` template (server component loads the row → renders detail → mounts a client approve/reject component when still Disputed). The approve/reject reuses the existing `approveDisputed`/`rejectDisputed` actions (already `{ok}`-shaped). The inbox's dispute item, currently linking to the web, is repointed to this route.

**Tech Stack:** Next.js 16 App Router, Prisma → Supabase, server actions, Tailwind, Biome, Vitest.

## Global Constraints

- Admin LIFF pages gate on `requireLiffAdmin()` (`src/lib/auth/require-liff-admin.ts`) — same as the existing leave/advance detail pages.
- Reuse `approveDisputed` / `rejectDisputed` from `src/lib/attendance/admin-review.ts` — signature `({ attendanceId: string; note: string }) → Promise<ReviewResult>` where `ReviewResult = { ok: true; ... } | { ok: false; code: string; message: string }`. Do NOT write new approval logic.
- Selfie keys are storage keys resolved at view time via `resolveStoredImageUrl` (`src/lib/storage/signed-urls`) — same helper the leave page uses for `attachmentUrl`.
- Thai-only copy (the admin surface is intentionally untranslated, matching the existing leave/advance LIFF detail pages).
- Gate each task on: `npx tsc --noEmit` clean, `npx biome check .` clean, `npx vitest run --config vitest.integration.config.ts <file>` green for any integration test. Commit per task. Co-author every commit: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

## File Structure

- Create: `src/app/(liff)/liff/admin/dispute/[id]/page.tsx` — server detail page.
- Create: `src/app/(liff)/liff/admin/dispute/[id]/dispute-review-actions.tsx` — client approve/reject (mirrors `leave-review-actions.tsx`).
- Modify: `src/app/(liff)/liff/admin/inbox/page.tsx` — repoint the dispute `ItemCard` href from `/admin/attendance/disputed` to `/liff/admin/dispute/${r.id}`.
- Test: `tests/integration/liff-dispute-review.integration.test.ts` — the reuse seam (approve/reject flips `checkInStatus`).

---

### Task 1: Dispute review actions (client component)

**Files:**
- Create: `src/app/(liff)/liff/admin/dispute/[id]/dispute-review-actions.tsx`

**Interfaces:**
- Consumes: `approveDisputed`, `rejectDisputed` from `@/lib/attendance/admin-review`.
- Produces: `DisputeReviewActions({ attendanceId }: { attendanceId: string })` — a client component rendering approve/reject with a two-step confirm.

- [ ] **Step 1: Create the component**

Mirror `src/app/(liff)/liff/admin/leave/[id]/leave-review-actions.tsx` exactly, but: the note is OPTIONAL (a flagged check-in is usually clear-cut), and it calls the dispute actions. Create `src/app/(liff)/liff/admin/dispute/[id]/dispute-review-actions.tsx`:

```tsx
'use client';

/**
 * Approve / reject actions for the LIFF disputed-check-in review page.
 * Optional note + two-step confirm (first tap arms, second fires inside a
 * transition). Reuses the same approveDisputed/rejectDisputed actions the web
 * uses. On success → settled banner + router.refresh().
 */

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { approveDisputed, rejectDisputed } from '@/lib/attendance/admin-review';

type Arm = 'approve' | 'reject' | null;

export function DisputeReviewActions({ attendanceId }: { attendanceId: string }) {
  const router = useRouter();
  const [note, setNote] = useState('');
  const [armed, setArmed] = useState<Arm>(null);
  const [error, setError] = useState('');
  const [done, setDone] = useState<'approved' | 'rejected' | null>(null);
  const [firing, setFiring] = useState<Arm>(null);
  const [isPending, startTransition] = useTransition();

  function fire(kind: 'approve' | 'reject') {
    if (armed !== kind) {
      setArmed(kind);
      setError('');
      return;
    }
    setArmed(null);
    setFiring(kind);
    startTransition(async () => {
      const result =
        kind === 'approve'
          ? await approveDisputed({ attendanceId, note: note.trim() })
          : await rejectDisputed({ attendanceId, note: note.trim() });
      if (result.ok) {
        setDone(kind === 'approve' ? 'approved' : 'rejected');
        router.refresh();
      } else {
        setError(result.message);
      }
      setFiring(null);
    });
  }

  if (done) {
    return (
      <section className="mt-3 rounded-xl border border-green-200 bg-green-50 p-4 text-center">
        <p className="text-sm font-medium text-green-800">
          {done === 'approved' ? 'ยืนยันการเช็คอินแล้ว ✓' : 'ปฏิเสธการเช็คอินแล้ว'}
        </p>
      </section>
    );
  }

  return (
    <section className="mt-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <label htmlFor="dispute-note" className="text-xs font-medium text-gray-500">
        หมายเหตุ (ไม่บังคับ)
      </label>
      <textarea
        id="dispute-note"
        value={note}
        onChange={(e) => {
          setNote(e.target.value);
          setArmed(null);
        }}
        rows={2}
        placeholder="เช่น: ยืนยันตามรูป / ปฏิเสธ — อยู่นอกพื้นที่"
        className="mt-1 w-full rounded-lg border border-gray-300 p-2 text-sm focus:border-primary-500 focus:outline-none"
      />
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={isPending}
          onClick={() => fire('approve')}
          className="rounded-lg bg-green-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-green-700 disabled:opacity-50"
        >
          {isPending && firing === 'approve' ? 'กำลังบันทึก…' : armed === 'approve' ? 'ยืนยัน?' : 'ยืนยันเช็คอิน'}
        </button>
        <button
          type="button"
          disabled={isPending}
          onClick={() => fire('reject')}
          className="rounded-lg bg-red-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-red-700 disabled:opacity-50"
        >
          {isPending && firing === 'reject' ? 'กำลังบันทึก…' : armed === 'reject' ? 'ยืนยัน?' : 'ปฏิเสธ'}
        </button>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Typecheck + lint**

Run: `npx tsc --noEmit && npx biome check --write "src/app/(liff)/liff/admin/dispute/[id]/dispute-review-actions.tsx"`
Expected: clean. (Note: if `approveDisputed`'s `ReviewResult` success variant has no `message`, the `result.message` access is correctly guarded behind `!result.ok` — TypeScript narrows it.)

- [ ] **Step 3: Commit**

```bash
git add "src/app/(liff)/liff/admin/dispute/[id]/dispute-review-actions.tsx"
git commit -m "feat(liff): dispute review approve/reject actions component

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Dispute detail page (server component)

**Files:**
- Create: `src/app/(liff)/liff/admin/dispute/[id]/page.tsx`

**Interfaces:**
- Consumes: `requireLiffAdmin` (`@/lib/auth/require-liff-admin`), `prisma`, `resolveStoredImageUrl` (`@/lib/storage/signed-urls`), `DisputeReviewActions` (Task 1).
- Produces: the route `/liff/admin/dispute/[id]`.

- [ ] **Step 1: Create the page**

Mirror the structure of `src/app/(liff)/liff/admin/leave/[id]/page.tsx`. Attendance fields (confirmed in `prisma/schema.prisma` Attendance model): `clockInAt`, `checkInStatus` (enum `CheckInStatus`, dispute value `'Disputed'`), `disputeReason`, `checkInSelfieUrl` (storage key → sign it), `checkInLat`/`checkInLng` (Decimal), `employee`, `checkInBranch`. Create `src/app/(liff)/liff/admin/dispute/[id]/page.tsx`:

```tsx
/**
 * /liff/admin/dispute/[id] — mobile review of a flagged (Disputed) check-in.
 * Shows the selfie + location + reason; Disputed → approve/reject actions,
 * decided → read-only. Reuses approveDisputed/rejectDisputed via the client
 * actions component.
 */

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireLiffAdmin } from '@/lib/auth/require-liff-admin';
import { prisma } from '@/lib/db/prisma';
import { resolveStoredImageUrl } from '@/lib/storage/signed-urls';
import { DisputeReviewActions } from './dispute-review-actions';

type Params = Promise<{ id: string }>;

const fmtTime = (d: Date | null) =>
  d
    ? d.toLocaleString('th-TH', {
        timeZone: 'Asia/Bangkok',
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—';

export default async function LiffAdminDisputeDetailPage({ params }: { params: Params }) {
  const { id } = await params;
  await requireLiffAdmin();

  const row = await prisma.attendance.findUnique({
    where: { id },
    select: {
      id: true,
      clockInAt: true,
      checkInStatus: true,
      disputeReason: true,
      checkInSelfieUrl: true,
      checkInLat: true,
      checkInLng: true,
      employee: { select: { firstName: true, lastName: true, nickname: true } },
      checkInBranch: { select: { name: true } },
    },
  });
  if (!row) notFound();

  const selfieUrl = await resolveStoredImageUrl(row.checkInSelfieUrl);
  const isPending = row.checkInStatus === 'Disputed';
  const lat = row.checkInLat?.toString();
  const lng = row.checkInLng?.toString();
  const name = `${row.employee.firstName} ${row.employee.lastName}`.trim();

  return (
    <main className="px-4 pt-4 pb-12">
      <header className="mb-4">
        <Link href="/liff/admin/inbox" className="text-sm text-gray-500 hover:text-gray-700">
          ← กลับไปงานรออนุมัติ
        </Link>
        <div className="mt-3 flex items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold text-gray-900">ลงเวลารอตรวจสอบ</h1>
          <span
            className={`rounded-full px-2.5 py-1 text-xs font-medium ${
              isPending ? 'bg-amber-100 text-amber-800' : 'bg-gray-100 text-gray-700'
            }`}
          >
            {isPending ? 'รอตรวจสอบ' : 'ตรวจสอบแล้ว'}
          </span>
        </div>
      </header>

      <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <p className="text-sm font-medium text-gray-900">
          {name}
          {row.employee.nickname && <span className="text-gray-500"> ({row.employee.nickname})</span>}
        </p>
        <dl className="mt-3 space-y-2 border-t border-gray-100 pt-3 text-sm">
          <Row label="เวลาเช็คอิน">{fmtTime(row.clockInAt)}</Row>
          {row.checkInBranch && <Row label="สาขา">{row.checkInBranch.name}</Row>}
          {row.disputeReason && (
            <Row label="เหตุที่ถูกตั้งข้อสงสัย">
              <span className="text-amber-700">{row.disputeReason}</span>
            </Row>
          )}
          {lat && lng && (
            <Row label="ตำแหน่ง">
              <a
                href={`https://www.google.com/maps?q=${lat},${lng}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary-600 underline"
              >
                เปิดแผนที่ →
              </a>
            </Row>
          )}
        </dl>
      </section>

      {selfieUrl && (
        <section className="mt-3 rounded-xl border border-gray-200 bg-gray-50 p-4">
          <h2 className="text-xs font-medium uppercase tracking-wide text-gray-500">รูปเช็คอิน</h2>
          <a
            href={selfieUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 block overflow-hidden rounded-lg border border-gray-200 transition hover:opacity-90"
          >
            {/* biome-ignore lint/performance/noImgElement: signed URL, short TTL — next/image can't optimize it */}
            <img src={selfieUrl} alt="รูปเช็คอิน" className="w-full" />
          </a>
        </section>
      )}

      {isPending ? (
        <DisputeReviewActions attendanceId={row.id} />
      ) : (
        <section className="mt-3 rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-600 shadow-sm">
          การเช็คอินนี้ได้รับการตรวจสอบแล้ว
        </section>
      )}
    </main>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="shrink-0 text-xs text-gray-500">{label}</dt>
      <dd className="text-right text-gray-900">{children}</dd>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + lint + build the route**

Run: `npx tsc --noEmit && npx biome check --write "src/app/(liff)/liff/admin/dispute/[id]/page.tsx" && npx next build 2>&1 | grep -E "Compiled successfully|liff/admin/dispute|Error:"`
Expected: tsc clean, biome clean, build shows `/liff/admin/dispute/[id]` and "Compiled successfully". (If `resolveStoredImageUrl`'s exact import path differs, confirm via `grep -rn "export.*resolveStoredImageUrl" src` — the leave page imports it from `@/lib/storage/signed-urls`.)

- [ ] **Step 3: Commit**

```bash
git add "src/app/(liff)/liff/admin/dispute/[id]/page.tsx"
git commit -m "feat(liff): disputed check-in mobile detail page (selfie + location + reason)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Repoint the inbox dispute link

**Files:**
- Modify: `src/app/(liff)/liff/admin/inbox/page.tsx`

**Interfaces:**
- Consumes: the new `/liff/admin/dispute/[id]` route (Task 2).

- [ ] **Step 1: Change the dispute ItemCard href**

In `src/app/(liff)/liff/admin/inbox/page.tsx`, the disputed section currently links each row to the web page. Find:

```tsx
              // v1: no LIFF dispute detail — link to the admin web page.
              <ItemCard key={r.id} href="/admin/attendance/disputed">
```

Replace with:

```tsx
              <ItemCard key={r.id} href={`/liff/admin/dispute/${r.id}`}>
```

(Remove the now-stale `// v1: no LIFF dispute detail` comment.)

- [ ] **Step 2: Typecheck + lint**

Run: `npx tsc --noEmit && npx biome check --write "src/app/(liff)/liff/admin/inbox/page.tsx"`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(liff)/liff/admin/inbox/page.tsx"
git commit -m "feat(liff): inbox disputed item opens the mobile detail, not the web

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Integration test — the dispute review reuse seam

**Files:**
- Create: `tests/integration/liff-dispute-review.integration.test.ts`

**Interfaces:**
- Consumes: `approveDisputed`, `rejectDisputed` (the actions the LIFF page wires to).

This locks the behavior the LIFF detail depends on: approving a Disputed check-in flips its `checkInStatus` away from `Disputed` (so it leaves the inbox). The page itself is presentational (the repo has no React render-test harness — verify the page via `next build` + a manual LIFF check), so this test targets the reuse seam.

- [ ] **Step 1: Write the test**

First confirm the success status the action sets: `grep -n "checkInStatus" src/lib/attendance/admin-review.ts` — use the value it writes on approve (e.g. `'Confirmed'`/`'Ok'`) in the assertion below; if the action sets a specific enum value, assert `not.toBe('Disputed')` to stay robust to the exact name. Create `tests/integration/liff-dispute-review.integration.test.ts`:

```ts
import { Prisma } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { approveDisputed, rejectDisputed } from '@/lib/attendance/admin-review';
import { prisma } from '@/lib/db/prisma';

async function reset() {
  await prisma.attendance.deleteMany({});
  await prisma.employee.deleteMany({});
  await prisma.user.deleteMany({});
  await prisma.branch.deleteMany({});
}
beforeEach(reset);
afterAll(async () => {
  await prisma.$disconnect();
});

async function seedDisputed() {
  const branch = await prisma.branch.create({ data: { name: 'B' } });
  const user = await prisma.user.create({ data: {} });
  const emp = await prisma.employee.create({
    data: {
      userId: user.id,
      firstName: 'A',
      lastName: 'B',
      branchId: branch.id,
      salaryType: 'Monthly',
      baseSalary: new Prisma.Decimal(20000),
      status: 'Active',
      hiredAt: new Date('2026-01-01'),
    },
  });
  return prisma.attendance.create({
    data: {
      employeeId: emp.id,
      date: new Date('2026-06-10'),
      type: 'CheckIn',
      source: 'Liff',
      clockInAt: new Date('2026-06-10T01:05:00Z'),
      checkInStatus: 'Disputed',
      disputeReason: 'นอกพื้นที่',
      createdById: user.id,
    },
  });
}

describe('disputed check-in review (LIFF reuse seam)', () => {
  it('approve flips the check-in out of Disputed', async () => {
    const att = await seedDisputed();
    const res = await approveDisputed({ attendanceId: att.id, note: '' });
    expect(res.ok).toBe(true);
    const after = await prisma.attendance.findUniqueOrThrow({ where: { id: att.id } });
    expect(after.checkInStatus).not.toBe('Disputed');
  });

  it('reject also resolves it (leaves the pending queue)', async () => {
    const att = await seedDisputed();
    const res = await rejectDisputed({ attendanceId: att.id, note: 'no' });
    expect(res.ok).toBe(true);
    const after = await prisma.attendance.findUniqueOrThrow({ where: { id: att.id } });
    expect(after.checkInStatus).not.toBe('Disputed');
  });
});
```

Note: adjust the seed `data` to satisfy required Attendance/Employee columns if the schema demands more (the implementer runs the test and fixes any missing-field errors; keep the assertions). If `approveDisputed` requires the attendance to have a recipient/notification target and errors without it, seed that linkage too (check `src/lib/attendance/admin-review.ts` for what it reads).

- [ ] **Step 2: Run it (RED then GREEN)**

Run: `npx vitest run --config vitest.integration.config.ts tests/integration/liff-dispute-review.integration.test.ts`
Expected: PASS (2 tests). If RED on a missing seed field, add it and re-run.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/liff-dispute-review.integration.test.ts
git commit -m "test(liff): disputed check-in approve/reject flips status out of Disputed

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Out of scope (later plans)

- **OT quick-approve** (next plan) — inbox OT section + `/liff/admin/overtime/[id]` quick approve-as-suggested / dismiss, via a new `{ok}`-returning LIFF action wrapping the OT create-entry + pricing logic.
- **Dashboard LIFF** (today) and **Report LIFF** (this month) — separate plans.
- **Rich-menu wiring** — dispatcher dests + setup-script tap areas; lands when admin LINE is re-enabled.

## Self-review

- Spec coverage: implements the spec's "disputed check-in" mobile-detail requirement (Part 1, item 4). OT (item 3) deliberately deferred to its own plan per the quick-approve decision; dashboard/report/wiring are separate phases.
- `DisputeReviewActions` name + `{ attendanceId }` prop are consistent between Task 1 (definition) and Task 2 (use). `approveDisputed`/`rejectDisputed` `({ attendanceId, note })` match `admin-review.ts`.
- No placeholders: every code step shows complete code; the one adjustable spot (exact `checkInStatus` success value in the test) is handled with a robust `not.toBe('Disputed')` assertion + a grep instruction.
