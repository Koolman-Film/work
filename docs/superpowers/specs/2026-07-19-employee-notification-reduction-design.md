# ลดข้อความแจ้งพนักงาน — Design

**Date:** 2026-07-19
**Status:** Approved (design), pending implementation
**Author:** brainstormed with Claude

## Summary

หลังจาก digest แอดมินขึ้น prod แล้ว (`ed166a3`) ก้อนที่ใหญ่ที่สุดที่เหลือคือ
การแจ้งพนักงาน 129-165 ข้อความ/เดือน งานนี้ลดลงอีก ~60-70 ด้วย 2 อย่าง:

1. **เลิกส่ง `attendance.dispute-approved`** — 99% ของการตัดสินคือ "ผ่านแล้ว
   ไม่มีอะไรผิด" ซึ่งพนักงานไม่ต้องทำอะไรต่อ
2. **รวม "อนุมัติเบิก" กับ "โอนเงินแล้ว" เป็นใบเดียว** เมื่อจ่ายเร็ว — ค่ากลาง
   ของช่วงห่างคือ **0 นาที** พนักงานจึงได้สองใบติดกันในนาทีเดียวกัน

ไม่มี schema migration ไม่แตะสูตรเงินเดือน

## Context

### ตัวเลขจริงจากตาราง `Notification`

| kind | ก.ค. | มิ.ย. | รวมทั้งหมด | สัดส่วน |
|---|---|---|---|---|
| `attendance.dispute-approved` | 38 | 51 | **90** | **98.9%** |
| `attendance.dispute-rejected` | 1 | 0 | 1 | 1.1% |
| `advance.approved` | 38 | 57 | 98 | 93.3% |
| `advance.rejected` | — | 5 | 7 | 6.7% |
| `advance.paid` | 21 | — | — | — |
| `leave.approved` | 31 | 47 | 81 | 92.0% |
| `leave.rejected` | — | 5 | 7 | 8.0% |

### ทำไม `dispute-approved` ถึงเป็นเป้าที่ถูกต้อง

**สัดส่วน 99:1** — เมื่อผลลัพธ์เกือบทั้งหมดเหมือนกัน การแจ้งแทบไม่ได้บอกอะไรใหม่
ข้อความที่มีค่าคือ 1% ที่ผลต่างออกไป (`dispute-rejected` = เช็คอินถูกตีตก
กระทบเวลาทำงานและเงิน — พนักงาน**ต้อง**รู้)

`dispute-approved` แปลว่า "เช็คอินของคุณผ่านแล้ว ไม่มีอะไรต้องทำ" — เป็นข้อความ
ปลอบใจ ไม่ใช่ข้อความที่ต้องลงมือ ต่างจาก `leave.rejected` (8%) และ
`advance.rejected` (6.7%) ที่เปลี่ยนแผนของพนักงานจริง

### ทำไมเบิกเงินถึงส่งซ้ำ

| | |
|---|---|
| เบิกที่ได้ทั้ง approved + paid | 21 |
| จ่ายภายใน 1 ชม. หลังอนุมัติ | 19 / 21 |
| จ่ายภายใน 24 ชม. | 21 / 21 |
| **ค่ากลางของช่วงห่าง** | **00:00 นาที** |

แอดมินกดอนุมัติแล้วกดจ่ายทันที พนักงานได้ LINE สองใบห่างกันไม่กี่วินาที
**นี่ไม่ใช่การประหยัดที่แลกกับ UX — ใบเดียวที่บอกครบดีกว่าสองใบซ้ำ**

## Decision

### 1. เลิกส่ง `dispute-approved` — เก็บ `dispute-rejected`

พนักงานยังดูสถานะเช็คอินได้ใน LIFF ตามปกติ และเดิมก็ไม่ต้องทำอะไรต่ออยู่แล้ว

**Trade-off ที่ยอมรับ:** คนที่ถูกโต้แย้งเช็คอินจะไม่ได้รับแจ้งว่าเรื่องจบแล้ว
บางคนอาจสงสัยว่าค้างอยู่หรือเปล่า — แลกกับ 38-51 ข้อความ/เดือน ถือว่าคุ้ม
เพราะกรณีที่*สำคัญจริง* (ถูกตีตก) ยังแจ้งอยู่

### 2. หน่วงการแจ้ง "อนุมัติเบิก" 15 นาที แล้วรวมกับ "โอนแล้ว"

- อนุมัติ → **ตั้งเวลาแจ้ง 15 นาที** (ไม่ส่งทันที)
- ครบ 15 นาที → อ่านสถานะล่าสุด:
  - จ่ายแล้ว → ส่ง **ใบเดียว "อนุมัติแล้ว · โอนเงินแล้ว"**
  - ยังไม่จ่าย → ส่ง "อนุมัติแล้ว" ตามเดิม
- `markAdvancePaid` → ส่ง "โอนแล้ว" **เฉพาะเมื่อผ่านไปเกิน 15 นาทีนับจากอนุมัติ**
  (ถ้าเร็วกว่านั้น ใบรวมครอบคลุมให้แล้ว)

**15 นาทีไม่กระทบพนักงานจริง** เพราะเงินไม่เข้าบัญชีเร็วกว่านั้นอยู่แล้ว และ
ข้อมูลที่ได้ครบกว่าเดิม

## ผลที่คาดการณ์

