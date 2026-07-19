# Per-Employee Day Rate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ให้การหัก "1 วัน" (ขาดงาน / มาสายครบ N ครั้ง / สายรุนแรง) คิดจากเงินเดือนของพนักงานแต่ละคน แทนค่าคงที่ ฿500 ที่ใช้ทั้งบริษัท

**Architecture:** เพิ่ม pure function `dailyRateFor(employee, fallback)` แล้วเปลี่ยน `dayAmount` ใน `calc.ts` บรรทัดเดียว — อีก 3 จุดที่ใช้ค่านี้รับผลอัตโนมัติ

**Tech Stack:** Prisma/Postgres, decimal.js, Vitest (node env), Biome

**Spec:** `docs/superpowers/specs/2026-07-19-per-employee-day-rate-design.md`

## Global Constraints

- **นี่คือการแตะสูตรเงินเดือน — เป็นการเปลี่ยนที่เสี่ยงสุดในโค้ดเบสนี้** ทุกขั้นต้องพิสูจน์ได้
- **ห้ามแก้ schema / migration**
- **ห้ามแตะ `run.ts:315`** (guard ที่กันสลิป `Published`/`Locked`) — เป็นสิ่งเดียวที่ทำให้งานนี้ปลอดภัย
- **ห้ามแตะข้อมูลย้อนหลัง** — ไม่แก้ยอดที่หักไปแล้ว ไม่เขียนอะไรลง DB
- **ห้ามเปลี่ยน `earlyLeaveDeduction` และ `lateDeduction`** — ลูกค้าไม่ได้พูดถึงและไม่ได้ร้องเรียน
- **ห้ามทำตัวหาร 30 เป็น config** — ลูกค้าไม่ได้ขอ
- **ห้ามทำ "หักสิทธิแทนเงิน"** — งานคนละชิ้น
- **การแก้เทสต์เดิม: ทุกตัวเลขที่เปลี่ยนต้องอธิบายได้ว่าทำไมค่าใหม่ถูก** ห้ามแก้ให้ผ่านเฉย ๆ — ถ้าคำนวณแล้วไม่ตรงกับที่แผนระบุ **ให้หยุดแล้วรายงาน อย่าปรับตัวเลขตาม output**
- Vitest รันบน **node**
- `pnpm test` ต้องผ่านทั้งหมดก่อนจบแต่ละ task (ฐาน 1353)

## File Structure

| ไฟล์ | สถานะ | หน้าที่ |
|---|---|---|
| `src/lib/payroll/day-rate.ts` | **สร้าง** | pure fn คำนวณค่าหนึ่งวันต่อคน |
| `src/lib/payroll/day-rate.test.ts` | **สร้าง** | unit tests |
| `src/lib/payroll/calc.ts` | แก้ **1 บรรทัด** | `dayAmount` ใช้ค่าต่อคน |
| `src/lib/payroll/calc.test.ts` | แก้ | อัปเดตค่าที่ยึด ฿500 + เพิ่มเทสต์พิสูจน์บั๊ก |

---

### Task 1: `dailyRateFor` — pure function

**Files:** Create `src/lib/payroll/day-rate.ts`, `src/lib/payroll/day-rate.test.ts`

**Interfaces:** Produces `DAYS_PER_MONTH`, `dailyRateFor(employee, fallbackPerDay): Decimal` — Task 2 เรียกใช้

- [ ] **Step 1: เขียนเทสต์ที่ยังไม่ผ่าน**

สร้าง `src/lib/payroll/day-rate.test.ts`:

```ts
import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { DAYS_PER_MONTH, dailyRateFor } from './day-rate';

const FALLBACK = '500';

describe('DAYS_PER_MONTH', () => {
  it('is 30 — the Thai convention this codebase already assumed in comments', () => {
    expect(DAYS_PER_MONTH).toBe(30);
  });
});

describe('dailyRateFor — Monthly', () => {
  it('divides the monthly salary by 30', () => {
    expect(
      dailyRateFor({ salaryType: 'Monthly', baseSalary: '30000' }, FALLBACK).toString(),
    ).toBe('1000');
  });

  it('keeps precision on a non-round result', () => {
    // ฿10,000/30 = 333.333… — this is the employee the flat ฿500 over-charged by 50%
    const r = dailyRateFor({ salaryType: 'Monthly', baseSalary: '10000' }, FALLBACK);
    expect(r.toDecimalPlaces(2).toString()).toBe('333.33');
  });

  it('falls back when the salary is zero rather than deducting nothing', () => {
    expect(dailyRateFor({ salaryType: 'Monthly', baseSalary: '0' }, FALLBACK).toString()).toBe(
      '500',
    );
  });
});

describe('dailyRateFor — Daily', () => {
  it('uses baseSalary as-is: it IS the day rate', () => {
    // Dividing by 30 here would yield ฿15 — the mistake this case exists to prevent
    expect(dailyRateFor({ salaryType: 'Daily', baseSalary: '450' }, FALLBACK).toString()).toBe(
      '450',
    );
  });
});

describe('dailyRateFor — Hourly and bad data', () => {
  it('falls back for Hourly — no standard hours-per-day exists in the system', () => {
    expect(dailyRateFor({ salaryType: 'Hourly', baseSalary: '100' }, FALLBACK).toString()).toBe(
      '500',
    );
  });

  it('uses whatever fallback the caller passes, not a hardcoded 500', () => {
    expect(dailyRateFor({ salaryType: 'Hourly', baseSalary: '100' }, '250').toString()).toBe('250');
  });

  it('accepts a Decimal for either argument', () => {
    expect(
      dailyRateFor(
        { salaryType: 'Monthly', baseSalary: new Decimal('30000') },
        new Decimal('500'),
      ).toString(),
    ).toBe('1000');
  });
});
```

