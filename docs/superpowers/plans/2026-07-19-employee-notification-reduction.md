# Employee Notification Reduction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ลดข้อความแจ้งพนักงานจาก ~165 เหลือ ~95 /เดือน โดยเลิกส่งผลการตรวจสอบเช็คอินที่ "ผ่าน" และรวมข้อความ "อนุมัติเบิก + โอนแล้ว" เป็นใบเดียวเมื่อจ่ายเร็ว

**Architecture:** เพิ่มเงื่อนไขที่จุดส่ง dispute; หน่วงการแจ้งอนุมัติเบิก 15 นาทีด้วย Inngest function ใหม่ที่อ่านสถานะล่าสุดก่อนตัดสินใจว่าจะส่งข้อความแบบไหน

**Tech Stack:** Next.js 16, Inngest, Prisma/Postgres, Vitest (node env), next-intl, Biome

**Spec:** `docs/superpowers/specs/2026-07-19-employee-notification-reduction-design.md`

## Global Constraints

- **ห้ามแก้ schema / migration**
- **ห้ามแตะ `src/lib/payroll/**`**
- **ห้ามแตะการแจ้งที่เป็นข่าวร้าย** — `leave.rejected`, `advance.rejected`, `attendance.dispute-rejected` ต้องเรียลไทม์เหมือนเดิม เพราะเปลี่ยนแผนของพนักงาน
- **ห้ามแตะ `notifyAdminsInApp`** ที่ใดเลย
- **หน้าต่าง 15 นาทีต้องเป็นค่าคงที่ตัวเดียวที่ import ใช้ร่วมกัน** — ห้ามพิมพ์เลข 15 สองที่ ถ้าสองฝั่งเพี้ยนจากกันจะเกิดช่องว่าง (ไม่มีใบไหนส่งเลย) หรือส่งซ้ำ
- **ต้องลงทะเบียน Inngest function ใหม่** ใน `src/app/api/inngest/route.ts` — ถ้าลืม การแจ้ง "อนุมัติเบิก" จะหายไปเงียบ ๆ โดยที่เทสต์ยังเขียว
- Vitest รันบน **node** — ห้าม jsdom
- `pnpm test` ต้องผ่านทั้งหมดก่อนจบแต่ละ task (ฐาน 1331)

## File Structure

| ไฟล์ | สถานะ | หน้าที่ |
|---|---|---|
| `src/lib/attendance/admin-review.ts` | แก้ | ส่งเฉพาะกรณี reject |
| `src/lib/advance/settle-window.ts` | **สร้าง** | ค่าคงที่ 15 นาที + ตรรกะเลือกข้อความ (pure) |
| `src/lib/advance/settle-window.test.ts` | **สร้าง** | unit tests |
| `src/lib/inngest/events.ts` | แก้ | event ใหม่ + kind `advance.approved-and-paid` |
| `src/lib/line/flex-templates.ts` | แก้ | template ของข้อความรวม |
| `src/lib/inngest/functions/advance-approval-notify.ts` | **สร้าง** | หน่วง 15 นาที แล้วตัดสินใจ |
| `src/lib/advance/admin.ts` | แก้ | approve → ยิง event; paid → ส่งเฉพาะเมื่อเกินหน้าต่าง |
| `src/app/api/inngest/route.ts` | แก้ | ลงทะเบียน function ใหม่ |

---

### Task 1: เลิกส่งผลการตรวจสอบเช็คอินที่ "ผ่าน"

**Files:** Modify `src/lib/attendance/admin-review.ts`

**บริบท:** `attendance.dispute-approved` คือ 90 จาก 91 รายการที่เคยส่ง (98.9%) ข้อความบอกว่า "เช็คอินของคุณผ่านแล้ว ไม่มีอะไรต้องทำ" — ไม่มีการกระทำใดที่พนักงานต้องทำต่อ และไม่กระทบเงิน ส่วน `dispute-rejected` (1 รายการ) กระทบเวลาทำงานและเงินจริง จึงต้องคงไว้

