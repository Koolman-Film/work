# LINE Quota Reduction (Digest) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ลดข้อความ LINE จาก ~464/เดือน เหลือ ~220/เดือน โดยรวมการแจ้งแอดมินเป็น digest วันละครั้ง 09:30, เลิก push สลิปเงินเดือน, และใส่ตัวกันโควตาหมด

**Architecture:** cron ใหม่ถามสถานะของค้าง ณ 09:30 แล้วส่งสรุปใบเดียวต่อแอดมิน; ลบการเรียก fan-out เรียลไทม์ 5 จุด; helper เช็คโควตาแบบ fail-open คั่นก่อน push

**Tech Stack:** Next.js 16, Inngest, Prisma/Postgres, Vitest (node env), next-intl, Biome

**Spec:** `docs/superpowers/specs/2026-07-19-line-quota-digest-design.md`

## Global Constraints

- **ห้ามแก้ schema / migration**
- **ห้ามแตะ `src/lib/payroll/calc.ts`** หรือสูตรการคำนวณเงินใด ๆ (แตะได้เฉพาะการ *เรียกแจ้งเตือน* ใน `run.ts`)
- **ห้ามลบหรือแก้ `notifyAdminsInApp` ที่ใดเลย** — กระดิ่งในเว็บฟรีและต้องเรียลไทม์เหมือนเดิม
- **ตัวกันโควตาต้อง fail-open** — ถ้าเช็คโควตาไม่ได้ ต้องปล่อยให้ push ต่อ ห้ามให้ตัวกันกลายเป็นตัวบล็อก
- **endpoint `/v2/bot/message/quota` และ `/quota/consumption` ไม่กินโควตา** — เรียกได้ปลอดภัย
- recipient predicate ของ digest ต้อง**ใช้ฟังก์ชันเดียวกัน**กับ `notifyAdminsOnLine` ห้าม copy เงื่อนไข
- Vitest รันบน **node** — ห้าม jsdom / testing-library
- ข้อความถึงแอดมินเป็นภาษาไทย (LIFF admin ใช้ `t()` ตามเดิมถ้าอยู่ในเส้นทางนั้น)
- `pnpm test` ต้องผ่านทั้งหมดก่อนจบแต่ละ task (ฐาน 1316)

## File Structure

| ไฟล์ | สถานะ | หน้าที่ |
|---|---|---|
| `src/lib/line/quota.ts` | **สร้าง** | เช็คโควตาคงเหลือ (cache + fail-open) |
| `src/lib/line/quota.test.ts` | **สร้าง** | unit tests |
| `src/lib/inngest/functions/line-push.ts` | แก้ | คั่นตัวกันโควตาก่อน push |
| `src/lib/notifications/pending-counts.ts` | **สร้าง** | ย้ายตัวนับของค้างออกจาก app/ ให้ lib ใช้ร่วมได้ |
| `src/app/(admin)/_load-badge-counts.ts` | แก้ | re-export จากที่ใหม่ (คงพฤติกรรมเดิม) |
| `src/lib/notifications/admin-line.ts` | แก้ | แยก recipient predicate ออกมา export |
| `src/lib/inngest/events.ts` | แก้ | เพิ่ม kind `admin.daily-digest` |
| `src/lib/line/flex-templates.ts` | แก้ | template ของ digest |
| `src/lib/inngest/functions/admin-daily-digest.ts` | **สร้าง** | cron 09:30 |
| `src/lib/inngest/functions/admin-daily-digest.test.ts` | **สร้าง** | unit tests |
| `src/lib/inngest/client.ts` (หรือที่ register functions) | แก้ | ลงทะเบียน cron ใหม่ |
| `src/lib/leave/actions.ts`, `src/lib/advance/actions.ts`, `src/lib/advance/admin.ts`, `src/lib/attendance/check-in.ts` | แก้ | ลบการเรียก `notifyAdminsOnLine` |
| `src/lib/payroll/run.ts` | แก้ | ลบการเรียก `notifyPublishedSlips` |

---

### Task 1: ตัวกันโควตาหมด

