# คีย์มือ: บันทึก "มาทำงานปกติ" — Design

**Date:** 2026-07-18
**Status:** Approved (design), pending implementation
**Author:** brainstormed with Claude

## Summary

หน้า `/admin/attendance/manual` (คีย์มือ) รองรับเฉพาะ `Absent | Late |
EarlyLeave` ทำให้ **ไม่มีทางบันทึกกรณี "มาทำงานปกติ แต่เช็คอินด้วย LINE ไม่ได้"**
(โทรศัพท์พัง/แบตหมด/เน็ตล่ม) งานนี้จัดโครงฟอร์มใหม่เป็น **มา / ไม่มา** โดยเมื่อ
"มา" ให้กรอกเวลาเข้า-ออก แล้วระบบสร้างแถว `CheckIn` (+ `Late` ถ้าสาย) ด้วย
**นโยบายเดียวกับ LIFF** พร้อมแผงเตือนก่อนบันทึกที่บอกชัดว่าจะเกิดอะไรขึ้น

ไม่มี schema migration ไม่แตะโค้ดคำนวณเงินเดือน

## Context

### ปัญหาที่พบ

- `createManualAttendance` (`src/lib/attendance/manual.ts:32`) รับแค่
  `'Absent' | 'Late' | 'EarlyLeave'` และคอมเมนต์ในไฟล์ตั้งใจตัด `CheckIn`
  ออกด้วยเหตุผล *"bypassing GPS verification defeats the purpose of geofence
  enforcement"*
- แต่ subtitle ของหน้า (`manual/page.tsx:45`) เขียนว่า *"ใช้เมื่อพนักงานไม่
  สามารถเช็คอินด้วย LINE ได้ — เช่น ป่วย, **ลืมโทรศัพท์**"* ซึ่ง "ลืมโทรศัพท์"
  คือเคสที่ **มาทำงาน** ชัดเจน → หน้าสัญญาเกินกว่าที่ฟอร์มทำได้

### ความเสี่ยงจริง

แอดมินที่ไม่มีตัวเลือกที่ถูกต้อง มีแนวโน้มกด **"ขาดงาน"** ซึ่ง `Absent`
**หักเงินจริง** (`calc.ts:377`) → พนักงานที่มาทำงานเต็มวันโดนหักเงินเพราะ
โทรศัพท์พัง นี่คือ mis-affordance ที่กลายเป็นบั๊กเรื่องเงิน

### สิ่งที่ *ไม่* เสียหาย (ตรวจแล้ว)

- ถ้าไม่บันทึกอะไรเลย **เงินไม่หาย** — `calcPayroll` คิดจากเงินเดือนเต็ม
  (`incomeBase = baseSalary`, ไม่มี proration) แล้วหักตาม `Absent`/`Late`/
  `EarlyLeave` เท่านั้น แถว `CheckIn` ไม่มีผลกับเงิน
- cron `attendance-late-check` **แค่แจ้งเตือนแอดมิน** ไม่ได้สร้างแถว `Absent`
- ผลที่เหลือคือ พนักงานค้างในรายการ "ยังไม่เช็คอิน" ตลอดไป และวันนั้นว่างเปล่า
  ในประวัติ/รายงาน — ไม่มีหลักฐานว่ามาทำงาน

### ข้อเท็จจริงที่กำหนดดีไซน์

1. **`CheckIn` กับ `Late` เป็นคนละแถว** — `check-in.ts:275-345` สร้างแถว
   `CheckIn` แล้ว *แยก* สร้างแถว `Late` ในทรานแซกชันเดียวกันเมื่อเกิน grace
   ดังนั้น "มาทำงาน" กับ "มาสาย" ไม่ขัดแย้งกัน ปุ่ม 3 ปุ่มแบบเลือกอย่างใด
   อย่างหนึ่งจึงผิดรูปแบบตั้งแต่ต้น
2. **`EarlyLeave` ไม่เคยถูกสร้างอัตโนมัติที่ใดเลย** — grep ทั้ง `src/` พบว่า
   มีแต่ `manual.ts` ที่สร้าง ที่เหลือเป็น read-only (รายงาน/payroll/แสดงผล)
   เส้นทาง LIFF เช็คเอาต์ **ไม่** สร้าง `EarlyLeave`
