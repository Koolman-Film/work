# LIFF Custom Date Range + Dispute-Queue Triage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ให้พนักงานเลือกช่วงวันที่เองในหน้ารายงาน LIFF และทำให้คิว "ต้องตรวจสอบ" คัดแยกได้ว่าแต่ละแถวติดธงเพราะอะไร พร้อมเลิกตัดรายการแบบเงียบ

**Architecture:** ต่อ `from`/`to` เข้าหน้า LIFF summary (backend `resolveReportPeriod` รองรับอยู่แล้ว) ด้วย `DateRangeField` ที่มีอยู่; ให้ loader ของคิวคืนจำนวนรวมมาด้วยและแสดงเหตุผลในรายการ

**Tech Stack:** Next.js 16 App Router, Prisma/Postgres, Vitest (node env — ไม่มี jsdom), Tailwind v4, next-intl (6 ภาษา), Biome

**Spec:** `docs/superpowers/specs/2026-07-18-liff-custom-range-and-dispute-triage-design.md`

## Global Constraints

- **ห้ามแก้ schema / migration** — งานนี้เป็นการอ่านและแสดงผลล้วน
- **ห้ามเขียนข้อมูล** — ไม่มี `create`/`update`/`delete` ใหม่ในทั้งสอง task
- **ห้ามแตะ `resolveReportPeriod`** (`src/lib/reports/period.ts`) หรือ validation ของมัน — มันตรวจ `from`/`to` เองครบแล้ว การเพิ่มการตรวจซ้ำที่หน้าเพจจะกลายเป็นตรรกะสองที่ที่เพี้ยนจากกันได้
- **ห้ามเพิ่มการแจ้งเตือนทาง LINE ใด ๆ** — โควตาเต็ม 300/300 อยู่
- **where ของ `findMany` กับ `count` ต้องมาจากตัวแปรเดียวกัน** ห้ามเขียนซ้ำสองที่ — นี่คือรากของบั๊ก badge-vs-list ที่กำลังแก้
- ฝั่ง LIFF ใช้ `t()` เพิ่ม key ที่ `messages/th.json` + `en.json` เท่านั้น (ภาษาอื่น fallback อัตโนมัติ)
- ฝั่งแอดมินเป็นภาษาไทยตรง ๆ ไม่ผ่าน `t()`
- Vitest รันบน **node** — ไม่มี jsdom / testing-library
- `pnpm test` ต้องผ่านทั้งหมดก่อนจบแต่ละ task (ฐานปัจจุบัน 1301)

## File Structure

| ไฟล์ | สถานะ | หน้าที่ |
|---|---|---|
| `src/app/(liff)/liff/summary/period-url.ts` | **สร้าง** | pure fn สร้าง URL ของตัวเลือกช่วง (ทดสอบได้) |
| `src/app/(liff)/liff/summary/period-url.test.ts` | **สร้าง** | unit tests |
| `src/app/(liff)/liff/summary/period-picker.tsx` | **สร้าง** | client: สลับโหมดรายเดือน ↔ ช่วงเอง |
| `src/app/(liff)/liff/summary/page.tsx` | แก้ | รับ `from`/`to`, ใช้ PeriodPicker แทน navigator เดิม |
| `messages/th.json`, `messages/en.json` | แก้ | key ใหม่ใต้ `summary` |
| `src/app/(admin)/admin/attendance/disputed/_load-inbox.ts` | แก้ | คืน `{ rows, total }` จาก where เดียวกัน |
| `src/app/(admin)/admin/attendance/disputed/_load-inbox.test.ts` | **สร้าง** | unit tests |
| `src/app/(admin)/admin/attendance/disputed/page.tsx` | แก้ | ส่ง `total` ต่อ, ใช้ `total` เป็น disputedCount |
| `src/app/(admin)/admin/attendance/disputed/disputed-client.tsx` | แก้ | แสดงเหตุผลในรายการ + ระยะทางเฉพาะเมื่อมี + แถบบอกการตัดรายการ |

---

### Task 1: ช่วงวันที่เองในหน้ารายงาน LIFF

**Files:**
- Create: `src/app/(liff)/liff/summary/period-url.ts`
- Create: `src/app/(liff)/liff/summary/period-url.test.ts`
- Create: `src/app/(liff)/liff/summary/period-picker.tsx`
- Modify: `src/app/(liff)/liff/summary/page.tsx`
- Modify: `messages/th.json`, `messages/en.json`

**Interfaces:**
- Consumes: `resolveReportPeriod`, `adjacentMonths` จาก `@/lib/reports/period`; `DateRangeField` จาก `@/components/ui/date-range-field`
- Produces: หน้าเว็บที่ใช้งานได้ (ไม่มี task อื่นเรียกใช้ต่อ)