**Files:**
- Create: `src/lib/line/quota.ts`, `src/lib/line/quota.test.ts`
- Modify: `src/lib/inngest/functions/line-push.ts`

**Interfaces:**
- Produces: `remainingQuota()`, `hasQuotaHeadroom()`, `QUOTA_RESERVE`

**บริบท:** เดือนนี้โควตาหมดแล้วระบบเงียบไปโดยไม่มีใครรู้ จนกระทั่งมีคนสังเกตเอง ตัวนี้ทำให้การหมดโควตา *มองเห็นได้*

- [ ] **Step 1: เขียนเทสต์ที่ยังไม่ผ่าน**

สร้าง `src/lib/line/quota.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetQuotaCache, hasQuotaHeadroom, QUOTA_RESERVE, remainingQuota } from './quota';

const mockFetch = (quota: number, used: number) =>
  vi.fn(async (url: string) =>
    url.endsWith('/consumption')
      ? { ok: true, json: async () => ({ totalUsage: used }) }
      : { ok: true, json: async () => ({ type: 'limited', value: quota }) },
  ) as unknown as typeof fetch;

beforeEach(() => {
  __resetQuotaCache();
  vi.stubEnv('LINE_MESSAGING_CHANNEL_ACCESS_TOKEN', 'test-token');
});

describe('remainingQuota', () => {
  it('returns quota minus usage', async () => {
    vi.stubGlobal('fetch', mockFetch(300, 120));
    expect(await remainingQuota()).toBe(180);
  });

  it('returns null when the API fails — callers must not be blocked', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500 })) as unknown as typeof fetch);
    expect(await remainingQuota()).toBeNull();
  });

  it('returns null when fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network'); }) as unknown as typeof fetch);
    expect(await remainingQuota()).toBeNull();
  });
});

describe('hasQuotaHeadroom', () => {
  it('true when remaining is above the reserve', async () => {
    vi.stubGlobal('fetch', mockFetch(300, 300 - QUOTA_RESERVE - 1));
    expect(await hasQuotaHeadroom()).toBe(true);
  });

  it('false when remaining is at or below the reserve', async () => {
    vi.stubGlobal('fetch', mockFetch(300, 300 - QUOTA_RESERVE));
    expect(await hasQuotaHeadroom()).toBe(false);
  });

  it('FAILS OPEN — true when the quota cannot be read at all', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network'); }) as unknown as typeof fetch);
    expect(await hasQuotaHeadroom()).toBe(true);
  });
});
```

เคสสุดท้ายสำคัญที่สุด — ตัวกันต้องไม่กลายเป็นตัวบล็อกเมื่อมันเองพัง

- [ ] **Step 2: รันให้เห็นว่าไม่ผ่าน**

Run: `npx vitest run src/lib/line/quota.test.ts`
Expected: FAIL — `Cannot find module './quota'`

- [ ] **Step 3: เขียน implementation**

สร้าง `src/lib/line/quota.ts`:

```ts
import 'server-only';

/**
 * LINE monthly message-quota headroom.
 *
 * The free plan allows 300 pushes/month and simply rejects everything after
 * that — silently, from the app's point of view. In July 2026 the account hit
 * the cap and every notification stopped for days before anyone noticed. This
 * module exists so we notice.
 *
 * Both endpoints used here are metadata calls and do NOT themselves consume
 * quota, so polling them is free.
 *
 * FAIL-OPEN BY DESIGN: every failure path returns null / true. A guard that
 * blocks delivery when it cannot read the quota would turn a LINE API blip
 * into a total notification outage — strictly worse than the problem it
 * guards against.
 */

/** Messages held back for genuinely urgent late-month sends. */
export const QUOTA_RESERVE = 30;

const CACHE_MS = 5 * 60 * 1000;
let cache: { at: number; remaining: number | null } | null = null;

/** Test-only: clear the module-level cache between cases. */
export function __resetQuotaCache(): void {
  cache = null;
}

async function fetchJson(path: string, token: string): Promise<unknown | null> {
  try {
    const res = await fetch(`https://api.line.me/v2/bot/message/${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/** Remaining sends this month, or null when it cannot be determined. */