- [ ] **Step 2: รันให้เห็นว่าไม่ผ่าน**

Run: `npx vitest run src/lib/payroll/day-rate.test.ts`
Expected: FAIL — `Cannot find module './day-rate'`

- [ ] **Step 3: เขียน implementation**

สร้าง `src/lib/payroll/day-rate.ts` — ใช้ helper `toDec` แบบเดียวกับ `calc.ts` (อ่าน `calc.ts` ก่อนแล้ว import หรือทำซ้ำให้เหมือน อย่าประดิษฐ์วิธีแปลงใหม่):

```ts
import Decimal from 'decimal.js';

/**
 * What one day of an employee's pay is worth, for attendance deductions.
 *
 * The customer specifies penalties in DAYS ("หักเงินหรือสิทธิ 1 วัน"), never in
 * baht. Before this, everyone lost the same flat ฿500 whatever they earned,
 * which over-charged 32 of 46 people on production — hardest on the lowest
 * paid, since a fixed amount is a bigger share of a smaller wage. Someone on
 * ฿10,000 lost ฿500 for a day actually worth ฿333.
 *
 * Falls back to the configured flat amount rather than guessing whenever the
 * salary cannot produce a sane daily figure. The fallback stays
 * admin-editable, which the customer asked for explicitly.
 */

export const DAYS_PER_MONTH = 30;

export type DayRateEmployee = {
  salaryType: 'Monthly' | 'Daily' | 'Hourly';
  baseSalary: string | number | Decimal;
};

export function dailyRateFor(
  employee: DayRateEmployee,
  fallbackPerDay: string | number | Decimal,
): Decimal {
  const base = new Decimal(employee.baseSalary as Decimal.Value);
  const fallback = new Decimal(fallbackPerDay as Decimal.Value);

  if (!base.isFinite() || base.lte(0)) return fallback;

  switch (employee.salaryType) {
    case 'Monthly':
      return base.dividedBy(DAYS_PER_MONTH);
    case 'Daily':
      // baseSalary IS the day rate here — dividing would be an order-of-
      // magnitude error (฿450 → ฿15).
      return base;
    default:
      // Hourly: the system stores no standard hours-per-day, so any divisor
      // would be invented. Defer to the admin-set figure.
      return fallback;
  }
}
```

- [ ] **Step 4: รันให้ผ่าน**

Run: `npx vitest run src/lib/payroll/day-rate.test.ts` → PASS ทุกเคส

- [ ] **Step 5: Commit**

```bash
git add src/lib/payroll/day-rate.ts src/lib/payroll/day-rate.test.ts
git commit -m "feat(payroll): compute what one day of pay is worth per employee"
```

---

### Task 2: ต่อเข้า `calc.ts` + อัปเดตเทสต์เดิม

**Files:** Modify `src/lib/payroll/calc.ts` (1 บรรทัด), `src/lib/payroll/calc.test.ts`

**บริบท:** `calc.ts:392` คำนวณ `dayAmount` ครั้งเดียวแล้วป้อน 4 ที่ — หักขาดงาน, หักมาสายครบ N ครั้ง, หักสายรุนแรง, และ breakdown ที่แสดงบนสลิป **แก้จุดเดียวครอบคลุมหมด**

- [ ] **Step 1: เพิ่มเทสต์ที่พิสูจน์บั๊ก (ต้อง fail ก่อนแก้)**

เพิ่มใน `src/lib/payroll/calc.test.ts`:

```ts
describe('calcPayroll — a day off costs a day of YOUR pay', () => {
  const absent = [{ date: '2026-05-04', type: 'Absent' as const }];

  it('two salaries, same absence, different deduction', () => {
    const low = calcPayroll(
      baseInput({
        employee: { id: 'e', salaryType: 'Monthly', baseSalary: '10000', hasSso: false },
        attendances: absent,
      }),
    );
    const high = calcPayroll(
      baseInput({
        employee: { id: 'e', salaryType: 'Monthly', baseSalary: '60000', hasSso: false },
        attendances: absent,
      }),
    );

    expect(low.deductAttendance.toString()).not.toBe(high.deductAttendance.toString());
    // 10000/30 = 333.33…, 60000/30 = 2000
    expect(low.deductAttendance.toDecimalPlaces(2).toString()).toBe('333.33');
    expect(high.deductAttendance.toString()).toBe('2000');
  });

  it('the slip breakdown shows the same per-day figure it charged', () => {
    const out = calcPayroll(
      baseInput({
        employee: { id: 'e', salaryType: 'Monthly', baseSalary: '30000', hasSso: false },
        attendances: absent,
      }),
    );
    expect(out.breakdown.attendance.absent.perDay.toString()).toBe('1000');
  });
});
```

