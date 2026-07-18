# Schedule Warning + Half-Day Leave Display — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** (ก) ทำให้ลาครึ่งวันแสดงเป็นครึ่งวันจริงบนปฏิทินและรายการลา (ข) ทำให้พนักงานที่ไม่ได้ตั้งตารางงาน "มองเห็นได้" แทนที่จะถูก default เป็น จ–ส เงียบ ๆ

**Architecture:** ส่ง `unit`/`startTime`/`endTime` ผ่าน `TeamCalendarEntry` ไปให้หน้าจอจัดรูปแบบเอง และสร้าง helper อ่านอย่างเดียวตัวเดียว `employeesWithoutSchedule()` ให้ทั้ง 4 จุดที่เตือนเรียกใช้ร่วมกัน

**Tech Stack:** Next.js 16 App Router, Prisma/Postgres, Vitest (node env), Tailwind v4, next-intl, Biome

**Spec:** `docs/superpowers/specs/2026-07-18-schedule-warning-and-halfday-leave-design.md`

## Global Constraints

- **ห้ามแก้ schema / migration / enum** — งานนี้ไม่มีการเปลี่ยนโครงฐานข้อมูล
- **ห้ามแตะ** `src/lib/payroll/**` และ `src/lib/attendance/check-in.ts`
- **ห้ามแก้ `isScheduledWorkday`** (`src/lib/attendance/schedule.ts`) — ยังต้อง fallback เป็น จ–ส เหมือนเดิม งานนี้แค่ทำให้ *มองเห็น* ว่ากำลัง fallback อยู่
- **ห้ามเขียน/แก้ข้อมูลพนักงานเดิม** — โดยเฉพาะห้าม preselect ตารางงานให้พนักงานที่ `workScheduleId` เป็น null อยู่แล้ว (การกดบันทึกฟิลด์อื่นจะกลายเป็นการเปลี่ยนตารางงานโดยไม่ตั้งใจ)
- **ทุกจุดที่นับ "คนไม่มีตารางงาน" ต้องเรียก `employeesWithoutSchedule()` ตัวเดียวกัน** — ห้ามนับเองซ้ำในแต่ละหน้า
- **ไม่ต้องเพิ่ม i18n key ใหม่** — ใช้ `leave.new.unit.{FullDay,HalfMorning,HalfAfternoon,Hourly}` ที่มีและแปลไว้แล้วซ้ำ
- ข้อความฝั่งแอดมินเป็นภาษาไทย (admin ถูก pin เป็นไทยแล้ว); ฝั่ง LIFF ต้องผ่าน `t()` เสมอ
- Vitest รันบน **node** environment — ไม่มี jsdom / testing-library
- รัน `pnpm test` ต้องผ่านทั้งหมดก่อนจบแต่ละ task (ปัจจุบัน 1271)

## File Structure

| ไฟล์ | สถานะ | หน้าที่ |
|---|---|---|
| `src/lib/leave/team-calendar-shape.ts` | แก้ | เพิ่ม `unit`/`startTime`/`endTime` ใน entry |
| `src/lib/leave/team-calendar.ts` | แก้ | select + map 3 ฟิลด์ (จุดเดียว ครอบคลุมทั้ง 2 ปฏิทิน) |
| `src/app/(liff)/liff/calendar/calendar-grid.tsx` | แก้ | แสดงส่วนต่อท้ายในแผงรายละเอียด |
| `src/app/(admin)/admin/_calendar/dashboard-calendar-summary.tsx` | แก้ | แสดงส่วนต่อท้าย (ไทย) |
| `src/app/(liff)/liff/leave/page.tsx` | แก้ | select + แสดงในแถวรายการลา |
| `src/lib/employee/no-schedule.ts` | **ใหม่** | helper กลาง อ่านอย่างเดียว |
| `src/lib/employee/no-schedule.test.ts` | **ใหม่** | unit tests |
| `src/app/(admin)/admin/employees/page.tsx` | แก้ | แถบเตือน + ป้ายที่แถว |
| `src/lib/attendance/live-shape.ts` | แก้ | `RosterEmployee.hasSchedule` |
| `src/lib/attendance/live.ts` | แก้ | เติมค่า `hasSchedule` |
| `src/app/(admin)/admin/attendance/live/live-client.tsx` | แก้ | ป้ายในรายการยังไม่เช็คอิน |
| `src/lib/inngest/functions/attendance-late-check.ts` | แก้ | พ่วงจำนวนใน payload |
| `src/app/(admin)/admin/employees/employee-form.tsx` | แก้ | บังคับเลือกตอนสร้าง |
| `src/app/(admin)/admin/employees/employee-schema.ts` | แก้ | zod บังคับเฉพาะตอนสร้าง |