export async function remainingQuota(): Promise<number | null> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.remaining;

  const token = process.env.LINE_MESSAGING_CHANNEL_ACCESS_TOKEN;
  if (!token) return null;

  const [quota, consumption] = await Promise.all([
    fetchJson('quota', token),
    fetchJson('quota/consumption', token),
  ]);

  const limit =
    quota && typeof quota === 'object' && typeof (quota as { value?: unknown }).value === 'number'
      ? (quota as { value: number }).value
      : null;
  const used =
    consumption &&
    typeof consumption === 'object' &&
    typeof (consumption as { totalUsage?: unknown }).totalUsage === 'number'
      ? (consumption as { totalUsage: number }).totalUsage
      : null;

  const remaining = limit != null && used != null ? limit - used : null;
  cache = { at: Date.now(), remaining };
  return remaining;
}

/** True when there is room to send. Unknown quota → true (fail open). */
export async function hasQuotaHeadroom(): Promise<boolean> {
  const remaining = await remainingQuota();
  if (remaining == null) return true;
  return remaining > QUOTA_RESERVE;
}
```

- [ ] **Step 4: รันให้ผ่าน**

Run: `npx vitest run src/lib/line/quota.test.ts`
Expected: PASS ทุกเคส

- [ ] **Step 5: คั่นก่อน push**

ใน `src/lib/inngest/functions/line-push.ts` ก่อน step `push-to-line` เพิ่ม:

```ts
    // Quota gate. Skipping is a normal outcome, not a failure — do NOT throw,
    // or Inngest will retry a send we deliberately declined.
    const hasRoom = await step.run('check-quota', () => hasQuotaHeadroom());
    if (!hasRoom) {
      logger.warn(`skipping push: LINE quota headroom exhausted (notification ${notification.id})`);
      await step.run('mark-quota-skipped', async () => {
        await notifyAdminsInApp({
          kind: 'system.line-quota-low',
          notificationId: notification.id,
        });
      });
      return { notificationId: notification.id, delivered: false, reason: 'quota-exhausted' };
    }
```

ถ้า `notifyAdminsInApp` ยังไม่มี kind นี้ ให้เพิ่มเข้าไปในชนิดของกระดิ่ง (ฝั่ง in-app เท่านั้น ไม่ใช่ LINE) พร้อมข้อความไทยสั้น ๆ ว่าโควตา LINE ใกล้หมด

**อย่าแจ้งซ้ำทุกข้อความ** — ถ้าง่ายกว่า ให้แจ้งเฉพาะครั้งแรกที่เจอในแต่ละวัน (เช็คจาก Notification ที่มี kind นี้วันนี้)

- [ ] **Step 6: ตรวจ gates + commit**

Run: `npx tsc --noEmit && npx biome check --write` บนไฟล์ที่แก้ แล้ว `pnpm test`

```bash
git add src/lib/line/quota.ts src/lib/line/quota.test.ts src/lib/inngest/functions/line-push.ts
git commit -m "feat(line): stop pushing when the monthly quota runs out, and say so"
```

---

### Task 2: Digest แอดมินวันละครั้ง 09:30

**Files:**
- Create: `src/lib/notifications/pending-counts.ts`
- Modify: `src/app/(admin)/_load-badge-counts.ts`
- Modify: `src/lib/notifications/admin-line.ts`
- Modify: `src/lib/inngest/events.ts`, `src/lib/line/flex-templates.ts`
- Create: `src/lib/inngest/functions/admin-daily-digest.ts` + `.test.ts`
- Modify: wherever Inngest functions are registered

**บริบท:** ตัวนับของค้างอยู่ที่ `src/app/(admin)/_load-badge-counts.ts` ซึ่งเป็น app/ dir — Inngest function อยู่ใน lib/ การ import ข้าม layer แบบนั้นไม่สวยและอาจติด bundling ให้**ย้ายตรรกะไป `src/lib/notifications/pending-counts.ts`** แล้วให้ไฟล์เดิม re-export เพื่อไม่ให้หน้าเว็บพัง

- [ ] **Step 1: ย้ายตัวนับของค้าง**

ย้าย `loadSidebarBadgeCounts` ทั้งฟังก์ชันไป `src/lib/notifications/pending-counts.ts` (ชื่อใหม่ `loadPendingCounts` ก็ได้ แต่ต้อง re-export ชื่อเดิมด้วย) แล้วใน `_load-badge-counts.ts` เหลือแค่:

```ts
export { loadPendingCounts as loadSidebarBadgeCounts } from '@/lib/notifications/pending-counts';
```

รัน `pnpm test` ทันทีเพื่อยืนยันว่าหน้าเว็บยังทำงานเหมือนเดิมก่อนไปต่อ

- [ ] **Step 2: แยก recipient predicate**

ใน `src/lib/notifications/admin-line.ts` ดึงเงื่อนไข `where` ของ `prisma.user.findMany` (บรรทัด ~19-38) ออกมาเป็น:

```ts
/** Admins who can receive LINE pushes: archived-free, LINE-linked, and holding
 *  liff.admin (or Superadmin). Shared with the daily digest so the two can
 *  never target different people. */
