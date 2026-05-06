# Employee Screens

11 screens, 5 forms, 5 modals, 9 toasts, 5 edge cases — for User role only.

**Section prefix:** `E` (e.g., S-E1, F-E1, T-E1)

> Note: 'E' prefix conflicts with 'Email' (e.g., E-A1) — Email templates use full prefix `E-A`/`E-N` (per section). Within Employee section, screens/forms/modals/toasts use `S-E`/`F-E`/`M-E`/`T-E` prefixes only.

---

## Index

### Screens (11)
- [S-E1: Dashboard](#s-e1-dashboard) ⭐
- [S-E2: Attendance (เวลาของฉัน)](#s-e2-attendance)
- [S-E3: Leave list + calendar](#s-e3-leave-list)
- [S-E4: Leave request form](#s-e4-leave-request-new)
- [S-E5: Leave detail](#s-e5-leave-detail)
- [S-E6: Cash advance list](#s-e6-advance-list)
- [S-E7: Cash advance form](#s-e7-advance-new)
- [S-E8: Cash advance detail](#s-e8-advance-detail)
- [S-E9: Pay slip list](#s-e9-payslip-list)
- [S-E10: Pay slip detail](#s-e10-payslip-detail)
- [S-E11: Profile](#s-e11-profile)

### Forms (5)
- [F-E1: Leave list filter](#f-e1-leave-filter)
- [F-E2: Leave request](#f-e2-leave-request)
- [F-E3: Cash advance request](#f-e3-advance-request)
- [F-E4: Profile edit](#f-e4-profile-edit)
- [F-E5: Notification preferences](#f-e5-notification-preferences)

### Modals (5)
- [M-E1: Cancel leave request](#m-e1-cancel-leave)
- [M-E2: Cancel advance request](#m-e2-cancel-advance)
- [M-E3: Mobile PDF actions sheet](#m-e3-pdf-actions)
- [M-E4: Confirm submission discard](#m-e4-discard-form)
- [M-E5: Image preview (receipt)](#m-e5-image-preview)

### Toasts (9)
- [T-E1 → T-E9](#employee-toasts)

### Edge cases (5)
- [X-E1 → X-E5](#employee-edge-cases)

---

## Layout (all employee screens)

All employee screens use `<EmployeeLayout>`:

```
┌────────────────────────────────────────┐
│  [Logo]  Koolman HR     🔔 (3)   👤    │ ← topbar 56px
├────────────────────────────────────────┤
│                                        │
│   PAGE CONTENT                         │
│   max-width: 480px desktop             │
│   full-width mobile                    │
│   horizontal padding: 16px mobile,     │
│                       24px desktop     │
│                                        │
├────────────────────────────────────────┤
│  🏠   📅   💰   📄   👤                │ ← bottom nav 64px
│ หน้าแรก ลา  เบิก  สลิป  โปรไฟล์            │
└────────────────────────────────────────┘
```

See [navigation.md §2](./navigation.md#employee--bottom-navigation-mobile-first) for nav details.

---

# Screens

## S-E1: Dashboard

- **Path:** `/dashboard`
- **Role:** User
- **Purpose:** Home — quick glance at status, primary actions
- **Priority:** ⭐ first thing employee sees daily

### Layout

Stack of cards:
1. Greeting (name)
2. **Hero card** — NetPay (most recent published)
3. **3 mini KPI cards** — leave/absent/late counts this month
4. **Pending requests** — list of own pending leave/advance
5. **Quick actions** — primary CTAs

### Wireframe

```
┌─────────────────────────────────────────┐
│ Koolman HR              🔔 3   👤        │
├─────────────────────────────────────────┤
│                                         │
│ สวัสดี                                    │
│ คุณตงค์ สมศรี                              │
│                                         │
│ ┌───────────────────────────────────┐   │
│ │  ยอดเงินคงเหลือ • เม.ย. 2569         │  ← hero card (gradient blue)
│ │                                   │   │
│ │   ฿ 31,417.50                     │   │
│ │                                   │   │
│ │  รับเงินเดือน 30 เม.ย.              │   │
│ └───────────────────────────────────┘   │
│                                         │
│ ┌────────┬────────┬────────┐            │
│ │ ลา      │ ขาด    │ สาย     │           │  ← 3 mini cards
│ │ 2 วัน   │ 0 วัน  │ 1 ครั้ง  │           │
│ └────────┴────────┴────────┘            │
│                                         │
│ คำขอที่รอดำเนินการ                          │
│ ─────────────                            │
│ ┌─────────────────────────────────────┐ │
│ │  📅 ลาพักร้อน 12-13 พ.ค. 2569         │ │  ← pending list
│ │     ส่งเมื่อ 2 ชม.ที่แล้ว             │ │
│ │                          [รออนุมัติ] │ │
│ └─────────────────────────────────────┘ │
│                                         │
│ ทางลัด                                   │
│ ─────────────                            │
│ [ + ส่งคำขอลา ]   [ + ขอเบิกเงิน ]      │  ← CTA row
│                                         │
├─────────────────────────────────────────┤
│ 🏠   📅   💰   📄   👤                  │
└─────────────────────────────────────────┘
```

### Components

| Element | Component |
|---|---|
| Greeting | `<h1>` text-2xl bold, "สวัสดี คุณ{name}" |
| Hero card | Custom — gradient bg, big tabular numerals |
| Mini KPI grid | 3-col `<KpiMini>` cards |
| Pending list | List of `<Card>` items with status badge |
| Quick actions | 2 `<Button>` variants primary + secondary |

### Server Actions

- `getDashboardData()` — single fetch returning all data
- Returns: `{ employee, latestPayslip, monthStats, pendingRequests }`

### States

- **Loading:** skeleton placeholder per section
- **No published slip yet:** hero card shows "ยังไม่มีสลิปประจำเดือน" with smaller text
- **No pending requests:** show empty state in that section
- **Error:** retry button

### Interactions

- Click hero card → /payslip/[latestMonth]
- Click any KPI mini → /attendance with relevant filter
- Click pending row → its detail page (S-E5 or S-E8)
- "ดูทั้งหมด →" link → goes to relevant list page
- Quick action [+ ส่งคำขอลา] → /leave/new
- Quick action [+ ขอเบิกเงิน] → /advance/new

---

## S-E2: Attendance

- **Path:** `/attendance`
- **Role:** User
- **Purpose:** View own time records (clock-in/out + leave/absent/late entries)

### Wireframe

```
┌─────────────────────────────────────────┐
│ Topbar                                  │
├─────────────────────────────────────────┤
│                                         │
│ เวลาของฉัน                                │
│                                         │
│ [◀ เม.ย. 2569 ▶]                          │ ← month picker
│                                         │
│ ┌────────────────────────────┐          │
│ │  สรุปเดือนนี้                 │          │
│ │  วันทำงาน  21  วัน           │          │
│ │  ขาด/ลา/สาย   3 ครั้ง        │          │
│ │  หักรวม    ฿833              │          │
│ └────────────────────────────┘          │
│                                         │
│ บันทึกรายวัน                              │
│ ─────────────                            │
│ ┌────────────────────────────────────┐  │
│ │  วันที่      │ ประเภท     │ ยอดหัก   │  ← table
│ ├──────────────────────────────────┤    │
│ │  1 เม.ย.   │ ทำงาน      │  -      │   │
│ │  2 เม.ย.   │ 🟧 สาย      │ ฿250    │   │
│ │  3 เม.ย.   │ ทำงาน      │  -      │   │
│ │  ...                                  │
│ │  15 เม.ย.  │ 🟦 ลาป่วย    │  -      │   │
│ └────────────────────────────────────┘  │
│                                         │
├─────────────────────────────────────────┤
│ Bottom nav                              │
└─────────────────────────────────────────┘
```

### Components

- `<MonthPicker>` — prev/next arrow + display
- `<KpiCard>` summary
- `<DataTable>` mobile-optimized (stack vertically on small screens)
- `<StatusBadge type="...">` per row

### Server Actions

- `getOwnAttendance(month)` — returns rows + summary

### States

- **Empty (no records):** "ยังไม่มีบันทึกในเดือนนี้"
- **Skeleton** while loading
- **Error** state with retry

### Interactions

- Tap day row → optional detail (V1: no detail page; just inline expansion)
- Month nav arrow keyboard accessible

---

## S-E3: Leave list

- **Path:** `/leave`
- **Role:** User
- **Purpose:** View own leave requests + see team calendar

### Layout — 2 tabs

**Tab 1: รายการ (List)** (default)
**Tab 2: ปฏิทินทีม (Calendar)**

### Wireframe — List tab

```
┌─────────────────────────────────────────┐
│ Topbar                                  │
├─────────────────────────────────────────┤
│                                         │
│ การลา                          [+ ส่งคำขอลา] │
│                                         │
│ ┌──────┬──────────────┐                  │
│ │ รายการ│ ปฏิทินทีม      │                 │ ← tabs
│ └──────┴──────────────┘                  │
│                                         │
│ Filter: [ทั้งหมด ▼]  [ปี 2569 ▼]            │
│                                         │
│ ┌─────────────────────────────────────┐ │
│ │  📅 ลาพักร้อน 12-13 พ.ค. 2569         │ │  ← list item
│ │     2 วัน · ส่งเมื่อ 2 ชม.ที่แล้ว     │ │
│ │                          [รออนุมัติ] │ │
│ ├─────────────────────────────────────┤ │
│ │  📅 ลาป่วย 2 เม.ย. 2569              │ │
│ │     1 วัน · 1 เดือนที่แล้ว           │ │
│ │                          [อนุมัติ]  │ │
│ ├─────────────────────────────────────┤ │
│ │  ...                                 │ │
│ └─────────────────────────────────────┘ │
│                                         │
│ [โหลดเพิ่ม]                              │
│                                         │
└─────────────────────────────────────────┘
```

### Wireframe — Calendar tab

```
┌─────────────────────────────────────────┐
│ การลา                                    │
│ [รายการ] [ปฏิทินทีม]  ← active             │
│                                         │
│ ◀ พฤษภาคม 2569 ▶                          │
│                                         │
│  จ   อ   พ   พฤ  ศ   ส   อา                │
│  ─────────────────────────────             │
│           1   2   3   4                    │
│  5   6   7   8   9  10  11                 │
│ 12●  13●  14   15  16  17  18              │ ← • = leave dot
│ 19  20  21  22  23  24  25                 │
│ 26  27  28  29  30                         │
│                                         │
│ Legend: 🟦 ป่วย  🟪 กิจ  🟩 พักร้อน          │
│                                         │
└─────────────────────────────────────────┘
```

Click day → drawer with names of who's on leave that day in same dept.

### Components

- `<Tabs>` (shadcn)
- `<Button>` "+ ส่งคำขอลา" → /leave/new
- `<DataTable>` for list mode
- `<Calendar>` (custom or react-day-picker) for calendar mode
- `<Drawer>` for day-cell click

### Server Actions

- `listOwnLeave(filter)` — for list tab
- `getTeamLeaveCalendar(month)` — for calendar tab (team = same department)

### States

- **Empty list:** EmptyState "ยังไม่มีคำขอลา · [+ ส่งคำขอลาแรก]"
- **Calendar loading:** skeleton calendar grid

---

## S-E4: Leave request (new)

- **Path:** `/leave/new`
- **Role:** User
- **Purpose:** Submit new leave request

### Wireframe

```
┌─────────────────────────────────────────┐
│ ← กลับ              ส่งคำขอลา              │
│                                         │
│ ┌─────────────────────────────────────┐ │
│ │                                     │ │
│ │  ประเภทการลา *                       │ │
│ │  ┌──────────────────────────────┐   │ │
│ │  │  ลาพักร้อน                  ▼ │   │ │
│ │  └──────────────────────────────┘   │ │
│ │                                     │ │
│ │  ระยะเวลา *                          │ │
│ │  วันที่เริ่ม          วันที่สิ้นสุด     │ │
│ │  ┌──────────┐    ┌──────────┐       │ │
│ │  │ 12/05/26 │    │ 13/05/26 │       │ │
│ │  └──────────┘    └──────────┘       │ │
│ │  รวม 2 วัน (ไม่รวมวันหยุด)            │ │
│ │                                     │ │
│ │  เหตุผล *                            │ │
│ │  ┌──────────────────────────────┐   │ │
│ │  │ ไปงานแต่งของพี่                │   │ │
│ │  │                              │   │ │
│ │  └──────────────────────────────┘   │ │
│ │  124 / 500 ตัวอักษร                   │ │
│ │                                     │ │
│ │  แนบไฟล์ (ใบรับรองแพทย์ ฯลฯ)           │ │
│ │  ┌──────────────────────────────┐   │ │
│ │  │  📎  ลากไฟล์มาวาง              │   │ │
│ │  │       หรือ คลิกเลือก            │   │ │
│ │  │       JPG, PNG, PDF · ≤5MB    │   │ │
│ │  └──────────────────────────────┘   │ │
│ │                                     │ │
│ │  [   ส่งคำขอ   ]   [ ยกเลิก ]        │ │
│ │                                     │ │
│ └─────────────────────────────────────┘ │
│                                         │
└─────────────────────────────────────────┘
```

### Components

- `<Select>` for leave type (loaded from LeaveTypes table)
- `<DateRangePicker>` (custom, Thai locale)
- `<Textarea>` with char counter
- `<FileUploader>` drag-drop with preview

### Server Actions

- `createLeaveRequest(data)` — see [F-E2](#f-e2-leave-request)

### States

- **Default:** empty form
- **Validation errors:** inline below fields (red)
- **Submitting:** disable form, button spinner
- **Success:** redirect /leave + toast T-E1
- **Server error:** toast T-E9 inline alert + retry

---

## S-E5: Leave detail

- **Path:** `/leave/[id]`
- **Role:** User
- **Purpose:** View own leave request status + history

### Wireframe

```
┌─────────────────────────────────────────┐
│ ← กลับ           รายละเอียดคำขอลา          │
│                                         │
│ ┌─────────────────────────────────────┐ │
│ │  ลาพักร้อน                            │ │
│ │  12-13 พฤษภาคม 2569 (2 วัน)           │ │
│ │                                     │ │
│ │  สถานะ: [รออนุมัติ]                    │ │
│ │  ส่งคำขอ: 5 พ.ค. 2569 14:32           │ │
│ │  ─────                              │ │
│ │                                     │ │
│ │  เหตุผล:                              │ │
│ │  ไปงานแต่งของพี่                      │ │
│ │                                     │ │
│ │  แนบไฟล์: (ไม่มี)                      │ │
│ │                                     │ │
│ │  ─────                              │ │
│ │                                     │ │
│ │  ประวัติ                              │ │
│ │  • 5 พ.ค. 14:32 — ส่งคำขอ            │ │
│ │                                     │ │
│ │  ─────                              │ │
│ │                                     │ │
│ │  [ ❌ ยกเลิกคำขอ ]                   │ │  (only if Status=รออนุมัติ)
│ │                                     │ │
│ └─────────────────────────────────────┘ │
│                                         │
└─────────────────────────────────────────┘
```

### States by Status

- **รออนุมัติ:** show "ยกเลิกคำขอ" button
- **อนุมัติแล้ว:** show approved date + admin note + link to attendance records created
- **ปฏิเสธ:** show rejection reason + admin note

### Server Actions

- `getOwnLeaveRequest(id)` — fetch with permissions check (employee can only see own)
- `cancelOwnLeaveRequest(id)` — only allowed if Status=รออนุมัติ

### Modals

- [M-E1: Cancel leave confirm](#m-e1-cancel-leave)

---

## S-E6: Cash advance list

- **Path:** `/advance`
- **Role:** User
- **Purpose:** View own advance requests + history

### Wireframe

```
┌─────────────────────────────────────────┐
│ การเบิกเงิน                  [+ ขอเบิก]    │
│                                         │
│ Filter: [ทั้งหมด ▼]                       │
│                                         │
│ สรุปปีนี้: เบิกรวม ฿15,000                  │
│                                         │
│ ┌─────────────────────────────────────┐ │
│ │  💰 ฿5,000                            │ │
│ │     ขอเมื่อ 28 เม.ย.                  │ │
│ │                          [รออนุมัติ] │ │
│ ├─────────────────────────────────────┤ │
│ │  💰 ฿3,000                            │ │
│ │     ขอเมื่อ 15 มี.ค. · มีสลิปแล้ว ✓  │ │
│ │                          [อนุมัติ]  │ │
│ └─────────────────────────────────────┘ │
│                                         │
└─────────────────────────────────────────┘
```

### Components

Similar to S-E3 list pattern.

### Empty state

"ยังไม่มีคำขอเบิกเงิน — [+ ขอเบิกเงินครั้งแรก]"

---

## S-E7: Cash advance new

- **Path:** `/advance/new`
- **Role:** User
- **Purpose:** Submit new advance request

### Wireframe

```
┌─────────────────────────────────────────┐
│ ← กลับ              ขอเบิกเงิน             │
│                                         │
│ ┌─────────────────────────────────────┐ │
│ │  จำนวนเงิน *                          │ │
│ │  ┌──────────────────────────────┐   │ │
│ │  │ ฿  5,000                     │   │ │
│ │  └──────────────────────────────┘   │ │
│ │  ขั้นต่ำ ฿100                          │ │
│ │                                     │ │
│ │  เหตุผล *                            │ │
│ │  ┌──────────────────────────────┐   │ │
│ │  │ ค่ารักษาพยาบาลฉุกเฉิน              │   │ │
│ │  └──────────────────────────────┘   │ │
│ │                                     │ │
│ │  ⚠️ จำนวนนี้จะถูกหักจากเงินเดือน         │ │
│ │     เดือนถัดไปอัตโนมัติ                  │ │
│ │                                     │ │
│ │  [ ส่งคำขอ ]   [ ยกเลิก ]             │ │
│ └─────────────────────────────────────┘ │
└─────────────────────────────────────────┘
```

### Components

- `<MoneyInput>` — number input with `฿` prefix, formatting on blur
- `<Textarea>`

### Form: see [F-E3](#f-e3-advance-request)

---

## S-E8: Cash advance detail

- **Path:** `/advance/[id]`
- **Purpose:** View status + receipt (if approved)

### Wireframe (approved state)

```
┌─────────────────────────────────────────┐
│ ← กลับ        รายละเอียดคำขอเบิก            │
│                                         │
│ ┌─────────────────────────────────────┐ │
│ │  ฿5,000                              │ │
│ │  ─────                              │ │
│ │  สถานะ: [อนุมัติแล้ว]                  │ │
│ │  ขอเมื่อ: 28 เม.ย. 14:30                │ │
│ │  อนุมัติ: 28 เม.ย. 16:45 โดย Admin    │ │
│ │                                     │ │
│ │  เหตุผล:                              │ │
│ │  ค่ารักษาพยาบาลฉุกเฉิน                  │ │
│ │                                     │ │
│ │  สลิปการโอน:                           │ │
│ │  ┌────────────────┐                  │ │
│ │  │  [thumbnail]   │ คลิกเพื่อดู         │ │
│ │  └────────────────┘                  │ │
│ │                                     │ │
│ │  ⚠️ จะถูกหักในสลิปเดือน พ.ค. 2569      │ │
│ │                                     │ │
│ └─────────────────────────────────────┘ │
└─────────────────────────────────────────┘
```

### Receipt image preview (modal)

Click thumbnail → M-E5 modal with full image + download

---

## S-E9: Pay slip list

- **Path:** `/payslip`
- **Purpose:** Browse own pay slips by month

### Wireframe

```
┌─────────────────────────────────────────┐
│ สลิปเงินเดือน                              │
│                                         │
│ Filter: [ปี 2569 ▼]                       │
│                                         │
│ ┌─────────────────────────────────────┐ │
│ │  📄 เม.ย. 2569              ฿31,417   │ │
│ │     เผยแพร่ 30 เม.ย.                  │ │
│ ├─────────────────────────────────────┤ │
│ │  📄 มี.ค. 2569              ฿28,950   │ │
│ ├─────────────────────────────────────┤ │
│ │  📄 ก.พ. 2569              ฿29,200   │ │
│ └─────────────────────────────────────┘ │
│                                         │
└─────────────────────────────────────────┘
```

### States

- **No slips yet:** "ยังไม่มีสลิป — Admin จะเผยแพร่ปลายเดือน"

---

## S-E10: Pay slip detail

- **Path:** `/payslip/[month]`
- **Purpose:** Detailed slip view + PDF download

### Wireframe

```
┌─────────────────────────────────────────┐
│ ← กลับ        สลิปเงินเดือน เม.ย. 2569       │
│                                         │
│              [📥 ดาวน์โหลด PDF]            │  ← top action
│                                         │
│ ┌─────────────────────────────────────┐ │
│ │  ตงค์ สมศรี (EMP-001)                  │ │
│ │  Tech Department · สำนักงานใหญ่           │ │
│ │  ─────                              │ │
│ │                                     │ │
│ │  รายรับ                              │ │
│ │    เงินเดือนพื้นฐาน      ฿30,000.00    │ │
│ │    รายได้อื่น            ฿ 5,000.00    │ │
│ │    ─────                            │ │
│ │    รวมรายรับ          ฿35,000.00    │ │
│ │                                     │ │
│ │  รายหัก                              │ │
│ │    ประกันสังคม           ฿  750.00    │ │
│ │    เบิกเงินล่วงหน้า      ฿2,000.00    │ │
│ │    ขาด/ลา/มาสาย         ฿  833.00    │ │
│ │    หักหนี้                ฿     0       │ │
│ │    ─────                            │ │
│ │    รวมรายหัก           ฿3,583.00    │ │
│ │                                     │ │
│ │  ─────                              │ │
│ │  ยอดสุทธิ            ฿31,417.00    │ │
│ │  ─────                              │ │
│ │                                     │ │
│ │  วันที่ออก: 30 เม.ย. 2569                │ │
│ └─────────────────────────────────────┘ │
└─────────────────────────────────────────┘
```

### Components

- `<Card>` — section
- Tables with `tabular-nums` for alignment
- `<Button>` PDF download

### Server Actions

- `getOwnPayslip(month)` — get slip data + presigned PDF URL

### Mobile: PDF actions

On mobile (< 768px), PDF button opens action sheet (M-E3): "ดาวน์โหลด" / "แชร์" / "ยกเลิก"

---

## S-E11: Profile

- **Path:** `/profile`
- **Purpose:** View + edit own profile + notification prefs + connect LINE (V1.5)

### Wireframe

```
┌─────────────────────────────────────────┐
│ โปรไฟล์                                  │
│                                         │
│ ┌─────────────────────────────────────┐ │
│ │  ┌───┐                                │ │
│ │  │ ตงค์│   ตงค์ สมศรี                  │ │
│ │  └───┘   EMP-001                      │ │
│ │          Tech · สำนักงานใหญ่              │ │
│ │                                     │ │
│ │  Tabs: [ข้อมูล] [แจ้งเตือน] [ความปลอดภัย]│ │
│ │                                     │ │
│ │ ─ ข้อมูลส่วนตัว                          │ │
│ │   เบอร์โทร      082-345-6789  [แก้ไข]│ │
│ │   อีเมล         tong@finnix... [แก้ไข]│ │
│ │   ที่อยู่        ...           [แก้ไข]  │ │
│ │   ผู้ติดต่อฉุกเฉิน  ...        [แก้ไข]  │ │
│ │                                     │ │
│ │ ─ ข้อมูลงาน (ติดต่อ Admin หากต้องแก้)     │ │
│ │   ตำแหน่ง        Software Engineer    │ │
│ │   เงินเดือน      ฿30,000              │ │
│ │   วันเริ่มงาน     1 ม.ค. 2566           │ │
│ └─────────────────────────────────────┘ │
└─────────────────────────────────────────┘
```

### Tabs

1. **ข้อมูล** (default) — personal info, work info (read-only)
2. **แจ้งเตือน** — notification preferences (per channel × event)
3. **ความปลอดภัย** — change password (V1.5: + connect LINE)

### Edit pattern

Click [แก้ไข] on field → inline form replaces display → Save/Cancel

### Forms

- [F-E4: Profile edit](#f-e4-profile-edit)
- [F-E5: Notification prefs](#f-e5-notification-preferences)

---

# Forms

## F-E1: Leave filter

- **Used in:** S-E3
- **Type:** URL search params filter (no submit button)

| Field | Type | Default | Note |
|---|---|---|---|
| `status` | select (any/pending/approved/rejected) | any | URL param `?status=...` |
| `year` | year picker | current | `?year=2569` |

Apply on change (debounced 300ms).

## F-E2: Leave request

- **Used in:** S-E4
- **Submit:** `createLeaveRequest`

| Field | Type | Required | Validation | Default |
|---|---|---|---|---|
| `leaveType` | select (LeaveTypes) | Yes | enum from active types | "ลาพักร้อน" |
| `startDate` | date | Yes | ≥ today | today+1 |
| `endDate` | date | Yes | ≥ startDate, ≤ startDate+90 days | startDate |
| `reason` | textarea | Yes | 10–500 chars | empty |
| `attachment` | file | No | jpg/png/pdf, ≤5MB | none |

### Submit behavior

```
on submit:
  validate fields client-side (Zod)
  if attachment → upload to Supabase Storage first → get URL
  call createLeaveRequest({ leaveType, startDate, endDate, reason, attachmentUrl })
  if ok:
    toast T-E1 "ส่งคำขอเรียบร้อย"
    router.push('/leave')
  if !ok:
    toast T-E9 with error message
```

### Cancel

If form dirty → M-E4 confirm "ยกเลิก? — การกรอกจะไม่ถูกบันทึก"

## F-E3: Advance request

- **Used in:** S-E7
- **Submit:** `createAdvance`

| Field | Type | Required | Validation | Default |
|---|---|---|---|---|
| `amount` | number | Yes | ≥100, ≤ 5×BaseSalary (server-checked) | empty |
| `reason` | textarea | Yes | 10–500 chars | empty |

### Submit behavior

```
on submit:
  Zod validate
  call createAdvance({ amount, reason })
  if ok:
    toast T-E2 "ส่งคำขอเบิกเรียบร้อย"
    router.push('/advance')
  if !ok && reason='exceeds-limit':
    inline error "เกินวงเงินขั้นสูง — สูงสุด ฿XXX"
```

## F-E4: Profile edit

- **Used in:** S-E11
- **Submit:** `updateOwnProfile`

Editable fields:

| Field | Type | Validation |
|---|---|---|
| `phone` | tel | Thai mobile format `08XXXXXXXX` |
| `email` | email | RFC 5322 (also updates Supabase Auth email — re-verify required) |
| `address` | textarea | ≤500 chars |
| `addressPerID` | textarea | ≤500 chars |
| `emergencyContactName` | text | required if any emergency field set |
| `emergencyContactPhone` | tel | Thai format |
| `emergencyContactRelation` | text | optional |

Each section has its own [แก้ไข] toggle. Save section-by-section (smaller atomic updates).

## F-E5: Notification preferences

- **Used in:** S-E11 → "แจ้งเตือน" tab
- **Submit:** `updateNotificationPreferences`

Per event-type × channel matrix:

| Event | In-app | Email | LINE (V1.5) |
|---|---|---|---|
| Leave approved/rejected | ✓ (forced on) | ✓ | (V1.5) |
| Cash advance approved/rejected | ✓ (forced on) | ✓ | |
| Pay slip published | ✓ | ✓ | |
| Override alert (own slip) | ✓ | ✗ | |
| Marketing/announcements | ✗ | ✗ | |

Note: in-app for own approval/payment events forced on (can't disable — security).

---

# Modals

## M-E1: Cancel leave

- **Trigger:** Click "❌ ยกเลิกคำขอ" on /leave/[id] (only if Status=รออนุมัติ)
- **Title:** "ยกเลิกคำขอลา?"
- **Body:** "คำขอนี้จะถูกยกเลิก — ไม่สามารถกู้คืนได้"
- **Actions:**
  - [ไม่ใช่ตอนนี้] (secondary) → close
  - [ยืนยันยกเลิก] (danger) → call cancelOwnLeaveRequest → toast T-E4 → redirect /leave

## M-E2: Cancel advance

- **Trigger:** click "❌ ยกเลิกคำขอ" on /advance/[id] (only if Status=รออนุมัติ)
- Similar pattern to M-E1

## M-E3: Mobile PDF actions sheet

- **Trigger:** Click "📥 ดาวน์โหลด PDF" on mobile S-E10
- **Type:** Sheet from bottom (mobile native feel)
- **Actions:**
  - "ดาวน์โหลดไฟล์" → trigger download
  - "แชร์ผ่าน Share API" (if browser supports)
  - "ยกเลิก"

Desktop: skip modal, direct download.

## M-E4: Discard form

- **Trigger:** User clicks Cancel on dirty form OR navigates away
- **Title:** "ทิ้งการแก้ไข?"
- **Body:** "การกรอกของคุณจะไม่ถูกบันทึก"
- **Actions:** [กลับไปแก้ไข] / [ทิ้ง]

## M-E5: Image preview

- **Trigger:** Click receipt thumbnail on /advance/[id]
- **Layout:** Full-screen overlay with image centered, close X top-right
- **Actions:** Pinch zoom (mobile), [ดาวน์โหลด]

---

# Employee toasts

## T-E1: Leave submitted
- **Trigger:** After successful createLeaveRequest
- **Type:** success
- **Message:** "ส่งคำขอลาเรียบร้อย — รอแอดมินอนุมัติ"
- **Duration:** 4s

## T-E2: Advance submitted
- **Trigger:** After successful createAdvance
- **Type:** success
- **Message:** "ส่งคำขอเบิกเรียบร้อย — รอแอดมินอนุมัติ"

## T-E3: Profile saved
- **Type:** success
- **Message:** "บันทึกข้อมูลแล้ว"

## T-E4: Leave/advance cancelled
- **Type:** info
- **Message:** "ยกเลิกคำขอแล้ว"

## T-E5: PDF downloaded (mobile only feedback)
- **Type:** success
- **Message:** "ดาวน์โหลดสลิปแล้ว"
- **Duration:** 2s

## T-E6: New approval (push from FL-19)
- **Type:** info (high priority)
- **Message:** "คำขอลาของคุณได้รับการอนุมัติ"
- **Action:** [ดู] → navigate to /leave/[id]

## T-E7: Slip published (push)
- **Type:** info
- **Message:** "สลิปเงินเดือน {month} พร้อมแล้ว"
- **Action:** [ดูสลิป] → /payslip/[month]

## T-E8: Email change requires re-verify
- **Type:** warning
- **Message:** "เปลี่ยนอีเมลแล้ว — โปรดยืนยันลิงก์ที่ส่งไปอีเมลใหม่"
- **Duration:** 8s

## T-E9: Validation error / network failure
- **Type:** error
- **Message:** "เกิดข้อผิดพลาด — โปรดลองใหม่" (or specific message)

---

# Employee edge cases

## X-E1: File upload too large

- **Trigger:** Attachment > 5MB on F-E2
- **UX:** Inline error "ไฟล์ใหญ่เกินไป — สูงสุด 5MB"
- **Mitigation:** suggest compress image (V2: client-side compress)

## X-E2: Date range invalid (end before start)

- **Trigger:** F-E2 endDate < startDate
- **UX:** Inline error on endDate "วันสิ้นสุดต้องมากกว่าหรือเท่ากับวันเริ่ม"
- **Auto-fix:** When startDate changes, auto-set endDate = startDate if invalid

## X-E3: Profile email change conflict

- **Trigger:** User changes email to one already in use by another auth.users
- **UX:** Inline error "อีเมลนี้ถูกใช้แล้ว — กรุณาเลือกอีเมลอื่น"
- **Server:** validate uniqueness on submit

## X-E4: Deep link to non-own slip

- **Trigger:** User navigates to `/payslip/2026-04` but they don't have a slip for that month, OR tries `/admin/payroll/...` URL
- **UX:** 404 page (don't reveal existence)
- **RLS:** enforces at DB layer too (defense in depth)

## X-E5: Empty states catalog

| Page | Empty state message | Action |
|---|---|---|
| /attendance | ยังไม่มีบันทึกในเดือนนี้ | (none) |
| /leave list | ยังไม่มีคำขอลา | [+ ส่งคำขอแรก] |
| /advance list | ยังไม่มีคำขอเบิก | [+ ขอเบิกครั้งแรก] |
| /payslip | ยังไม่มีสลิป — Admin จะเผยแพร่ปลายเดือน | (none) |
| Notifications | ไม่มีการแจ้งเตือนใหม่ | (none) |

---

# Acceptance criteria (employee section)

Before marking employee section "done":

- ✅ Bottom-nav 5 tabs work, active state correct per route
- ✅ Dashboard loads in < 2s, all 5 cards display
- ✅ Leave full flow works: request → admin approve → see status → check attendance auto-created
- ✅ Advance full flow works: request → admin approve + receipt → see receipt → see deduction in next slip
- ✅ Pay slip displays correctly with Thai numerals + tabular alignment
- ✅ PDF download works (presigned URL, opens in browser)
- ✅ Profile edit per section works
- ✅ Notification preferences save
- ✅ Mobile responsive (320–480px tested on Chrome DevTools)
- ✅ All toasts in Thai
- ✅ All empty states show correctly
- ✅ Cancel modal prevents accidental discard

---

# Cross-references

- Flows: [FL-5 leave](./flows.md#fl-5-submit-leave-request), [FL-6 advance](./flows.md#fl-6-submit-cash-advance), [FL-7 payslip](./flows.md#fl-7-view-monthly-pay-slip), [FL-8 profile](./flows.md#fl-8-update-profile)
- Navigation: [navigation.md §2](./navigation.md#employee--bottom-navigation-mobile-first)
- Design: [design-system.md](../design-system.md)
- Architecture: [architecture.md](../architecture.md)
- Backend: [feature-spec.md](../feature-spec.md)