- [ ] **Step 1: เขียนเทสต์ที่ยังไม่ผ่าน**

หา/สร้างไฟล์เทสต์ของ `admin-review` (ถ้ามีอยู่แล้วให้เพิ่มเข้าไป ใช้รูปแบบ mock เดิมของไฟล์นั้น ห้ามสร้าง harness ใหม่) แล้วเพิ่ม:

```ts
  it('approve → no LINE push (99% of resolutions carry no action for the employee)', async () => {
    // …arrange an approvable disputed check-in…
    await reviewDisputedCheckIn({ attendanceId: 'att-1', decision: 'approve', note: 'ok' });

    expect(mockedSend).not.toHaveBeenCalled();
  });

  it('reject → still pushes, with the rejected kind', async () => {
    // …arrange…
    await reviewDisputedCheckIn({ attendanceId: 'att-1', decision: 'reject', note: 'นอกพื้นที่' });

    expect(mockedSend).toHaveBeenCalledTimes(1);
    expect(mockedSend.mock.calls[0]![1]).toMatchObject({
      kind: 'attendance.dispute-rejected',
    });
  });
```

ปรับชื่อฟังก์ชัน/mock ให้ตรงกับของจริง — อ่านไฟล์ก่อนเขียน

- [ ] **Step 2: รันให้เห็นว่าไม่ผ่าน**

Run: `npx vitest run src/lib/attendance/` — เคส approve ต้อง FAIL (ตอนนี้ยังส่ง)

- [ ] **Step 3: เพิ่มเงื่อนไข**

ใน `src/lib/attendance/admin-review.ts` ราวบรรทัด 158:

```ts
    // Only rejection is pushed. 99% of dispute resolutions are "approved" —
    // "your check-in was fine, nothing to do" — which was 90 of the 91
    // dispute notifications ever sent and carries no action for the
    // employee. Rejection changes their recorded hours and their pay, so it
    // still goes out immediately.
    if (result.ok && notifBox.data && decision !== 'approve') {
```

เปลี่ยน `kind` จาก ternary เป็น `'attendance.dispute-rejected'` ตรง ๆ (สาขา approve ไม่มาถึงแล้ว)

**คง kind `attendance.dispute-approved` และ template ไว้** — event ที่ค้างในคิวตอน deploy ต้องยัง render ได้ ใส่คอมเมนต์ว่าลบได้หลังผ่าน 1 deploy cycle

- [ ] **Step 4: รันเทสต์ + gates**

Run: `npx vitest run src/lib/attendance/` แล้ว `npx tsc --noEmit && npx biome check --write` แล้ว `pnpm test`

- [ ] **Step 5: Commit**

```bash
git add src/lib/attendance/admin-review.ts src/lib/attendance/*.test.ts
git commit -m "feat(line): stop pushing dispute approvals, keep rejections"
```

---

### Task 2: รวม "อนุมัติเบิก" กับ "โอนแล้ว"

**Files:**
- Create: `src/lib/advance/settle-window.ts` + `.test.ts`
- Create: `src/lib/inngest/functions/advance-approval-notify.ts`
- Modify: `src/lib/inngest/events.ts`, `src/lib/line/flex-templates.ts`, `src/lib/advance/admin.ts`, `src/app/api/inngest/route.ts`

**บริบท:** 21 รายการได้ทั้ง approved และ paid, 19 ใน 21 จ่ายภายใน 1 ชม., **ค่ากลางของช่วงห่าง = 0 นาที** แอดมินกดอนุมัติแล้วกดจ่ายทันที พนักงานจึงได้ LINE สองใบห่างกันไม่กี่วินาที

- [ ] **Step 1: เขียนเทสต์ที่ยังไม่ผ่าน**