---

### Task 1: ลาครึ่งวัน — ส่งข้อมูลไปถึงหน้าจอ

**Files:**
- Modify: `src/lib/leave/team-calendar-shape.ts`
- Modify: `src/lib/leave/team-calendar.ts`
- Modify: `src/app/(liff)/liff/calendar/calendar-grid.tsx`
- Modify: `src/app/(admin)/admin/_calendar/dashboard-calendar-summary.tsx`
- Modify: `src/app/(liff)/liff/leave/page.tsx`

**Interfaces:**
- Produces: `TeamCalendarEntry` ที่มี `unit` / `startTime` / `endTime` — ไม่มี task อื่นบริโภคต่อ

**บริบทสำคัญ:** ตรรกะการแสดงผลไม่ได้พัง — `leaveDurationLabel` มีอยู่และหน้า inbox แอดมินใช้ถูกอยู่แล้ว ปัญหาคือ **query ไม่เคยดึงข้อมูลมา** งานนี้จึงเป็นการต่อท่อข้อมูล ไม่ใช่การเขียนตรรกะใหม่

- [ ] **Step 1: เพิ่มฟิลด์ใน entry type**

ใน `src/lib/leave/team-calendar-shape.ts` เพิ่มท้าย `TeamCalendarEntry` (ก่อนปิดปีกกา):

```ts
  /**
   * หน่วยการลา — ใช้แยกครึ่งวัน/รายชั่วโมงออกจากเต็มวันบนหน้าจอ
   * ส่งเป็นค่าดิบเพราะ LIFF ต้องแปล 6 ภาษา ส่วนแอดมินเป็นไทยล้วน
   */
  unit: 'FullDay' | 'HalfMorning' | 'HalfAfternoon' | 'Hourly';
  /** HH:MM — มีค่าเมื่อ unit==='Hourly' เท่านั้น */
  startTime: string | null;
  endTime: string | null;
```

- [ ] **Step 2: ดึงข้อมูลใน loader ร่วม**

ใน `src/lib/leave/team-calendar.ts` — select ของ leave อยู่ใน `loadEntriesAndHolidays` (บรรทัด ~92) ซึ่ง **ทั้ง `getTeamCalendarData` และ `getOrgCalendarData` เรียกใช้ร่วมกัน** เพิ่ม 3 บรรทัดใน select:

```ts
      select: {
        id: true,
        employeeId: true,
        startDate: true,
        endDate: true,
        status: true,
        unit: true,
        startTime: true,
        endTime: true,
        leaveType: { select: { name: true, nameByLocale: true } },
      },
```

แล้วใน `.map((l): TeamCalendarEntry | null => {...})` เพิ่มลงใน object ที่ return (หลัง `endDate: ymd(l.endDate),`):

```ts
        unit: l.unit,
        startTime: l.startTime,
        endTime: l.endTime,
```

- [ ] **Step 3: สร้างตัวช่วยจัดรูปแบบฝั่งแอดมิน (ไทย)**