**บริบท:** `resolveReportPeriod` (`period.ts:37-63`) ตรวจ `from`/`to` ครบแล้ว — regex, วันที่มีจริง, `from <= to` — และคืน `month: null` เมื่อเป็นช่วงกำหนดเอง ค่าที่ผิดจะตกกลับโหมดรายเดือนเอง หน้าเพจปัจจุบันประกาศ `searchParams` เป็น `{ m?: string }` (บรรทัด 40) จึงไม่มีทางเข้าเส้นทางนั้น

`DateRangeField` เป็น client component ที่ใช้ `useLocale()` อยู่แล้ว → ใช้ใน LIFF ได้ครบ 6 ภาษา

- [ ] **Step 1: เขียนเทสต์ที่ยังไม่ผ่าน**

สร้าง `src/app/(liff)/liff/summary/period-url.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { monthUrl, rangeUrl } from './period-url';

describe('monthUrl', () => {
  it('builds a month-mode URL', () => {
    expect(monthUrl('2026-06')).toBe('/liff/summary?m=2026-06');
  });
});

describe('rangeUrl', () => {
  it('builds a custom-range URL', () => {
    expect(rangeUrl('2026-06-01', '2026-06-15')).toBe(
      '/liff/summary?from=2026-06-01&to=2026-06-15',
    );
  });

  it('returns the month URL when either bound is missing', () => {
    expect(rangeUrl('', '2026-06-15')).toBeNull();
    expect(rangeUrl('2026-06-01', '')).toBeNull();
  });

  it('returns null for an inverted range rather than a URL the server will discard', () => {
    expect(rangeUrl('2026-06-20', '2026-06-01')).toBeNull();
  });
});
```

- [ ] **Step 2: รันให้เห็นว่าไม่ผ่าน**

Run: `npx vitest run "src/app/(liff)/liff/summary/period-url.test.ts"`
Expected: FAIL — `Cannot find module './period-url'`

- [ ] **Step 3: เขียน implementation**

สร้าง `src/app/(liff)/liff/summary/period-url.ts`:

```ts
/**
 * URL builders for the summary period picker.
 *
 * Pure and separate from the component so the link shapes are unit-testable
 * without rendering. The server re-validates everything in
 * `resolveReportPeriod` — `rangeUrl` returning null just avoids navigating
 * to a URL we already know the server would discard back to month mode.
 */

const BASE = '/liff/summary';

export function monthUrl(ym: string): string {
  return `${BASE}?m=${ym}`;
}

/** null when the range is incomplete or inverted — caller should not navigate. */
export function rangeUrl(from: string, to: string): string | null {
  if (!from || !to) return null;
  if (from > to) return null; // YYYY-MM-DD sorts lexicographically
  return `${BASE}?from=${from}&to=${to}`;
}
```

- [ ] **Step 4: รันให้ผ่าน**

Run: `npx vitest run "src/app/(liff)/liff/summary/period-url.test.ts"`
Expected: PASS ทุกเคส

- [ ] **Step 5: สร้าง PeriodPicker**

สร้าง `src/app/(liff)/liff/summary/period-picker.tsx`:

```tsx
'use client';

/**
 * Period selector for the employee summary: month arrows (the original
 * behaviour) or a custom from–to range, which the customer asked for.
 *
 * Navigates with plain hrefs / router.push rather than posting a form, so
 * every state is a shareable, bookmarkable URL and the back button works.
 */

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { DateRangeField } from '@/components/ui/date-range-field';
import { monthUrl, rangeUrl } from './period-url';

type Props = {
  /** null when a custom range is active. */
  month: string | null;
  monthLabel: string;
  prev: string;
  next: string;
  from: string;
  to: string;
  todayYmd: string;
  labels: {
    prevMonth: string;
    nextMonth: string;
    customRange: string;
    backToMonthly: string;
    applyRange: string;
  };
};

export function PeriodPicker({
  month,
  monthLabel,
  prev,
  next,
  from,
  to,
  todayYmd,
  labels,
}: Props) {
  const router = useRouter();
  const [custom, setCustom] = useState(month === null);
  const [range, setRange] = useState<{ from: string; to: string }>({ from, to });

  if (!custom) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white px-3 py-2.5">
        <div className="flex items-center justify-between">
          <a
            href={monthUrl(prev)}
            aria-label={labels.prevMonth}
            className="grid size-8 place-items-center rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-700"
          >
            ‹
          </a>
          <p className="text-sm font-semibold text-gray-900">{monthLabel}</p>
          <a
            href={monthUrl(next)}
            aria-label={labels.nextMonth}
            className="grid size-8 place-items-center rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-700"
          >
            ›
          </a>
        </div>
        <button
          type="button"
          onClick={() => setCustom(true)}
          className="mt-2 w-full rounded-md py-1 text-xs font-medium text-primary-700 hover:bg-primary-50"
        >
          {labels.customRange}
        </button>
      </div>
    );
  }

  const target = rangeUrl(range.from, range.to);

  return (
    <div className="space-y-2 rounded-xl border border-gray-200 bg-white px-3 py-2.5">
      <DateRangeField
        value={range}
        onChange={(v) => setRange({ from: v.from ?? '', to: v.to ?? '' })}
        max={todayYmd}
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={target === null}
          onClick={() => target && router.push(target)}
          className="flex-1 rounded-md bg-primary-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {labels.applyRange}
        </button>
        <a
          href={monthUrl((month ?? range.from ?? todayYmd).slice(0, 7))}
          className="rounded-md px-3 py-2 text-xs font-medium text-gray-600 hover:bg-gray-100"
        >
          {labels.backToMonthly}
        </a>
      </div>
    </div>
  );
}
```