สร้าง `src/lib/advance/settle-window.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  SETTLE_WINDOW_MS,
  paidPushNeeded,
  pickApprovalKind,
} from './settle-window';

describe('SETTLE_WINDOW_MS', () => {
  it('is 15 minutes — the single source both sides must agree on', () => {
    expect(SETTLE_WINDOW_MS).toBe(15 * 60 * 1000);
  });
});

describe('pickApprovalKind', () => {
  it('paid by the time the window closes → one combined message', () => {
    expect(pickApprovalKind({ status: 'Approved', paidAt: new Date() })).toBe(
      'advance.approved-and-paid',
    );
  });

  it('not yet paid → the plain approval message', () => {
    expect(pickApprovalKind({ status: 'Approved', paidAt: null })).toBe('advance.approved');
  });

  it('no longer approved (cancelled/voided in the window) → send nothing', () => {
    expect(pickApprovalKind({ status: 'Cancelled', paidAt: null })).toBeNull();
  });
});

describe('paidPushNeeded', () => {
  const approvedAt = new Date('2026-07-19T10:00:00Z');

  it('paid inside the window → no separate push, the combined one covers it', () => {
    expect(
      paidPushNeeded({ approvedAt, paidAt: new Date('2026-07-19T10:05:00Z') }),
    ).toBe(false);
  });

  it('paid after the window → the approval message already went out, so push', () => {
    expect(
      paidPushNeeded({ approvedAt, paidAt: new Date('2026-07-19T10:20:00Z') }),
    ).toBe(true);
  });

  it('exactly at the boundary counts as outside — never leave the employee with no message', () => {
    expect(
      paidPushNeeded({ approvedAt, paidAt: new Date('2026-07-19T10:15:00Z') }),
    ).toBe(true);
  });

  it('missing approvedAt → push (fail toward telling the employee)', () => {
    expect(paidPushNeeded({ approvedAt: null, paidAt: new Date() })).toBe(true);
  });
});
```

เคสสองอันสุดท้ายสำคัญ: เมื่อไม่แน่ใจ ให้เลือกทางที่พนักงาน**ได้รับข้อความ** ดีกว่าเงียบ

- [ ] **Step 2: รันให้เห็นว่าไม่ผ่าน**

Run: `npx vitest run src/lib/advance/settle-window.test.ts` → FAIL (ยังไม่มีโมดูล)

- [ ] **Step 3: เขียน implementation**

สร้าง `src/lib/advance/settle-window.ts`:

```ts
/**
 * The gap between approving a cash advance and paying it out.
 *
 * Measured on production: of 21 advances that were both approved and paid,
 * 19 were paid within an hour and the MEDIAN gap was zero minutes — admins
 * approve and pay in the same click. That sent the employee two LINE
 * messages seconds apart ("approved", then "transferred"), which is both
 * wasteful against a 300/month cap and worse to read than one message
 * saying both.
 *
 * So the approval notice waits out this window, then reports whatever is
 * true by then. Both the delayed notifier and markAdvancePaid consult these
 * helpers — the window must never be written as a literal in two places, or
 * the two sides drift and the employee gets either nothing or a duplicate.
 */

export const SETTLE_WINDOW_MS = 15 * 60 * 1000;

/** Which approval message to send once the window closes; null = send none. */
export function pickApprovalKind(advance: {
  status: string;
  paidAt: Date | null;
}): 'advance.approved' | 'advance.approved-and-paid' | null {
  if (advance.status !== 'Approved') return null; // cancelled or voided meanwhile
  return advance.paidAt ? 'advance.approved-and-paid' : 'advance.approved';
}

/**
 * Does marking-paid still need its own push? Only when payment landed after
 * the approval notice had already gone out. Ambiguity resolves toward
 * sending: a duplicate message is a nuisance, silence is a failure.
 */
export function paidPushNeeded(a: { approvedAt: Date | null; paidAt: Date }): boolean {
  if (!a.approvedAt) return true;
  return a.paidAt.getTime() - a.approvedAt.getTime() >= SETTLE_WINDOW_MS;
}
```