สร้าง helper เล็ก ๆ ในไฟล์ `src/app/(admin)/admin/_calendar/dashboard-calendar-summary.tsx` (บนสุดของไฟล์ นอก component):

```tsx
/** ส่วนต่อท้ายบอกว่าเป็นลาบางส่วนของวัน — เต็มวันไม่ต้องแสดงอะไร */
function partialSuffixTh(
  unit: 'FullDay' | 'HalfMorning' | 'HalfAfternoon' | 'Hourly',
  startTime: string | null,
  endTime: string | null,
): string {
  switch (unit) {
    case 'FullDay':
      return '';
    case 'HalfMorning':
      return ' · ครึ่งเช้า';
    case 'HalfAfternoon':
      return ' · ครึ่งบ่าย';
    case 'Hourly':
      return startTime && endTime ? ` · ${startTime}–${endTime}` : ' · รายชั่วโมง';
  }
}
```

แล้วแก้บรรทัด ~65 จาก:

```tsx
      text: `${e.shortLabel} · ${e.leaveTypeName}`,
```

เป็น:

```tsx
      text: `${e.shortLabel} · ${e.leaveTypeName}${partialSuffixTh(e.unit, e.startTime, e.endTime)}`,
```

- [ ] **Step 4: แสดงในแผงรายละเอียดของ LIFF calendar**

ใน `src/app/(liff)/liff/calendar/calendar-grid.tsx` แผงรายละเอียดปัจจุบันเรนเดอร์ (ราวบรรทัด 453):

```tsx
                    <p className="mt-0.5 text-xs text-gray-600">
                      {e.leaveTypeName}
                      {e.startDate !== e.endDate && (
```

เพิ่มส่วนต่อท้ายทันทีหลัง `{e.leaveTypeName}` โดยใช้ key ที่มีอยู่แล้ว (**ห้ามสร้าง key ใหม่**). `t` ในไฟล์นี้ผูกกับ namespace `calendar` อยู่แล้ว ดังนั้นต้องดึง namespace `leave` เพิ่มด้วย `useTranslations('leave')` แล้วเรียก `tl('new.unit.HalfMorning')` เป็นต้น:

```tsx
                      {e.unit !== 'FullDay' && (
                        <span className="text-gray-500">
                          {' · '}
                          {e.unit === 'Hourly' && e.startTime && e.endTime
                            ? `${e.startTime}–${e.endTime}`
                            : tl(`new.unit.${e.unit}`)}
                        </span>
                      )}
```

- [ ] **Step 5: รายการลาของพนักงานเอง**

ใน `src/app/(liff)/liff/leave/page.tsx` เพิ่ม 3 ฟิลด์ใน select (ราวบรรทัด 70):

```ts
      select: {
        id: true,
        leaveType: { select: { name: true, nameByLocale: true } },
        startDate: true,
        endDate: true,
        unit: true,
        startTime: true,
        endTime: true,
        reason: true,
        status: true,
        createdAt: true,
      },
```

แล้วในแถวรายการ (ที่แสดงชื่อประเภทการลา) ต่อท้ายด้วยรูปแบบเดียวกับ Step 4 — ใช้ `t('new.unit.<unit>')` เมื่อ `unit !== 'FullDay'` และแสดง `startTime–endTime` เมื่อเป็น `Hourly`

- [ ] **Step 6: ตรวจ gates + suite**

Run: `npx tsc --noEmit && npx biome check --write` บนไฟล์ที่แก้ แล้ว `pnpm test`
Expected: ทั้งหมดผ่าน

- [ ] **Step 7: Commit**

```bash
git add src/lib/leave/team-calendar-shape.ts src/lib/leave/team-calendar.ts "src/app/(liff)/liff/calendar/calendar-grid.tsx" "src/app/(admin)/admin/_calendar/dashboard-calendar-summary.tsx" "src/app/(liff)/liff/leave/page.tsx"
git commit -m "fix(leave): carry leave unit through to calendar and leave list"
```

