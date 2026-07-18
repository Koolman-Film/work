# เตือนพนักงานไม่มีตารางงาน + แสดงลาครึ่งวันให้ถูกต้อง — Design

**Date:** 2026-07-18
**Status:** Approved (design), pending implementation
**Author:** brainstormed with Claude

## Summary

แก้ปัญหาที่ลูกค้าแจ้ง 2 เรื่อง ซึ่งยืนยันแล้วว่าเป็นปัญหาจริง:

1. **ลาครึ่งวันแสดงเป็นลาเต็มวัน** — query ของปฏิทินและรายการลาไม่ได้ดึง
   `unit`/`startTime`/`endTime` มาด้วย ข้อมูลว่าเป็นครึ่งวันจึงไม่เคยเดินทาง
   ไปถึงหน้าจอ
2. **พนักงานที่ไม่ได้ตั้งตารางงาน ถูกนับเป็น จ–ส เงียบ ๆ** แล้วโดนแจ้งว่า
   "ยังไม่เช็คอิน" ในวันที่เขาไม่ต้องทำงาน โดยไม่มีที่ไหนบอกสาเหตุ

ไม่มี schema migration ไม่แตะสูตรเงินเดือน

## Context

### หลักฐานที่ยืนยันแล้ว

**เรื่องลาครึ่งวัน:** `getTeamCalendarData` (`src/lib/leave/team-calendar.ts:92-99`)
select เฉพาะ `id`/`employeeId`/`startDate`/`endDate`/`status`/`leaveType` และ
`liff/leave/page.tsx:70-78` ก็เช่นกัน ทั้งที่ `leaveDurationLabel(unit, ...)`
(`src/lib/leave/units.ts:180`) มีอยู่แล้วและหน้า inbox ของแอดมินใช้อยู่ถูกต้อง
— ปัญหาอยู่ที่ **query ไม่ได้ดึงข้อมูลมา** ไม่ใช่ที่ตรรกะการแสดงผล

**เรื่องตารางงาน:** `isScheduledWorkday` (`src/lib/attendance/schedule.ts:25-28`)
ตั้งใจ fallback เป็น จ–ส เมื่อ `scheduleDows` เป็น null/ว่าง โดยไม่แจ้งใคร

ข้อมูลจริงบน production (ตรวจแบบอ่านอย่างเดียว 18 ก.ค. 2569):

| ตารางงาน | วันทำงาน | พนักงาน |
|---|---|---|
| Mon–Sat 09:00–18:00 | จ,อ,พ,พฤ,ศ,ส | 46 |
| EMP-C จ. พ. ศ. | จ,พ,ศ | 1 |
| **(ไม่ได้ตั้ง)** | — → default จ–ส | **1** |

พนักงาน 1 คนที่ไม่ได้ตั้ง (ชื่อเล่น "โหน่ง", ชื่อยังเป็น ". ") ยัง `Active`
และ `canCheckIn=true` → **โดนแจ้งผิดทุกวันเสาร์อยู่ตอนนี้**

เคส "EMP-C" ที่ลูกค้าแจ้งไว้เดิม **ไม่ใช่บั๊กโค้ด** — ตารางถูกตั้งให้แล้ว
เมื่อ 18 มิ.ย. หลังจากที่แจ้ง และยังมีพนักงานอีกคนชื่อเล่น "แดง" ที่ทำงาน
จ–ส จริง

## Decision

### 1. ส่งข้อมูลหน่วยการลาไปให้ถึงหน้าจอ

ส่ง `unit` / `startTime` / `endTime` **ดิบ ๆ** ผ่าน `TeamCalendarEntry` แล้ว
ให้แต่ละหน้าจอจัดรูปแบบเอง — **จงใจไม่ส่งข้อความสำเร็จรูปจาก server**
เพราะ LIFF รองรับ 6 ภาษา แต่ฝั่งแอดมินถูก pin เป็นไทยแล้ว การส่งข้อมูลดิบ
ตรงกับที่ `leaveTypeName`/`nameByLocale` ทำอยู่แล้ว

