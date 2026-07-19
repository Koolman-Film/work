# หักขาดงาน/มาสาย ตามเงินเดือนรายคน — Design

**Date:** 2026-07-19
**Status:** Approved (design), pending implementation
**Author:** brainstormed with Claude

## Summary

ปัจจุบันการหัก "1 วัน" ใช้ค่าคงที่ **฿500 ค่าเดียวทั้งบริษัท** ไม่ว่าเงินเดือน
เท่าไร ทำให้พนักงาน **32 จาก 46 คนถูกหักเกินจริง** และคนที่โดนหนักสุดคือคน
เงินเดือนน้อยที่สุด งานนี้เปลี่ยนให้คิดจากเงินเดือนของแต่ละคน

**นี่คือการแตะสูตรเงินเดือนโดยตรง** — เป็นการเปลี่ยนที่มีความเสี่ยงสูงสุดใน
โค้ดเบสนี้ จึงต้องระมัดระวังเป็นพิเศษ

ไม่มี schema migration

## Context

### ลูกค้าขออะไร

> *"มาสายครบ 3 ครั้ง = **หักเงินหรือสิทธิ 1 วัน**"*
> *"ไม่กดลา = **หักเงินหรือสิทธิ 1 วัน**"*
> *"นาย EMP-B ... ระบบหักเงินเดือนแล้ว แต่**ยอดที่หักไม่สอดคล้องกับเงินเดือน**"*
> *"\*ทุกเงื่อนไขสามารถแก้ไขได้โดย admin\*"*

หน่วยที่ลูกค้าใช้คือ **"1 วัน"** ไม่ใช่จำนวนบาท และเขาไม่เคยระบุว่า 1 วันคิดอย่างไร

### สภาพจริงบน production

```
PayrollConfig.absentDeductionPerDay = ฿500  (ค่าเดียวทั้งบริษัท)

พนักงานรายเดือน 46 คน:
  32 คน  เงินเดือน ÷ 30 < ฿500  →  ถูกหักเกิน  ← พนักงานเสีย
  14 คน  เงินเดือน ÷ 30 > ฿500  →  ถูกหักน้อย  ← บริษัทเสีย
```

ตัวอย่าง: เงินเดือน ฿10,000 → วันละ ฿333 แต่ขาดงาน 1 วันถูกหัก ฿500
**เกินไป ฿167 (50%)** และคนกลุ่มนี้คือคนที่แบกรับได้น้อยที่สุด

### `dayAmount` ป้อนอะไรบ้าง

`calc.ts:392` คำนวณครั้งเดียวแล้วป้อน **4 ที่**:
1. หักขาดงาน (`dayAmount × absentCount`)
2. หักมาสายครบ N ครั้ง (`threeStrikeDays × dayAmount`)
3. หักสายรุนแรง (`severeDays × dayAmount`)
4. **breakdown ที่แสดงบนสลิป** (`perDay`, `perUnit`)

แก้ที่เดียวจึงครอบคลุมทั้งยอดหักและสิ่งที่พนักงานเห็นบนสลิป

### ความปลอดภัย — ตรวจแล้ว

`run.ts:315` — `if (row && row.status !== 'Draft') { frozen++; continue; }`

**การคำนวณใหม่ข้ามทุกแถวที่ `Published`/`Locked`** สลิปที่ออกไปแล้วจะไม่ถูก
แตะ ขอบเขตผลกระทบจำกัดอยู่ที่ draft ของรอบที่ยังไม่ปิดเท่านั้น

## Decision

### สูตรต่อคน

| salaryType | 1 วัน = | เหตุผล |
|---|---|---|
| `Monthly` | `baseSalary / 30` | มาตรฐานไทย และตรงกับคอมเมนต์ที่โค้ดเขียนไว้เอง |
| `Daily` | `baseSalary` | `baseSalary` ของเขา*คือ*ค่าแรงต่อวันอยู่แล้ว |
| `Hourly` | fallback | ไม่มีข้อมูลชั่วโมงมาตรฐานต่อวันในระบบ |
| คำนวณไม่ได้ (เช่นเงินเดือน ฿0) | fallback | ไม่เดาแทนคน |

**fallback = `PayrollConfig.absentDeductionPerDay` (฿500 เดิม)** — คงพฤติกรรม
เดิมสำหรับเคสที่คำนวณไม่ได้ และยังแก้ได้โดย admin ตามที่ลูกค้าขอ

### สิ่งที่ *ไม่* เปลี่ยน

- **`earlyLeaveDeduction` ยังเป็นค่าคงที่** — ลูกค้าไม่ได้พูดถึง "1 วัน" สำหรับ
  ออกก่อนเวลา และไม่ได้ร้องเรียนเรื่องนี้
- **`lateDeduction` (โหมด flat) ยังเป็นค่าคงที่** — ใช้เฉพาะเมื่อปิดกฎ 3 ครั้ง
  ซึ่งเป็นค่าปรับต่อครั้ง ไม่ใช่ "1 วัน"
- **ตัวหาร 30 เป็นค่าคงที่ในโค้ด ไม่ทำเป็น config** — ลูกค้าไม่ได้ขอ และการ
  เพิ่มปุ่มตั้งค่าที่ไม่มีใครขอคือการเดาอนาคต (บันทึกไว้เป็น follow-up ถ้าวันหนึ่ง
  ต้องการ)

### สิ่งที่จงใจไม่ทำในงานนี้