---

### Task 2: helper กลาง `employeesWithoutSchedule`

**Files:**
- Create: `src/lib/employee/no-schedule.ts`
- Create: `src/lib/employee/no-schedule.test.ts`

**Interfaces:**
- Consumes: `PermittedBranches` และ `employeeBranchScope` จาก `@/lib/auth/branch-scope`
- Produces: `employeesWithoutSchedule(permitted): Promise<EmployeeMissingSchedule[]>` และ type `EmployeeMissingSchedule` — Task 3 และ 4 เรียกใช้

- [ ] **Step 1: เขียนเทสต์ที่ยังไม่ผ่าน**

สร้าง `src/lib/employee/no-schedule.test.ts` ตาม pattern การ mock prisma ที่ใช้อยู่ใน `src/lib/attendance/manual.branch.test.ts` (อ่านไฟล์นั้นก่อนเพื่อลอกรูปแบบ mock ให้ตรง) ครอบคลุม:

- คืนเฉพาะพนักงานที่ `archivedAt: null` + `status != 'Archived'` + `canCheckIn: true` + `workScheduleId: null`
- ส่ง `employeeBranchScope(permitted)` เข้าไปใน where จริง (ตรวจ argument ที่ prisma ถูกเรียกด้วย)
- map ชื่อ: ใช้ชื่อเล่นถ้ามี ไม่งั้นใช้ `firstName lastName`
- คืน `[]` เมื่อไม่มีใครเข้าเงื่อนไข

- [ ] **Step 2: รันเทสต์ให้เห็นว่าไม่ผ่าน**

Run: `npx vitest run src/lib/employee/no-schedule.test.ts`
Expected: FAIL — `Cannot find module './no-schedule'`

- [ ] **Step 3: เขียน implementation**

สร้าง `src/lib/employee/no-schedule.ts`:

```ts
import 'server-only';

/**
 * พนักงานที่ยังทำงานอยู่และเช็คอินได้ แต่ไม่ได้ผูก WorkSchedule
 *
 * คนกลุ่มนี้ถูก `isScheduledWorkday` (src/lib/attendance/schedule.ts) นับเป็น
 * จ–ส โดยปริยาย จึงอาจถูกแจ้งว่า "ยังไม่เช็คอิน" ในวันที่จริง ๆ แล้วไม่ต้อง
 * ทำงาน — เคสที่ลูกค้าเจอกับพนักงานที่ทำงาน จ/พ/ศ
 *
 * นี่คือแหล่งความจริงเดียวสำหรับทุกจุดที่เตือนเรื่องนี้ (หน้ารายชื่อพนักงาน,
 * หน้าลงเวลาสด, แจ้งเตือนรายวัน) — อย่านับซ้ำที่อื่น มิฉะนั้นตัวเลขจะเพี้ยน
 * จากกันแบบเดียวกับที่เคยเกิดกับ badge/list ของรายการโต้แย้ง
 *
 * `canCheckIn: false` ไม่ถูกนับ — คนกลุ่มนั้นไม่มีทางถูกแจ้งอยู่แล้ว จึงไม่ควร
 * ทำให้แอดมินตกใจโดยไม่จำเป็น
 */

import { employeeBranchScope, type PermittedBranches } from '@/lib/auth/branch-scope';
import { prisma } from '@/lib/db/prisma';

export type EmployeeMissingSchedule = {
  id: string;
  /** ชื่อเล่นถ้ามี ไม่งั้นชื่อ-นามสกุล */
  name: string;
  branchName: string;
};

export async function employeesWithoutSchedule(
  permitted: PermittedBranches,
): Promise<EmployeeMissingSchedule[]> {
  const rows = await prisma.employee.findMany({
    where: {
      archivedAt: null,
      status: { not: 'Archived' },
      canCheckIn: true,
      workScheduleId: null,
      ...employeeBranchScope(permitted),
    },
    orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    select: {
      id: true,
      firstName: true,
      lastName: true,
      nickname: true,
      branch: { select: { name: true } },
    },
  });

  return rows.map((e) => ({
    id: e.id,
    name: e.nickname?.trim() || `${e.firstName} ${e.lastName}`.trim(),
    branchName: e.branch.name,
  }));
}
```