แสดงใน **แผงรายละเอียดของวัน** และ **รายการลา** เท่านั้น —
**ไม่ใส่ในช่องเล็กของตารางปฏิทิน** เพราะพื้นที่ไม่พอและจะรก

### 2. helper กลางตัวเดียวสำหรับ "ใครไม่มีตารางงาน"

ทั้ง 4 จุดที่เตือนต้องเรียก `employeesWithoutSchedule(permitted)` ตัวเดียวกัน
**ห้ามให้แต่ละหน้านับเอง** — บทเรียนตรงจากบั๊ก badge-vs-list ที่เพิ่งเจอ
(นับคนละที่ด้วยเงื่อนไขคนละแบบ แล้วตัวเลขไม่ตรงกัน)

### 3. เตือน 4 จุด

| จุด | สิ่งที่แสดง |
|---|---|
| `/admin/employees` | แถบเตือนบนสุด + ป้ายที่แถวของคนนั้น |
| `/admin/attendance/live` | ป้ายข้างชื่อในรายการ "ยังไม่เช็คอิน" |
| แจ้งเตือนรายวัน (กระดิ่งในเว็บ) | พ่วงจำนวนเข้าไปในข้อความเดิม |
| ฟอร์มสร้างพนักงาน | บังคับเลือก + ตั้งค่าเริ่มต้นเป็นตารางที่ใช้มากสุด |

### 4. "บังคับเลือก" ต้องไม่แก้ข้อมูลเดิมโดยไม่ได้ตั้งใจ

- **ตอนสร้าง** — บังคับเลือก, ค่าเริ่มต้น = ตารางที่มีพนักงานใช้มากที่สุด
- **ตอนแก้ไขพนักงานเดิมที่เป็น null** — **ยังคงตัวเลือก "— ไม่ระบุ —" ไว้และ
  เลือกค้างไว้** พร้อมป้ายเตือน **ห้าม preselect ตารางอื่นให้อัตโนมัติ**
  เพราะการกดบันทึกฟิลด์อื่นจะกลายเป็นการเปลี่ยนตารางงานโดยที่แอดมินไม่รู้ตัว

## Non-goals (YAGNI)

- ไม่เพิ่มคอลัมน์ `isDefault` บน `WorkSchedule` (คำนวณจากจำนวนพนักงานแทน)
- ไม่แก้ `isScheduledWorkday` ให้เลิก fallback — ยังต้อง fallback เพื่อความ
  ต่อเนื่อง เราแค่ทำให้ "มองเห็น" ว่ากำลัง fallback อยู่
- ไม่ไล่แก้ข้อมูลพนักงานที่ตกหล่นให้อัตโนมัติ (แอดมินกดเองผ่านแถบเตือน)
- ไม่ใส่ป้ายครึ่งวันในช่องเล็กของตารางปฏิทิน
- ไม่แตะ LINE push / โควตา (คนละงาน)

## Architecture

### ส่วนที่ 1 — ลาครึ่งวัน

**`src/lib/leave/team-calendar-shape.ts`** — เพิ่มใน `TeamCalendarEntry`:

```ts
  /** หน่วยการลา — ใช้แยกครึ่งวันออกจากเต็มวันบนหน้าจอ */
  unit: 'FullDay' | 'HalfMorning' | 'HalfAfternoon' | 'Hourly';
  /** HH:MM เมื่อ unit==='Hourly'; null สำหรับหน่วยอื่น */
  startTime: string | null;
  endTime: string | null;
```

**`src/lib/leave/team-calendar.ts`** — เพิ่ม `unit: true, startTime: true,
endTime: true` ใน select ของ leave **ที่เดียว** คือใน `loadEntriesAndHolidays`
(บรรทัด 55, select ที่บรรทัด 92) แล้ว map ลง entry