- [ ] **Step 4: รันให้ผ่าน**

Run: `npx vitest run src/lib/advance/settle-window.test.ts` → PASS

- [ ] **Step 5: เพิ่ม event + kind + template**

`src/lib/inngest/events.ts`:
- เพิ่ม notification kind `advance.approved-and-paid` (ฟิลด์เดียวกับ `advance.approved`)
- เพิ่ม event `advance.approval-decided` พร้อม data `{ cashAdvanceId, recipientUserId }` และฟังก์ชันยิง event (ตามรูปแบบของ `sendNotification`)

`src/lib/line/flex-templates.ts` — เพิ่ม case ของ kind ใหม่ ข้อความไทยประมาณ
"อนุมัติแล้ว · โอนเงินแล้ว" พร้อมยอดเงิน (ใช้ template ของ `advance.paid` เป็นแบบ)

- [ ] **Step 6: เขียน Inngest function**

`src/lib/inngest/functions/advance-approval-notify.ts`:

```ts
export const advanceApprovalNotify = inngest.createFunction(
  { id: 'advance-approval-notify', retries: 3 },
  { event: 'advance.approval-decided' },
  async ({ event, step }) => {
    await step.sleep('settle-window', SETTLE_WINDOW_MS);

    const advance = await step.run('read-latest', () => /* prisma read */);
    if (!advance) return { sent: false, reason: 'not-found' };

    const kind = pickApprovalKind(advance);
    if (!kind) return { sent: false, reason: 'no-longer-approved' };

    await step.run('send', () => sendNotification(recipientUserId, { kind, … }));
    return { sent: true, kind };
  },
);
```

**ลงทะเบียนใน `src/app/api/inngest/route.ts`** — เพิ่มเข้า array `functions` ข้าง `adminDailyDigest` **ถ้าลืมขั้นนี้ การแจ้งอนุมัติเบิกจะหายไปเงียบ ๆ**

- [ ] **Step 7: ต่อสายที่ `admin.ts`**

- `approveCashAdvance` (ราวบรรทัด 210): เปลี่ยนจาก `sendNotification(... 'advance.approved')` เป็นยิง event `advance.approval-decided`
- `markAdvancePaid` (ราวบรรทัด 435): ห่อการส่ง `advance.paid` ด้วย `paidPushNeeded({ approvedAt: row.approvedAt, paidAt: <ที่เพิ่งเซ็ต> })`
  — ต้อง select `approvedAt` มาด้วยถ้ายังไม่มี

- [ ] **Step 8: ตรวจ gates**

Run: `npx tsc --noEmit && npx biome check --write` แล้ว `pnpm test` และ `pnpm test:integration`

ยืนยันการลงทะเบียน: `grep -n "advanceApprovalNotify" src/app/api/inngest/route.ts`

- [ ] **Step 9: Commit**

```bash
git add src/lib/advance src/lib/inngest src/lib/line src/app/api/inngest/route.ts
git commit -m "feat(line): merge advance approval and payout into one message"
```

---

## Verification (หลังครบทุก task)

- [ ] `pnpm test` + `pnpm test:integration` ผ่านทั้งหมด
- [ ] `npx tsc --noEmit` และ `npx biome check` สะอาด
- [ ] `git diff --name-only` ไม่มีไฟล์ใน `prisma/`
- [ ] `grep -n "advanceApprovalNotify" src/app/api/inngest/route.ts` — ต้องเจอ
- [ ] `grep -rn "15 \* 60 \* 1000\|SETTLE_WINDOW" src/ | grep -v test` — เลข 15 นาทีต้องปรากฏที่เดียว
- [ ] ประเมินปริมาณใหม่: digest ~90 + แจ้งพนักงาน ~95 + สลิป 0 ≈ **185/300**