- [ ] **Step 4: รันเทสต์ให้ผ่าน**

Run: `npx vitest run src/lib/employee/no-schedule.test.ts`
Expected: PASS

- [ ] **Step 5: ตรวจ gates + Commit**

```bash
npx tsc --noEmit && npx biome check --write src/lib/employee/no-schedule.ts src/lib/employee/no-schedule.test.ts
git add src/lib/employee/no-schedule.ts src/lib/employee/no-schedule.test.ts
git commit -m "feat(employee): shared query for employees missing a work schedule"
```

---

### Task 3: เตือนบนหน้ารายชื่อพนักงาน + หน้าลงเวลาสด

**Files:**
- Modify: `src/app/(admin)/admin/employees/page.tsx`
- Modify: `src/lib/attendance/live-shape.ts`
- Modify: `src/lib/attendance/live.ts`
- Modify: `src/app/(admin)/admin/attendance/live/live-client.tsx`

**Interfaces:**
- Consumes: `employeesWithoutSchedule` จาก Task 2
- Produces: `RosterEmployee.hasSchedule: boolean`

- [ ] **Step 1: แถบเตือน + ป้าย บนหน้ารายชื่อพนักงาน**

ใน `src/app/(admin)/admin/employees/page.tsx`:
- เรียก `employeesWithoutSchedule(permitted)` ด้วย `permitted` ตัวเดิมที่หน้านี้ใช้อยู่ (เพิ่มเข้าไปใน `Promise.all` ที่มีอยู่)
- สร้าง `const missingIds = new Set(missing.map((m) => m.id));`
- เหนือตาราง ถ้า `missing.length > 0` แสดง:

```tsx
        <p
          role="status"
          className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
        >
          พนักงาน {missing.length} คนยังไม่ได้ตั้งตารางงาน — ระบบจะนับว่าทำงาน จันทร์–เสาร์
          และอาจแจ้งว่ายังไม่เช็คอินผิดวัน
        </p>
```

- ในคอลัมน์ชื่อของแต่ละแถว ถ้า `missingIds.has(e.id)` เพิ่มป้ายต่อท้ายชื่อ:

```tsx
              {missingIds.has(e.id) && (
                <span className="ml-2 whitespace-nowrap rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800">
                  ไม่มีตารางงาน
                </span>
              )}
```

- [ ] **Step 2: เพิ่ม `hasSchedule` ใน roster**

ใน `src/lib/attendance/live-shape.ts` เพิ่มใน `RosterEmployee`:

```ts
  /** false = ไม่ได้ผูก WorkSchedule → ถูกนับเป็น จ–ส โดยปริยาย */
  hasSchedule: boolean;
```

ใน `src/lib/attendance/live.ts` ที่ map roster (ราวบรรทัด 136-145) เพิ่มหลัง `scheduledToday: ...`:

```ts
    hasSchedule: (e.workSchedule?.days.length ?? 0) > 0,
```

ข้อมูลนี้อยู่ใน query เดิมแล้ว — **ห้ามเพิ่ม query ใหม่**

- [ ] **Step 3: แสดงป้ายในรายการ "ยังไม่เช็คอิน"**

ใน `src/app/(admin)/admin/attendance/live/live-client.tsx` ที่เรนเดอร์รายการ `notCheckedIn` เพิ่มป้ายเมื่อ `!r.hasSchedule` ด้วยสไตล์เดียวกับ Step 1 (`bg-amber-100 text-amber-800`, ข้อความ `ไม่มีตารางงาน`) เพื่อให้แอดมินเข้าใจทันทีว่าทำไมคนนี้ถึงโผล่มา