ตรวจแล้วว่า `getTeamCalendarData` (บรรทัด 143) และ `getOrgCalendarData`
(บรรทัด 183) ต่างก็เรียกตัวโหลดร่วมตัวนี้ — **แก้จุดเดียวครอบคลุมปฏิทิน
ทั้งฝั่ง LIFF และฝั่งแอดมิน** ไม่ต้องแก้สองที่แล้วเสี่ยงหลุด

**`src/app/(liff)/liff/leave/page.tsx`** — เพิ่ม 3 ฟิลด์เดียวกันใน select
ของรายการลา

**การแสดงผล** — ส่วนต่อท้ายหลังชื่อประเภทการลา:

| unit | ไทย (แอดมิน) | LIFF |
|---|---|---|
| `FullDay` | *(ไม่แสดงอะไร)* | *(ไม่แสดงอะไร)* |
| `HalfMorning` | ครึ่งเช้า | `t('leave.halfMorning')` |
| `HalfAfternoon` | ครึ่งบ่าย | `t('leave.halfAfternoon')` |
| `Hourly` | `09:00–11:00` | เวลาเหมือนกัน (ตัวเลขไม่ต้องแปล) |

ต้องเพิ่ม key `halfMorning` / `halfAfternoon` ใน `messages/th.json` และ
`messages/en.json` (ภาษาอื่น fallback ตามกลไกเดิม)

จุดที่ต้องแก้การแสดงผล:
- `src/app/(liff)/liff/calendar/calendar-grid.tsx` — แผงรายละเอียดของวัน
- `src/app/(admin)/admin/_calendar/dashboard-calendar-summary.tsx:65` —
  ปัจจุบันคือ `` `${e.shortLabel} · ${e.leaveTypeName}` ``
- `src/app/(liff)/liff/leave/page.tsx` — แถวรายการลา

### ส่วนที่ 2 — helper กลาง

**`src/lib/employee/no-schedule.ts`** *(ใหม่)*

```ts
import 'server-only';

export type EmployeeMissingSchedule = {
  id: string;
  name: string;      // ชื่อเต็ม หรือชื่อเล่นถ้ามี
  branchName: string;
};

/**
 * พนักงานที่ยัง active และเช็คอินได้ แต่ไม่ได้ผูก WorkSchedule —
 * คนกลุ่มนี้จะถูก `isScheduledWorkday` นับเป็น จ–ส โดยปริยาย จึงอาจ
 * ถูกแจ้งว่า "ยังไม่เช็คอิน" ในวันที่จริง ๆ แล้วเขาไม่ต้องทำงาน
 *
 * แหล่งความจริงเดียวสำหรับทุกจุดที่เตือนเรื่องนี้ — อย่านับซ้ำที่อื่น
 */
export async function employeesWithoutSchedule(
  permitted: PermittedBranches,
): Promise<EmployeeMissingSchedule[]>;
```

เงื่อนไข: `archivedAt: null`, `status != 'Archived'`, `canCheckIn: true`,
`workScheduleId: null`, และกรองสาขาด้วย `employeeBranchScope(permitted)`
เหมือนหน้าอื่น ๆ

`canCheckIn: true` สำคัญ — พนักงานที่เช็คอินไม่ได้อยู่แล้วจะไม่ถูกแจ้งเตือน
จึงไม่ควรทำให้แอดมินตกใจ

### ส่วนที่ 3 — 4 จุดที่เตือน

**`/admin/employees`** (`page.tsx`)
- เรียก helper (branch-scoped ด้วย permitted เดิมของหน้านี้)
- ถ้ามี > 0 แสดงแถบเตือนเหนือตาราง (โทน amber ตาม pattern เดิมของโปรเจกต์):
  *"พนักงาน N คนยังไม่ได้ตั้งตารางงาน — ระบบจะนับเป็นทำงาน จ–ส และอาจแจ้งว่า
  ยังไม่เช็คอินผิดวัน"*
- ป้ายเล็กในคอลัมน์ชื่อของแถวนั้น: *"ไม่มีตารางงาน"*