3. **เวลาออกไหลไป OT อัตโนมัติ** — `getOtCandidates` (`candidates.ts:57-60`)
   อ่าน `type:'CheckIn'` + `clockOutAt != null` โดยไม่กรอง `source` แถวคีย์มือ
   จึงโผล่เป็นผู้เข้าข่าย OT — ปลอดภัยเพราะ OT ต้องให้แอดมินกดอนุมัติอีกชั้น

## Decision

### 1. จัดโครงฟอร์มใหม่

```
พนักงาน + วันที่                     (เหมือนเดิม)
─────────────────────────────────
วันนั้นมาทำงานหรือไม่?  [ มาทำงาน ] [ ไม่มา ]
─────────────────────────────────
"มาทำงาน" →  เวลาเข้า *   เวลาออก (ถ้ามี)
"ไม่มา"   →  ขาดงาน (Absent)
─────────────────────────────────
หมายเหตุ: ทำไมต้องคีย์มือ
```

- **"มาสาย" หายไปจากปุ่ม** — คำนวณเองจากเวลาเข้า ด้วย policy เดียวกับ LIFF
- **"ออกก่อนเวลา" กลายเป็น opt-in checkbox** — แสดงเมื่อเวลาออก < เวลาเลิกงาน
  เท่านั้น **ไม่คำนวณอัตโนมัติ**
- **"ลา" ไม่มีในฟอร์ม** — `OnLeave` สร้างจากใบลาที่อนุมัติ (คงเดิม) แสดง hint
  ชี้ไปหน้าใบลาแทน

### 2. กฎทองของงานนี้

> **คีย์มือต้องให้ผลลัพธ์เท่ากับ "ถ้าโทรศัพท์ไม่พัง" — ไม่เข้มกว่า ไม่หย่อนกว่า**

จึงคำนวณ `Late` (เพราะ LIFF ทำ) แต่ไม่คำนวณ `EarlyLeave` (เพราะ LIFF ไม่ทำ)

### 3. เตือนก่อนบันทึก ไม่หักเงียบ

แผงพรีวิวสดใต้ช่องเวลา อัปเดตทันทีที่พิมพ์ แสดง **แถวที่จะถูกสร้างจริง**

### 4. ความสมบูรณ์ของ geofence: ติดป้าย ไม่ใช่ห้าม

ข้อกังวลเดิมใน `manual.ts` แก้ด้วยการทำให้แถวคีย์มือ **แยกออกได้โดยโครงสร้าง**:
`source='Manual'` + `createdById`=แอดมิน + พิกัด GPS ว่าง + `checkInStatus=null`
+ audit log ครบ เส้นทาง LIFF ยังบังคับ geofence เหมือนเดิมทุกประการ

## Non-goals (YAGNI)

- ไม่คำนวณ `EarlyLeave` อัตโนมัติ (จะทำให้คีย์มือเข้มกว่า LIFF)
- ไม่แตะ `calcPayroll` / `run.ts` / สูตรเงินเดือนใด ๆ
- ไม่แตะเส้นทาง LIFF เช็คอิน/เช็คเอาต์
- ไม่เพิ่มคอลัมน์/enum/migration
- ไม่รองรับคีย์มือ `OnLeave` (ยังคงมาจากใบลา)
- ไม่ทำ bulk/import หลายคนพร้อมกัน

## Architecture

### ไฟล์

| ไฟล์ | สถานะ | หน้าที่ |
|---|---|---|
| `src/lib/attendance/manual-preview.ts` | **ใหม่** | pure fn: เวลา+ตาราง+policy → แถวที่จะสร้าง |
| `src/lib/attendance/manual-preview.test.ts` | **ใหม่** | unit tests ของ pure fn |
| `src/lib/attendance/manual.ts` | แก้ | action ใหม่: ทรานแซกชันเดียว หลายแถว |
| `src/app/(admin)/admin/attendance/manual/manual-form.tsx` | แก้ | จัดโครง UI + แผงเตือนสด |
| `src/app/(admin)/admin/attendance/manual/page.tsx` | แก้ | ส่งตารางงาน + policy + rates ลงมา |