- [ ] **Step 4: ตรวจ gates + suite**

Run: `npx tsc --noEmit && npx biome check --write` บนไฟล์ที่แก้ แล้ว `pnpm test`

- [ ] **Step 5: Commit**

```bash
git add "src/app/(admin)/admin/employees/page.tsx" src/lib/attendance/live-shape.ts src/lib/attendance/live.ts "src/app/(admin)/admin/attendance/live/live-client.tsx"
git commit -m "feat(admin): surface employees missing a work schedule"
```

---

### Task 4: แจ้งเตือนรายวัน + บังคับตั้งตารางงานตอนสร้าง

**Files:**
- Modify: `src/lib/inngest/functions/attendance-late-check.ts`
- Modify: `src/app/(admin)/admin/employees/employee-form.tsx`
- Modify: `src/app/(admin)/admin/employees/employee-schema.ts`
- Modify: `src/app/(admin)/admin/employees/new/page.tsx` *(ส่ง `defaultWorkScheduleId`)*
- Modify: `src/app/(admin)/admin/employees/[id]/edit/page.tsx` *(ส่ง `defaultWorkScheduleId={null}` — โหมดแก้ไขไม่ใช้ค่านี้)*
- Modify: `src/lib/notifications/in-app-bell.ts` *(type ของ payload)*
- Modify: `src/components/admin/notification-bell.tsx` *(ข้อความที่แสดง)*

**Interfaces:**
- Consumes: `employeesWithoutSchedule` จาก Task 2

- [ ] **Step 1: พ่วงจำนวนในแจ้งเตือนรายวัน**

ใน `src/lib/inngest/functions/attendance-late-check.ts` — หลังจากคำนวณ `notCheckedIn` แล้ว เรียก helper (ใช้ `'all'` เพราะ cron ไม่มี user context) และเพิ่มลงใน payload ของ `notifyAdminsInApp`:

```ts
      countWithoutSchedule: (await employeesWithoutSchedule('all')).length,
```

**หมายเหตุ:** เส้นทางนี้คือกระดิ่งในเว็บ (`notifyAdminsInApp`) **ไม่ใช่ LINE push** จึงไม่กินโควตา LINE

แก้ 2 ไฟล์ให้สอดคล้องกัน:

1. `src/lib/notifications/in-app-bell.ts` (บรรทัด ~55) — เพิ่ม `countWithoutSchedule: number` ใน payload type ของ `kind: 'attendance.late-summary'`
2. `src/components/admin/notification-bell.tsx` (บรรทัด ~237, `case 'attendance.late-summary'`) — ต่อท้ายข้อความเดิมเมื่อ `countWithoutSchedule > 0` ด้วย ` (N คนยังไม่ได้ตั้งตารางงาน)`

**ทำให้ฟิลด์ใหม่เป็น optional หรือมีค่า default** เพื่อให้การแจ้งเตือนเก่าที่เก็บไว้ในฐานข้อมูลแล้ว (ยังไม่มีฟิลด์นี้) ยังเรนเดอร์ได้ ไม่พัง

- [ ] **Step 2: zod บังคับเฉพาะตอนสร้าง**

ใน `src/app/(admin)/admin/employees/employee-schema.ts` — ปัจจุบัน `workScheduleId` เป็น optional/nullable (บรรทัด 39-43) **อย่าเปลี่ยน schema กลาง** เพราะโหมดแก้ไขต้องยังรับ null ได้ ให้เพิ่มการตรวจเฉพาะเส้นทาง "สร้าง" แทน: ในฟังก์ชันที่จัดการการสร้างพนักงาน ถ้า `workScheduleId == null` ให้คืน error ภาษาไทย `กรุณาเลือกตารางงาน`

- [ ] **Step 3: ฟอร์ม — บังคับตอนสร้าง ไม่แตะตอนแก้ไข**