**`/admin/attendance/live`**
- `RosterEmployee` เพิ่ม `hasSchedule: boolean`
- `live.ts` เซ็ตค่าจาก `workScheduleId != null` (ข้อมูลมีอยู่แล้วในการ query
  โรสเตอร์ ไม่ต้อง query เพิ่ม)
- ในรายการ "ยังไม่เช็คอิน" ถ้า `!hasSchedule` แสดงป้าย *"ไม่มีตารางงาน"*

**แจ้งเตือนรายวัน** (`src/lib/inngest/functions/attendance-late-check.ts`)
- เรียก helper แล้วส่ง `countWithoutSchedule` เพิ่มใน payload ของ
  `notifyAdminsInApp`
- ตัวเรนเดอร์ข้อความต่อท้ายเมื่อ > 0: *"(N คนในนี้ยังไม่ได้ตั้งตารางงาน)"*
- **ไม่กินโควตา LINE** — เส้นทางนี้เป็นกระดิ่งในเว็บ ไม่ใช่ LINE push

**ฟอร์มพนักงาน** (`employee-form.tsx` + `employee-schema.ts` + `page.tsx`)
- `page.tsx` ส่ง `defaultWorkScheduleId` = id ของตารางที่มีพนักงาน
  (ยัง active) ผูกอยู่มากที่สุด
- **โหมดสร้าง** (`initial == null`): `required` บน select, ตัด
  `— ไม่ระบุ —` ออก, `defaultValue = defaultWorkScheduleId`
- **โหมดแก้ไขที่ค่าเดิมเป็น null**: คง `— ไม่ระบุ —` ไว้และเลือกค้าง
  พร้อมข้อความเตือนใต้ช่อง; ไม่บังคับ เพื่อไม่ให้การบันทึกฟิลด์อื่นเปลี่ยน
  ตารางงานโดยไม่ตั้งใจ
- zod: บังคับเฉพาะตอนสร้าง (โหมดแก้ไขยังรับ null ได้)

## Testing

**Unit**
- `employeesWithoutSchedule` — คืนเฉพาะคนที่ active + `canCheckIn` +
  ไม่มีตาราง; คนที่ archived / เช็คอินไม่ได้ / มีตารางแล้ว ต้องไม่ติดมา;
  กรองสาขาถูกต้อง
- ตัวจัดรูปแบบหน่วยการลา — `FullDay` → ไม่มีส่วนต่อท้าย,
  `HalfMorning`/`HalfAfternoon` → คำที่ถูก, `Hourly` → ช่วงเวลา
- `team-calendar` — entry ที่คืนออกมามี `unit`/`startTime`/`endTime` ครบ
- ฟอร์มพนักงาน (zod) — โหมดสร้างไม่ยอมรับ `workScheduleId` ว่าง,
  โหมดแก้ไขยอมรับ

**Regression:** ชุดเทสต์ทั้งหมดต้องผ่าน (ปัจจุบัน 1271)

**Manual smoke**
- ยื่นใบลาครึ่งบ่าย → ปฏิทิน LIFF, ปฏิทินแอดมิน, รายการลา ต้องแสดง "ครึ่งบ่าย"
  ไม่ใช่ดูเหมือนเต็มวัน
- `/admin/employees` → เห็นแถบเตือน 1 คน (โหน่ง) + ป้ายที่แถว
- ตั้งตารางงานให้โหน่ง → แถบเตือนหายไป
- สร้างพนักงานใหม่ → ช่องตารางงานเลือกไว้ให้แล้วและเว้นว่างไม่ได้

## Reversibility

- ไม่มี schema change / migration
- helper ใหม่เป็น read-only ล้วน
- การเปลี่ยนแปลงที่เหลือคือ select เพิ่มฟิลด์ + การแสดงผล + validation
  ฝั่งฟอร์ม
- ไม่มีการเขียนหรือแก้ข้อมูลเดิมใด ๆ — ข้อ "บังคับตอนสร้าง" ออกแบบมาโดยเฉพาะ
  ให้ไม่แตะพนักงานเดิมที่เป็น null
- ย้อนกลับได้ด้วยการ revert commit เดียว