export async function linePushAdminIds(): Promise<string[]>;
```

แล้วให้ `notifyAdminsOnLine` เรียกใช้ **ห้าม copy เงื่อนไขไปไว้สองที่**

- [ ] **Step 3: เพิ่ม notification kind + template**

`src/lib/inngest/events.ts` — เพิ่มเข้า `NotificationPayload`:

```ts
  | {
      kind: 'admin.daily-digest';
      /** Pending counts scoped to this admin's branches. */
      leave: number;
      advance: number;
      attendance: number;
    }
```

`src/lib/line/flex-templates.ts` — เพิ่ม case สำหรับ kind นี้ ข้อความไทยประมาณ:
หัวข้อ "สรุปงานค้างวันนี้" · บรรทัด "คำขอลา {leave} · คำขอเบิก {advance} · ต้องตรวจสอบ {attendance}" · ปุ่มลิงก์ไป `/liff/admin`
**แสดงเฉพาะบรรทัดที่ค่ามากกว่า 0** — บรรทัดที่เป็น 0 ไม่ต้องแสดง

- [ ] **Step 4: เขียนเทสต์ของตรรกะ digest**

แยกการตัดสินใจ "ส่งหรือไม่ส่ง" เป็น pure function เพื่อทดสอบได้บน node:

```ts
// src/lib/inngest/functions/admin-daily-digest.ts
export function shouldSendDigest(c: { leave: number; advance: number; attendance: number }): boolean {
  return c.leave + c.advance + c.attendance > 0;
}
```

`admin-daily-digest.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { shouldSendDigest } from './admin-daily-digest';

describe('shouldSendDigest', () => {
  it('skips when nothing is pending — silent days must cost nothing', () => {
    expect(shouldSendDigest({ leave: 0, advance: 0, attendance: 0 })).toBe(false);
  });

  it.each([
    ['leave only', { leave: 1, advance: 0, attendance: 0 }],
    ['advance only', { leave: 0, advance: 2, attendance: 0 }],
    ['disputes only', { leave: 0, advance: 0, attendance: 3 }],
  ])('sends when %s is pending', (_label, counts) => {
    expect(shouldSendDigest(counts)).toBe(true);
  });
});
```

- [ ] **Step 5: เขียน cron**

`src/lib/inngest/functions/admin-daily-digest.ts`:

```ts
/**
 * Daily 09:30 digest of what is waiting for each admin.
 *
 * Replaces the per-event LINE fan-out, which cost one message per admin per
 * request and was 65% of July's 464-message spend against a 300/month cap.
 *
 * Reports STATE, not events: it asks what is pending right now rather than
 * replaying yesterday. That needs no stored state and never re-reports work
 * an admin already cleared overnight.
 */