ใน `src/app/(admin)/admin/employees/employee-form.tsx` (ช่องตารางงานอยู่ราวบรรทัด 431-440) รับ prop ใหม่ `defaultWorkScheduleId: string | null` แล้วแก้เป็น:

```tsx
                <FormField
                  label="ตารางงาน"
                  htmlFor="workScheduleId"
                  required={isCreate}
                  hint={
                    isCreate
                      ? 'ใช้ตรวจสายและคำนวณ OT'
                      : 'ใช้ตรวจสายและคำนวณ OT — ถ้าเว้นว่าง ระบบจะนับว่าทำงาน จันทร์–เสาร์'
                  }
                >
                  <select
                    id="workScheduleId"
                    name="workScheduleId"
                    required={isCreate}
                    defaultValue={
                      initial ? (initial.workScheduleId ?? '') : (defaultWorkScheduleId ?? '')
                    }
                    className={cn(selectClasses, 'max-w-md')}
                  >
                    {/* ตอนแก้ไข ต้องคง "ไม่ระบุ" ไว้เสมอ ไม่งั้นการบันทึกฟิลด์อื่น
                        จะเปลี่ยนตารางงานของพนักงานเดิมโดยที่แอดมินไม่ตั้งใจ */}
                    {!isCreate && <option value="">— ไม่ระบุ —</option>}
                    {options.workSchedules.map((w) => (
```

โดย `const isCreate = initial == null;`

- [ ] **Step 4: ส่ง `defaultWorkScheduleId` จากหน้าที่เรนเดอร์ฟอร์ม**

ในหน้าที่เรนเดอร์ `<EmployeeForm>` สำหรับการสร้าง ให้คำนวณตารางที่มีพนักงาน (ยัง active) ผูกอยู่มากที่สุดแล้วส่งเข้าไป:

```ts
  const scheduleUsage = await prisma.employee.groupBy({
    by: ['workScheduleId'],
    where: { archivedAt: null, status: { not: 'Archived' }, workScheduleId: { not: null } },
    _count: { _all: true },
    orderBy: { _count: { workScheduleId: 'desc' } },
    take: 1,
  });
  const defaultWorkScheduleId = scheduleUsage[0]?.workScheduleId ?? null;
```

- [ ] **Step 5: ตรวจ gates + suite**

Run: `npx tsc --noEmit && npx biome check --write` บนไฟล์ที่แก้ แล้ว `pnpm test`

- [ ] **Step 6: Commit**

```bash
git add src/lib/inngest/functions/attendance-late-check.ts "src/app/(admin)/admin/employees/employee-form.tsx" "src/app/(admin)/admin/employees/employee-schema.ts"
git commit -m "feat(employee): require a work schedule on create, warn in daily digest"
```

---

## Verification (หลังครบทุก task)

- [ ] `pnpm test` ผ่านทั้งหมด · `npx tsc --noEmit` และ `npx biome check` สะอาด
- [ ] Browser smoke:
  - `/admin/employees` → เห็นแถบเตือน "1 คน" + ป้าย "ไม่มีตารางงาน" ที่แถวของโหน่ง
  - `/admin/attendance/live` → ถ้าโหน่งอยู่ในรายการยังไม่เช็คอิน ต้องมีป้ายกำกับ
  - สร้างพนักงานใหม่ → ช่องตารางงานมีค่าเลือกไว้ให้แล้ว และเว้นว่างไม่ได้
  - แก้ไขพนักงานเดิมที่ไม่มีตารางงาน → ยังเห็น "— ไม่ระบุ —" เลือกค้างอยู่ **และกดบันทึกแล้วตารางงานต้องยังเป็น null เหมือนเดิม**
  - ยื่นใบลาครึ่งบ่าย → ปฏิทิน LIFF + แผงรายละเอียด + รายการลา แสดง "ครึ่งบ่าย"