**"หักสิทธิแทนเงิน"** — ลูกค้าเขียนว่า *"หักเงิน**หรือสิทธิ**"* ซึ่งเป็นฟีเจอร์
ที่ระบบยังไม่มีเลย (ตอนนี้หักเงินอย่างเดียว) เป็นงานคนละชิ้น ขนาดใหญ่กว่ามาก
และต้องออกแบบว่าใครเลือก เลือกเมื่อไร บันทึกที่ไหน

## ผลกระทบที่ต้องแจ้งลูกค้า

**ยอดหักของพนักงาน 46 คนจะเปลี่ยนทันทีในรอบถัดไป** — ส่วนใหญ่จะ*ลดลง*
(32 คนเคยถูกหักเกิน) แต่ 14 คนจะถูกหัก*เพิ่ม*ขึ้น

**เรื่องที่ต้องให้ลูกค้าตัดสิน (ไม่อยู่ในงานนี้):** จะย้อนคืนเงินที่หักเกินไปแล้ว
ในรอบก่อน ๆ หรือไม่ — **สเปกนี้ไม่แตะข้อมูลย้อนหลังใด ๆ**

## Non-goals (YAGNI)

- ไม่แตะสลิปที่ `Published`/`Locked` แล้ว
- ไม่ย้อนแก้ยอดที่หักไปแล้ว
- ไม่ทำ "หักสิทธิแทนเงิน"
- ไม่ทำตัวหารเป็น config
- ไม่แก้ `earlyLeaveDeduction` / `lateDeduction`
- ไม่แก้ schema

## Architecture

**`src/lib/payroll/day-rate.ts`** *(ใหม่ — pure, ทดสอบง่าย)*

```ts
/**
 * What one day of an employee's pay is worth, for attendance deductions.
 *
 * The customer specifies penalties in DAYS ("หักเงินหรือสิทธิ 1 วัน"), never
 * in baht. Before this, every employee lost the same flat ฿500 regardless of
 * salary, which over-charged 32 of 46 people on production — hardest on the
 * lowest-paid, since a fixed amount is a bigger share of a smaller wage.
 *
 * Falls back to the configured flat amount rather than guessing whenever the
 * salary cannot produce a sane daily figure (Hourly staff, ฿0 base). The
 * fallback stays admin-editable, which the customer asked for explicitly.
 */
export const DAYS_PER_MONTH = 30;

export function dailyRateFor(
  employee: { salaryType: 'Monthly' | 'Daily' | 'Hourly'; baseSalary: string | number | Decimal },
  fallbackPerDay: string | number | Decimal,
): Decimal;
```

กติกา:
- `Monthly` และ `baseSalary > 0` → `baseSalary / DAYS_PER_MONTH`
- `Daily` และ `baseSalary > 0` → `baseSalary`
- อื่น ๆ → `toDec(fallbackPerDay)`

**`src/lib/payroll/calc.ts`** — เปลี่ยนบรรทัด 392 จาก
```ts
const dayAmount = toDec(cfg.absentDeductionPerDay);
```
เป็น
```ts
const dayAmount = dailyRateFor(input.employee, cfg.absentDeductionPerDay);
```

**ไม่ต้องแก้ที่อื่นเลย** — อีก 3 จุดที่ใช้ `dayAmount` (สายครบ N ครั้ง, สายรุนแรง,
breakdown บนสลิป) รับค่าใหม่โดยอัตโนมัติ

## Testing

**Unit — `day-rate.test.ts`**
- Monthly ฿30,000 → ฿1,000
- Monthly ฿10,000 → ฿333.33 (ตรวจการปัดทศนิยม)
- Monthly ฿0 → fallback
- Daily ฿450 → ฿450 (**ไม่ใช่ ฿15** — เคสที่หาร 30 แล้วผิดชัดเจน)
- Hourly → fallback
- ค่า fallback ถูกส่งต่อจาก config จริง ไม่ใช่เลข hardcode

**Unit — `calc.test.ts`**
- **พนักงานสองคนเงินเดือนต่างกัน ขาดงานเท่ากัน → ยอดหักต่างกัน**
  (เดิมเทสต์นี้จะ fail — เป็นตัวพิสูจน์บั๊ก)
- หักมาสายครบ 3 ครั้ง และสายรุนแรง ใช้ค่าเดียวกันกับขาดงาน
- `breakdown.attendance.absent.perDay` ตรงกับค่าที่คำนวณได้ต่อคน
- เทสต์เดิมทั้งหมดที่ยึดค่า ฿500 ต้องอัปเดตอย่าง**ตั้งใจ** — ทุกตัวที่แก้ต้อง
  อธิบายได้ว่าทำไมค่าใหม่ถูกต้อง **ห้ามแก้ตัวเลขให้ผ่านเฉย ๆ**

**Regression:** ชุดเทสต์ทั้งหมดต้องผ่าน (ฐาน 1353 unit + 118 integration)

**Manual verify:** คำนวณ draft ของเดือนปัจจุบันแล้วเทียบยอดหักของพนักงาน
เงินเดือน ฿10,000 กับ ฿25,000 ว่าต่างกันตามสัดส่วนจริง

## Reversibility

- ไม่มี schema change / migration
- **สลิปที่ `Published`/`Locked` ไม่ถูกแตะ** (guard ที่ `run.ts:315`)
- draft ที่คำนวณใหม่จะเปลี่ยนยอด — ตั้งใจ และคำนวณใหม่ได้เสมอ
- ย้อนกลับด้วยการ revert commit เดียว แล้วคำนวณ draft ใหม่ ยอดจะกลับไปเป็น ฿500
- **ไม่มีคำสั่งเขียน/ลบข้อมูลใหม่** — เปลี่ยนเฉพาะค่าที่ calc คืนออกมา