### `manual-preview.ts` — แหล่งความจริงเดียว

**เหตุผลที่ต้องมี:** ถ้า preview คำนวณเองแยกจาก server มันจะโกหกได้ — แสดงอย่าง
บันทึกอีกอย่าง ซึ่งเป็นบั๊กที่ทำลายความเชื่อถือมากที่สุดในระบบเงินเดือน
**ทั้ง client preview และ server action ต้องเรียกฟังก์ชันนี้ตัวเดียวกัน**

```ts
export type ManualPreviewInput = {
  kind: 'worked' | 'absent';
  /** HH:MM — required when kind==='worked' */
  clockIn?: string | null;
  /** HH:MM — optional */
  clockOut?: string | null;
  /**
   * Policy ที่ resolve มาแล้วโดยผู้เรียก ด้วย `resolveLatePolicy(...)` ตัวเดียว
   * กับ `check-in.ts:249` — `null` แปลว่าวันนั้นไม่ใช่วันทำงานตามตาราง จึง
   * ไม่คิดสาย (ตรงกับพฤติกรรม LIFF) จงใจไม่รับ schedule/grace/companyPolicy
   * แยกกัน เพื่อไม่ให้มีตรรกะ resolve ซ้ำสองที่แล้วเพี้ยนจากกัน
   */
  latePolicy: LatePolicy | null;
  /** HH:MM เวลาเลิกงานตามตาราง — ใช้คิด OT / EarlyLeave; null = ไม่มีตาราง */
  scheduledEndTime: string | null;
  /** วันหยุด → ยกเลิกการคิดสาย (ตรงกับ check-in.ts:255-265) */
  isOffDay: boolean;
  /** แอดมินติ๊ก "ยกเว้นการหักสายครั้งนี้" */
  exemptLate?: boolean;
  /** แอดมินติ๊ก "บันทึกเป็นออกก่อนเวลาด้วย" */
  recordEarlyLeave?: boolean;
};

export type PreviewRow = {
  type: 'CheckIn' | 'Absent' | 'Late' | 'EarlyLeave';
  durationMinutes: number | null;
};

export type ManualPreviewResult = {
  /** แถวที่จะถูกสร้างจริง เรียงตามลำดับที่จะ insert */
  rows: PreviewRow[];
  lateMinutes: number;
  earlyLeaveMinutes: number;
  /** นาทีเกินเวลาเลิกงาน — ใช้บอกว่าจะขึ้นเป็นผู้เข้าข่าย OT */
  otMinutes: number;
  /** ข้อความเตือนภาษาไทยสำหรับแผงพรีวิว */
  warnings: string[];
};
```

ใช้ `resolveLatePolicy` / `lateMinutesForCheckIn` / `hhmmToMinutes` เดิมจาก
`late-policy.ts` → ผลตรงกับ LIFF โดยอัตโนมัติ

### การแสดงจำนวนเงิน — จงใจไม่แสดงยอดหักของ "สาย"

`Late` คิดเงินแบบขั้นบันได (3-strike + severe-late, `computeLatePenalty`)
ซึ่งขึ้นกับ**จำนวนครั้งทั้งเดือน** ตอนรันเงินเดือน → พรีวิวคำนวณล่วงหน้าให้
ตรงไม่ได้ **การแสดงตัวเลขที่ผิดแย่กว่าไม่แสดง** ดังนั้น:

- `Absent` / `EarlyLeave` → แสดงยอดคงที่ต่อแถวจาก `PayrollConfig` ได้
- `Late` → แสดงเป็น **"มาสาย 45 นาที — จะถูกคิดหักตามนโยบายมาสายในรอบเงินเดือน
  (ขึ้นกับจำนวนครั้งในเดือนนั้น)"** ไม่ระบุตัวเลข ฿

### แผงเตือน (ตัวอย่าง)