- [ ] **Step 2: รันให้เห็นว่าไม่ผ่าน**

Run: `npx vitest run src/lib/payroll/calc.test.ts`
Expected: เคสใหม่ FAIL — ทั้งสองเงินเดือนได้ ฿500 เท่ากัน (นี่คือบั๊กที่กำลังแก้)

- [ ] **Step 3: แก้ `calc.ts` — บรรทัดเดียว**

บรรทัด 392 เปลี่ยนจาก:
```ts
  const dayAmount = toDec(cfg.absentDeductionPerDay);
```
เป็น:
```ts
  // One "day" is a day of THIS employee's pay, not a company-wide flat rate.
  // The customer writes penalties as "หักเงินหรือสิทธิ 1 วัน"; the old flat
  // ฿500 over-charged 32 of 46 people on production. Feeds absences, the
  // N-strikes penalty, severe lateness, AND the slip breakdown — one place.
  const dayAmount = dailyRateFor(input.employee, cfg.absentDeductionPerDay);
```

**ห้ามแก้ที่อื่นใน `calc.ts`**

- [ ] **Step 4: อัปเดตเทสต์เดิมที่ยึดค่า ฿500**

fixture ของไฟล์ใช้ `baseSalary: '30000'` → วันละ **฿1,000** (ไม่ใช่ ฿500) ค่าที่ต้องเปลี่ยน:

| บรรทัด | เดิม | ใหม่ | ที่มา |
|---|---|---|---|
| ~113 | `'1500'` | `'3000'` | 3 ขาดงาน × ฿1,000 |
| ~140 | `'700'` | `'1200'` | 1 ขาดงาน ฿1,000 + 2 สาย × ฿100 |
| ~187 | `'1100'` | `'2100'` | 2 ขาดงาน ฿2,000 + 1 × ฿100 |
| ~408 | `'500'` | `'1000'` | 3-strike = 1 วัน = ฿1,000 |
| ~427 | `'500'` | `'1000'` | สายรุนแรง = 1 วัน |
| ~439 | `'200'` | **ไม่เปลี่ยน** | ฿100 flat × 2 — `lateDeduction` ไม่ได้แก้ |

**ยืนยันแต่ละบรรทัดด้วยการอ่าน input ของเทสต์นั้นก่อนแก้** ตัวเลขข้างบนคือสิ่งที่*ควรจะเป็น* ถ้ารันแล้วได้ค่าอื่น **ให้หยุดและรายงาน — อย่าปรับให้ตรงกับ output** เพราะนั่นแปลว่าเข้าใจอะไรผิดอยู่

เทสต์ที่ตรวจว่าผลรวมย่อยเท่ากับ `deductAttendance` (~461) ควรผ่านเองโดยไม่ต้องแก้ — ถ้าไม่ผ่าน แปลว่ามีจุดที่ยังใช้ค่าเก่าอยู่

- [ ] **Step 5: รันเทสต์ + gates**

Run: `npx vitest run src/lib/payroll/` แล้ว `npx tsc --noEmit && npx biome check --write` แล้ว `pnpm test` และ `pnpm test:integration`

- [ ] **Step 6: ยืนยันว่าไม่แตะสิ่งต้องห้าม**

```bash
git diff --name-only | grep -E "^prisma/" && echo "FAIL: แตะ prisma"
git diff src/lib/payroll/run.ts | head -1   # ต้องว่าง
grep -c "dailyRateFor" src/lib/payroll/calc.ts   # ต้องเป็น 2 (import + ใช้งาน)
```

- [ ] **Step 7: Commit**

```bash
git add src/lib/payroll/calc.ts src/lib/payroll/calc.test.ts
git commit -m "fix(payroll): charge attendance penalties against the employee's own day rate"
```

---

## Verification (หลังครบทุก task)

- [ ] `pnpm test` + `pnpm test:integration` ผ่านทั้งหมด
- [ ] `npx tsc --noEmit` และ `npx biome check` สะอาด
- [ ] `git diff --name-only main..HEAD` — ไม่มี `prisma/`, ไม่มี `run.ts`
- [ ] ไม่มีคำสั่ง `create`/`update`/`delete` ใหม่ใน diff
- [ ] ทุกตัวเลขที่แก้ในเทสต์เดิมมีเหตุผลกำกับ ไม่ใช่ปรับตาม output