| | ก่อน | หลัง |
|---|---|---|
| admin digest | ~90 | ~90 |
| แจ้งพนักงาน | 165 | **~95** |
| สลิปเงินเดือน | 0 | 0 |
| **รวม (เดือนที่ยุ่ง)** | **~255 (85%)** | **~185 (62%)** |

ระยะปลอดภัยเพิ่มจาก ~45 เป็น ~115 ข้อความ

## Non-goals (YAGNI)

- ไม่แตะ `leave.approved` / `advance.approved` ที่เหลือ — เป็นผลการตัดสินที่
  พนักงานรออยู่ การหน่วงหรือยุบจะทำให้ข่าวที่เขารอมาช้าลง
- ไม่แตะ `leave.rejected` / `advance.rejected` / `dispute-rejected` — ข่าวที่
  เปลี่ยนแผนของพนักงาน ต้องเรียลไทม์
- ไม่ทำ digest ฝั่งพนักงาน
- ไม่แก้ schema

## Architecture

### ส่วน 1 — เลิกส่ง dispute-approved

**`src/lib/attendance/admin-review.ts:158-167`** — เปลี่ยนจากส่งเสมอ เป็นส่ง
เฉพาะเมื่อ `decision !== 'approve'`:

```ts
    // Only the reject case is pushed. 99% of dispute resolutions are
    // "approved" — i.e. "your check-in was fine, nothing to do" — which
    // carries no action for the employee and was 90 of the 91 dispute
    // notifications ever sent. Rejection changes their recorded hours and
    // their pay, so it still goes out immediately.
    if (result.ok && notifBox.data && decision !== 'approve') {
      await sendNotification(notifBox.data.recipientUserId, {
        kind: 'attendance.dispute-rejected',
        …
      });
    }
```

`attendance.dispute-approved` kind + template **คงไว้ก่อน 1 deploy cycle**
สำหรับ event ที่ค้างในคิว แล้วค่อยลบรอบหน้า

### ส่วน 2 — หน่วง + รวมข้อความเบิกเงิน

**Event ใหม่** ใน `src/lib/inngest/events.ts`:
```ts
/** Fired at approval; the notification itself is decided 15 min later. */
export type AdvanceApprovalDecidedEvent = {
  name: 'advance.approval-decided';
  data: { cashAdvanceId: string; recipientUserId: string };
};
```

**Notification kind ใหม่:** `advance.approved-and-paid` (ข้อความรวม)

**`src/lib/inngest/functions/advance-approval-notify.ts`** *(ใหม่)*
1. `step.sleep('settle-window', '15m')`
2. อ่าน `CashAdvance` ล่าสุด (`paidAt`, `amount`, `employee.firstName`, `status`)
3. ถูกยกเลิก/ลบ → ไม่ส่ง
4. `paidAt != null` → `advance.approved-and-paid`; ไม่งั้น → `advance.approved`

**`src/lib/advance/admin.ts`**
- `approveCashAdvance` — เปลี่ยนจาก `sendNotification(...'advance.approved')`
  เป็นยิง event `advance.approval-decided`
- `markAdvancePaid` — ส่ง `advance.paid` **เฉพาะเมื่อ**
  `paidAt − approvedAt >= 15 นาที` (ไม่งั้นใบรวมครอบคลุมแล้ว)

**หน้าต่าง 15 นาทีต้องเป็นค่าคงที่ตัวเดียวที่ใช้ร่วมกันทั้งสองที่** — ประกาศครั้งเดียว
แล้ว import ห้ามพิมพ์เลข 15 สองที่ ไม่งั้นวันหนึ่งจะเพี้ยนจากกันแล้วเกิดทั้งช่องว่าง
(ไม่มีใบไหนส่งเลย) หรือส่งซ้ำ

## Testing

**Unit**
- `admin-review` — decision `approve` → ไม่เรียก `sendNotification`;
  decision `reject` → เรียกด้วย kind `dispute-rejected`
- ตรรกะเลือกข้อความ (pure fn): `paidAt` มีค่า → `approved-and-paid`;
  เป็น null → `approved`; ถูกยกเลิก → ไม่ส่ง
- ตรรกะของ `markAdvancePaid`: ห่าง < 15 นาที → ไม่ส่ง `advance.paid`;
  ≥ 15 นาที → ส่ง
- ค่าคงที่หน้าต่างถูก import จากที่เดียว (ไม่มีเลขซ้ำ)

**Regression:** ชุดเทสต์ทั้งหมดต้องผ่าน (ฐาน 1331 unit + 118 integration)

## Reversibility

- ไม่มี schema change / migration
- ส่วน 1 คือการเพิ่มเงื่อนไข `if` — ย้อนกลับด้วยการลบเงื่อนไขออก
- ส่วน 2 เพิ่ม cron/function ใหม่ + เปลี่ยนจุดส่ง 2 จุด — ย้อนกลับด้วยการ
  เรียก `sendNotification` ตรง ๆ เหมือนเดิม
- ไม่มีคำสั่งเขียน/ลบข้อมูลใหม่ (นอกจาก Notification rows ตามปกติ)
- **ความเสี่ยงที่ต้องระวัง:** ถ้า deploy แล้ว function ใหม่ไม่ถูกลงทะเบียน
  การแจ้ง "อนุมัติเบิก" จะหายไปเงียบ ๆ — ต้องยืนยันการลงทะเบียนก่อน merge