```
⚠️ เวลาเข้า 09:45 — ช้ากว่าเวลาเข้างาน (09:00) 45 นาที
   → จะบันทึก "มาสาย 45 นาที" คิดหักตามนโยบายมาสายในรอบเงินเดือน
   ☐ ยกเว้นการหักครั้งนี้  (ต้องระบุเหตุผลในหมายเหตุ)

ℹ️ เวลาออก 19:30 — เกินเวลาเลิกงาน (18:00) 90 นาที
   → จะขึ้นเป็นผู้เข้าข่าย OT ที่แท็บ OT (ยังไม่จ่ายจนกว่าจะอนุมัติ)

จะบันทึก: [มาทำงาน 09:45–19:30] [มาสาย 45 นาที]
```

**"ยกเว้นการหัก" = ไม่สร้างแถว `Late` เลย** เหตุผลเก็บใน audit log + หมายเหตุ
เลือกแบบนี้เพราะ `calcPayroll` ไม่ได้อ่าน `isOverridden` (และ `run.ts` ไม่ได้
select มาด้วยซ้ำ) การจะให้ payroll ข้ามแถวที่ override ต้องแก้โค้ดคำนวณเงิน
ซึ่ง**เกินขอบเขตและเสี่ยงเกินไป**

*Trade-off ที่ยอมรับ:* รายงานจะไม่เห็นว่า "สายแต่ได้รับการยกเว้น" — ข้อเท็จจริง
นี้อยู่ใน audit log เท่านั้น ถ้าอนาคตต้องการให้เห็นในรายงาน ค่อยทำเป็น
phase 2 พร้อมแก้ payroll ให้เคารพ `isOverridden`

### `manual.ts` — action ใหม่

```ts
export type CreateManualInput = {
  employeeId: string;
  date: string;              // YYYY-MM-DD
  kind: 'worked' | 'absent';
  clockIn?: string | null;   // HH:MM, required when kind==='worked'
  clockOut?: string | null;  // HH:MM
  exemptLate?: boolean;
  exemptReason?: string | null;
  recordEarlyLeave?: boolean;
  note?: string | null;
};
```

ลำดับการทำงาน:

1. โหลด employee → branch gate (`canActOnEmployeeBranches`) — **คงเดิม**
2. `requirePermission('attendance.manual-create')` — **คงเดิม**
3. ตรวจ archived / รูปแบบวันที่ / วันอนาคต — **คงเดิม**
4. **ใหม่:** ตรวจรูปแบบ `HH:MM`, และ `clockOut > clockIn`
5. **ใหม่:** โหลด `WorkSchedule` ของ dow นั้น + `PayrollConfig` + เช็ควันหยุด
   (ตรรกะเดียวกับ `check-in.ts:232-265`)
6. เรียก `computeManualPreview(...)` → ได้ `rows`
7. **ใหม่ (สำคัญ):** ถ้ามี `CheckIn` อยู่แล้วสำหรับ (employee, date) ที่ยังไม่ถูกลบ
   → ปฏิเสธด้วย code `already-checked-in` — กันการสร้างซ้ำทับคนที่เช็คอินผ่าน
   LIFF ไปแล้ว
8. ตรวจซ้ำต่อ type เดิม (`duplicate`) สำหรับทุกแถวที่จะสร้าง
9. `prisma.$transaction` สร้างทุกแถวพร้อมกัน — `source:'Manual'`,
   `createdById`=admin, `clockInAt`/`clockOutAt` เป็น Bangkok-local → UTC,
   GPS fields = null
10. `auditLog` หนึ่งรายการต่อหนึ่งแถว + บันทึก `exemptLate`/`exemptReason`
11. `revalidatePath('/admin')`, `/admin/attendance`

### `page.tsx`

เปลี่ยนหัวข้อให้ตรงกับความจริง:

- title: `คีย์มือ — บันทึกการขาด/ลา/สาย` → **`คีย์มือ — บันทึกเวลาทำงาน`**
- subtitle: → **`ใช้เมื่อพนักงานเช็คอินด้วย LINE ไม่ได้ — เช่น โทรศัพท์พัง
  แบตหมด เน็ตล่ม หรือขาดงาน`**

ส่งเพิ่มลง client: ตารางงานต่อพนักงาน (dow → startTime/endTime + tolerance),
company late policy, รายการวันหยุด, และ flat rates ของ `Absent`/`EarlyLeave`