export const adminDailyDigest = inngest.createFunction(
  { id: 'admin-daily-digest', retries: 2 },
  { cron: 'TZ=Asia/Bangkok 30 9 * * *' },
  async ({ step, logger }) => { /* … */ },
);
```

ในตัวฟังก์ชัน: `linePushAdminIds()` → ต่อคน `getUserAssignments(id)` → `loadPendingCounts(assignments)` → `shouldSendDigest` → `sendNotification(id, { kind: 'admin.daily-digest', ...counts })`

**ลงทะเบียน function ใหม่** ที่เดียวกับที่ cron ตัวอื่นถูกลงทะเบียน (ดู `attendance-late-check` เป็นตัวอย่าง) — **ถ้าลืมขั้นนี้ cron จะไม่ทำงานเลยโดยที่เทสต์ยังเขียว**

- [ ] **Step 6: ตรวจ gates + commit**

Run: `npx tsc --noEmit && npx biome check --write` แล้ว `pnpm test`

```bash
git add src/lib/notifications src/lib/inngest src/lib/line "src/app/(admin)/_load-badge-counts.ts"
git commit -m "feat(line): daily 09:30 admin digest replacing per-event fan-out"
```

---

### Task 3: ลบ fan-out เรียลไทม์

**Files:** `src/lib/leave/actions.ts`, `src/lib/advance/actions.ts`, `src/lib/advance/admin.ts`, `src/lib/attendance/check-in.ts`, `src/lib/payroll/run.ts`

**ทำหลัง Task 2 เสมอ** — ต้องมี digest ใช้งานได้ก่อนจึงจะถอดของเดิมออก

- [ ] **Step 1: ลบการเรียก `notifyAdminsOnLine` ทั้ง 4 จุด**

- `src/lib/leave/actions.ts:310`
- `src/lib/advance/actions.ts:163`
- `src/lib/advance/admin.ts:584`
- `src/lib/attendance/check-in.ts:404`

ลบ import ที่ไม่ใช้แล้วด้วย **คง `notifyAdminsInApp` ที่อยู่ติดกันไว้ทุกจุด** — กระดิ่งในเว็บยังต้องเรียลไทม์

ใส่คอมเมนต์สั้น ๆ ตรงที่ลบ ว่าการแจ้งแอดมินย้ายไป digest 09:30 แล้ว ไม่งั้นคนอ่านทีหลังจะนึกว่าลืมใส่

- [ ] **Step 2: ลบ push สลิปเงินเดือน**

ใน `src/lib/payroll/run.ts` ลบการเรียก `notifyPublishedSlips` พร้อมคอมเมนต์ว่าพนักงานดูสลิปจาก rich menu แทน

ถ้าฟังก์ชัน `notifyPublishedSlips` ไม่มีใครเรียกแล้ว **ให้ลบทิ้งด้วย** อย่าทิ้งโค้ดตายไว้

- [ ] **Step 3: ยืนยันว่าไม่มี fan-out หลงเหลือ**

Run: `grep -rn "notifyAdminsOnLine\|notifyPublishedSlips" src/ | grep -v test`
Expected: เจอเฉพาะใน `admin-line.ts` (นิยาม) และ digest — ไม่มีการเรียกแบบ per-event

- [ ] **Step 4: ตรวจ gates + commit**

Run: `npx tsc --noEmit && npx biome check --write` แล้ว `pnpm test` และ `pnpm test:integration`

```bash
git commit -am "feat(line): drop per-event admin fan-out and the payslip broadcast"
```

---

## Verification (หลังครบทุก task)

- [ ] `pnpm test` + `pnpm test:integration` ผ่านทั้งหมด
- [ ] `npx tsc --noEmit` และ `npx biome check` สะอาด
- [ ] `git diff --name-only` ไม่มีไฟล์ใน `prisma/`
- [ ] cron ใหม่ถูกลงทะเบียนจริง (ปรากฏในรายการ functions ที่ Inngest serve)
- [ ] `grep -rn "notifyAdminsInApp" src/ | grep -v test` — ยังครบทุกจุดเหมือนเดิม
- [ ] ประเมินปริมาณใหม่: admin 3 คน × ~20 วัน ≈ 60 + แจ้งพนักงาน ~165 + สลิป 0 ≈ **225/300**