**หมายเหตุ:** อ่าน `DateRangeField` ก่อนใช้ เพื่อยืนยันรูปแบบ `value`/`onChange` ของโหมด controlled ถ้าต่างจากด้านบนให้ปรับตามของจริง **ห้ามแก้ `DateRangeField`**

- [ ] **Step 6: ต่อเข้าหน้าเพจ**

ใน `src/app/(liff)/liff/summary/page.tsx`:

```ts
  searchParams: Promise<{ m?: string; from?: string; to?: string }>;
```
```ts
  const period = resolveReportPeriod(
    { m: params.m, from: params.from, to: params.to },
    todayYmd,
  );
```

แทนที่บล็อก month navigator เดิม (บรรทัด ~118-135) ด้วย `<PeriodPicker ... />`
ส่ง `month={period.month}`, `from={period.from}`, `to={period.to}`, `todayYmd`,
`monthLabel`, `prev`, `next` และ `labels` ที่ resolve จาก `t()` ฝั่ง server

**ห้ามเพิ่ม validation ของ from/to ที่หน้าเพจ** — `resolveReportPeriod` ทำแล้ว

- [ ] **Step 7: เพิ่ม i18n**

`messages/th.json` + `en.json` ใต้ `summary`:

| key | th | en |
|---|---|---|
| `customRange` | เลือกช่วงเอง | Custom range |
| `backToMonthly` | กลับไปรายเดือน | Back to monthly |
| `applyRange` | ดูช่วงนี้ | View this range |

- [ ] **Step 8: ตรวจ gates**

Run: `npx tsc --noEmit && npx biome check --write` บนไฟล์ที่แก้ แล้ว `pnpm test`
Expected: ผ่านทั้งหมด

- [ ] **Step 9: Commit**

```bash
git add "src/app/(liff)/liff/summary" messages/
git commit -m "feat(liff): let employees pick a custom date range on the summary"
```

---

### Task 2: คิวต้องตรวจสอบ — คัดแยกได้ และเลิกตัดรายการเงียบ

**Files:**
- Modify: `src/app/(admin)/admin/attendance/disputed/_load-inbox.ts`
- Create: `src/app/(admin)/admin/attendance/disputed/_load-inbox.test.ts`
- Modify: `src/app/(admin)/admin/attendance/disputed/page.tsx`
- Modify: `src/app/(admin)/admin/attendance/disputed/disputed-client.tsx`

**บริบท:** หลังเพิ่มธงเซลฟี่ คิวนี้มีสองสาเหตุปนกัน (GPS ผิด / รูปไม่ได้มาจากกล้องสด) ซึ่งต้องตรวจคนละแบบ แต่รายการแสดงแค่ `name`/`nickname`/`clockInLabel`/`distanceMeters` — เหตุผลอยู่ในแผงรายละเอียดที่ต้องกดเข้าไป (`disputed-client.tsx:163`) และแถวที่ติดธงเซลฟี่จะโชว์ระยะทางที่ดูปกติ จนแอดมินงงว่าทำไมอยู่ในคิว

`reason` **อยู่ใน row VM แล้ว** (`page.tsx:75` สร้าง, `disputed-client.tsx:16` ประกาศ) แค่รายการไม่ได้เรนเดอร์

- [ ] **Step 1: เขียนเทสต์ที่ยังไม่ผ่าน**

สร้าง `src/app/(admin)/admin/attendance/disputed/_load-inbox.test.ts` — mock `@/lib/db/prisma` ตามรูปแบบที่ไฟล์เทสต์อื่นในโปรเจกต์ใช้ (อ่าน `src/lib/advance/mark-paid.test.ts` เป็นตัวอย่างการ mock) แล้วยืนยัน:

```ts
it('returns the total even when rows are capped at 50', async () => {
  findManyMock.mockResolvedValue(new Array(50).fill(row));
  countMock.mockResolvedValue(137);

  const result = await loadDisputedCheckIns('all');

  expect(result.rows).toHaveLength(50);
  expect(result.total).toBe(137);
});

it('uses an identical where clause for the rows query and the count', async () => {
  findManyMock.mockResolvedValue([]);
  countMock.mockResolvedValue(0);

  await loadDisputedCheckIns('all');

  expect(countMock.mock.calls[0]![0]!.where).toEqual(findManyMock.mock.calls[0]![0]!.where);
});
```

เคสที่สองสำคัญที่สุด — มันคือบั๊กที่กำลังแก้

- [ ] **Step 2: รันให้เห็นว่าไม่ผ่าน**

Run: `npx vitest run "src/app/(admin)/admin/attendance/disputed/_load-inbox.test.ts"`
Expected: FAIL — ปัจจุบันคืน array ไม่ใช่ `{ rows, total }`

- [ ] **Step 3: แก้ loader**

```ts
export type DisputedInbox = { rows: DisputedRow[]; total: number };

/** Cap on rows returned in one page of the inbox. */
const INBOX_LIMIT = 50;

export async function loadDisputedCheckIns(
  permitted: PermittedBranches,
): Promise<DisputedInbox> {
  // ONE where object feeding both queries. Declaring it twice is exactly how
  // the badge count and this list drifted apart in the first place.
  const where = {
    type: 'CheckIn' as const,
    checkInStatus: { in: ['Disputed' as const] },
    ...viaEmployeeBranchScope(permitted),
  };

  const [rows, total] = await prisma.$transaction([
    prisma.attendance.findMany({
      where,
      orderBy: { clockInAt: 'desc' },
      take: INBOX_LIMIT,
      select: DISPUTED_SELECT,
    }),
    prisma.attendance.count({ where }),
  ]);

  return { rows, total };
}
```

- [ ] **Step 4: รันให้ผ่าน**

Run: `npx vitest run "src/app/(admin)/admin/attendance/disputed/_load-inbox.test.ts"`
Expected: PASS

- [ ] **Step 5: ต่อเข้าหน้าเพจ**

ใน `page.tsx` รับ `{ rows, total }` แทน array, ส่ง `total` ลง client และ
**ใช้ `total` เป็น `disputedCount` ของแท็บ** (เดิมใช้ `vm.length` ซึ่งตันที่ 50)
เพื่อให้ตรงกับ badge ใน sidebar

- [ ] **Step 6: แสดงเหตุผลในรายการ + ระยะทางเฉพาะเมื่อมี**

ใน `disputed-client.tsx`:
- ในแต่ละแถวของรายการ เพิ่มบรรทัดรองแสดง `r.reason` (ตัดความยาวด้วย
  `line-clamp-1` เพื่อไม่ให้แถวสูงไม่เท่ากัน)
- `distanceMeters` แสดงเฉพาะเมื่อไม่ใช่ `null` — แถวที่ติดธงเซลฟี่ GPS ปกติ
  การโชว์ระยะทางที่ดูปกติทำให้เข้าใจผิดว่าไม่มีปัญหา
- ถ้า `total > rows.length` เพิ่มบรรทัดท้ายรายการ (ไทย, ไม่ผ่าน `t()`):
  `แสดง {rows.length} จาก {total} รายการ`

- [ ] **Step 7: ตรวจ gates**

Run: `npx tsc --noEmit && npx biome check --write` บนไฟล์ที่แก้ แล้ว `pnpm test`
Expected: ผ่านทั้งหมด

- [ ] **Step 8: Commit**

```bash
git add "src/app/(admin)/admin/attendance/disputed"
git commit -m "fix(attendance): show dispute reasons in the queue and stop truncating silently"
```

---

## Verification (หลังครบทุก task)

- [ ] `pnpm test` + `pnpm test:integration` ผ่านทั้งหมด
- [ ] `npx tsc --noEmit` และ `npx biome check` สะอาด
- [ ] `git diff --name-only` ไม่มีไฟล์ใน `prisma/`
- [ ] ไม่มีคำสั่ง `create`/`update`/`delete` ใหม่ใน diff
- [ ] Browser smoke:
  - LIFF summary → "เลือกช่วงเอง" → เลือกช่วง → ตัวเลขเปลี่ยน → กลับรายเดือนได้
  - เปิด URL `?from=2026-06-01&to=2026-06-15` ตรง ๆ ได้
  - `?from=ขยะ` → ตกกลับโหมดรายเดือน ไม่พัง
  - คิวต้องตรวจสอบแสดงเหตุผลของแต่ละแถวโดยไม่ต้องกดเข้า