client เรียก `resolveLatePolicy(...)` **ฟังก์ชันเดียวกับที่ server เรียก** เพื่อ
แปลงข้อมูลดิบเหล่านี้เป็น `latePolicy` ตามพนักงาน+วันที่ที่เลือก แล้วส่งเข้า
`computeManualPreview(...)` — ทั้งสองฝั่งจึงเดินผ่านตรรกะชุดเดียวกันทั้งหมด
ไม่มีการคำนวณคู่ขนานที่เพี้ยนจากกันได้

## Behavior

| กรณี | แถวที่สร้าง | ผลต่อเงิน |
|---|---|---|
| มาทำงาน 09:00 (ตรงเวลา) | `CheckIn` | ไม่มี |
| มาทำงาน 09:45 (สาย, grace 15) | `CheckIn` + `Late(45)` | หักตามนโยบายมาสาย |
| มาทำงาน 09:45 + ติ๊กยกเว้น | `CheckIn` | ไม่มี (เหตุผลใน audit) |
| มาทำงาน วันหยุด/นอกตาราง | `CheckIn` | ไม่มี (ไม่คิดสาย ตรงกับ LIFF) |
| มาทำงาน + เวลาออก 19:30 | `CheckIn` (clockOut) | ขึ้นเป็นผู้เข้าข่าย OT รออนุมัติ |
| มาทำงาน + ติ๊กออกก่อนเวลา | `CheckIn` + `EarlyLeave(n)` | หักคงที่ต่อแถว |
| ไม่มา | `Absent` | หักคงที่ต่อแถว |
| มี `CheckIn` อยู่แล้ว | — | ปฏิเสธ `already-checked-in` |

## Testing

**Unit — `manual-preview.test.ts`** (pure fn ไม่ต้องแตะ DB):
- ตรงเวลา → เฉพาะ `CheckIn`
- สายเกิน grace → `CheckIn` + `Late` พร้อมนาทีถูกต้อง
- สายพอดี grace boundary (เท่ากับ grace) → ไม่สาย
- `isOffDay=true` → ไม่สร้าง `Late` แม้เวลาเกิน
- `exemptLate=true` → ตัดแถว `Late` ออก แต่ `CheckIn` ยังอยู่
- `latePolicy=null` (นอกวันทำงานตามตาราง) → ไม่สร้าง `Late` แม้เวลาเกิน
- `recordEarlyLeave=true` + clockOut < endTime → มี `EarlyLeave` พร้อมนาที
- `recordEarlyLeave=false` + clockOut < endTime → **ไม่มี** `EarlyLeave`
- clockOut > endTime → `otMinutes` > 0, ไม่มี `EarlyLeave`
- `kind='absent'` → เฉพาะ `Absent`

**Unit — `manual.ts`**:
- สร้างหลายแถวในทรานแซกชันเดียว, `source='Manual'`, GPS = null
- ปฏิเสธเมื่อมี `CheckIn` อยู่แล้ว (`already-checked-in`)
- ปฏิเสธ `clockOut <= clockIn`
- ปฏิเสธเวลารูปแบบผิด
- คง gate เดิม: branch scope, archived, future date, permission

**Regression:** `manual.branch.test.ts` เดิมต้องผ่าน (ปรับ input shape ตามใหม่)

**Manual smoke:** คีย์ "มาทำงาน" สาย → เห็นแผงเตือน → บันทึก → ตรวจว่าหลุดจาก
"ยังไม่เช็คอิน" และขึ้นในประวัติเป็น "มาทำงาน" + "มาสาย"

## Reversibility

- **ไม่มี** schema change / migration / enum ใหม่
- สร้างเฉพาะแถวของ type ที่มีอยู่แล้ว ด้วย `source='Manual'`
- ไม่แตะโค้ดคำนวณเงินเดือน, LIFF, cron
- ข้อมูลเก่าที่คีย์ด้วย 3 ปุ่มเดิมยังอ่านได้ปกติ (type เดิมทั้งหมด)
- ย้อนกลับได้ด้วยการ revert commit เดียว
