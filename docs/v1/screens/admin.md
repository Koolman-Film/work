# Admin Screens

23 screens, 12 forms, 9 modals/drawers, 11 toasts, 8 edge cases — for Admin role.

**Section prefix:** `N` (admiN — to distinguish from Employee `E`)

---

## Index

### Screens (23)

**Dashboard + Employee management**
- [S-N1: Admin Dashboard](#s-n1-admin-dashboard) ⭐
- [S-N2: Employee list](#s-n2-employee-list)
- [S-N3: Employee new](#s-n3-employee-new)
- [S-N4: Employee detail/edit](#s-n4-employee-detail)
- [S-N5: Bulk CSV import](#s-n5-bulk-import)

**Approval inboxes**
- [S-N6: Leave approval inbox](#s-n6-leave-inbox) ⭐
- [S-N7: Advance approval inbox](#s-n7-advance-inbox)
- [S-N8: Advance detail + receipt upload](#s-n8-advance-detail)

**Attendance**
- [S-N9: Attendance records](#s-n9-attendance-records)
- [S-N10: Manual attendance entry](#s-n10-manual-attendance)
- [S-N11: Excel upload (preview + commit)](#s-n11-excel-upload) ⭐

**Payroll** (most critical module)
- [S-N12: Payroll months list](#s-n12-payroll-months)
- [S-N13: Payroll monthly run](#s-n13-payroll-monthly) ⭐⭐
- [S-N14: Per-employee payroll detail](#s-n14-payroll-per-employee)

**Accounting + Audit**
- [S-N15: Accounting export (PEAK)](#s-n15-accounting-export) ⭐
- [S-N16: Audit log](#s-n16-audit-log)

**Settings (7 sub-pages — similar CRUD pattern)**
- [S-N17: Settings general](#s-n17-settings-general)
- [S-N18: Branches](#s-n18-settings-branches)
- [S-N19: Departments](#s-n19-settings-departments)
- [S-N20: Accounting groups](#s-n20-settings-groups)
- [S-N21: Leave types](#s-n21-settings-leave-types)
- [S-N22: Holidays](#s-n22-settings-holidays)
- [S-N23: Payroll config](#s-n23-settings-payroll-config)

### Forms (12)
- [F-N1: Employee form](#f-n1-employee-form)
- [F-N2: Bulk CSV import](#f-n2-bulk-import)
- [F-N3: Leave approval](#f-n3-leave-approval)
- [F-N4: Advance approval (with receipt)](#f-n4-advance-approval)
- [F-N5: Manual attendance entry](#f-n5-manual-attendance)
- [F-N6: Excel upload + preview](#f-n6-excel-upload)
- [F-N7: Override deduction](#f-n7-override-deduction)
- [F-N8: Override payroll field](#f-n8-override-payroll-field)
- [F-N9: Accounting export filter](#f-n9-export-filter)
- [F-N10: Audit log filter](#f-n10-audit-filter)
- [F-N11: Settings CRUD (generic)](#f-n11-settings-crud)
- [F-N12: Payroll config edit](#f-n12-payroll-config)

### Modals + Drawers (9)
- [M-N1: Confirm bulk approve/reject](#m-n1-bulk-confirm)
- [M-N2: Trigger payroll confirm](#m-n2-trigger-payroll)
- [M-N3: Override deduction](#m-n3-override-deduction-modal)
- [M-N4: Publish payroll confirm](#m-n4-publish-payroll)
- [M-N5: Unlock published slip](#m-n5-unlock-slip)
- [D-N1: Leave approval drawer](#d-n1-leave-drawer)
- [D-N2: Advance approval drawer](#d-n2-advance-drawer)
- [D-N3: Audit log detail drawer](#d-n3-audit-drawer)
- [D-N4: Notification drawer (cross-cutting)](#d-n4-notification-drawer)

### Toasts (11)
- [T-N1 → T-N11](#admin-toasts)

### Edge cases (8)
- [X-N1 → X-N8](#admin-edge-cases)

---

## Layout (all admin screens)

All admin screens use `<AdminLayout>` (sidebar + topbar):

```
┌──────────┬───────────────────────────────────────┐
│  [Logo]  │  Topbar: breadcrumb · 🔔 (3) · 👤      │ ← 56px
│ ──────  ├───────────────────────────────────────┤
│ 🏠 หน้าหลัก │                                        │
│ 👥 พนักงาน │  PAGE TITLE                            │
│ 📋 อนุมัติลา│  ─────                                  │
│ 💰 อนุมัติเบิก│                                        │
│ 📅 ลงเวลา │  Filter / search bar                   │
│ 💸 เงินเดือน│  ─────                                  │
│ 📊 บัญชี   │                                        │
│ 📜 Audit │  CONTENT (table / form / cards)        │
│ ⚙️ ตั้งค่า   │                                        │
│           │                                        │
│ ──────   │                                        │
│ 👤 Profile│                                        │
│ ⏏ ออก     │                                        │
│  240px    │                                        │
└──────────┴───────────────────────────────────────┘
```

See [navigation.md §2](./navigation.md#admin--sidebar-desktop-first) for full nav details.

**Mobile (<768px):** sidebar collapses to drawer triggered by hamburger.

---

# Screens

## S-N1: Admin Dashboard

- **Path:** `/admin/dashboard`
- **Role:** Admin
- **Purpose:** Daily snapshot — what needs attention, key KPIs

### Wireframe

```
┌──────────┬───────────────────────────────────────────────┐
│ Sidebar  │ หน้าหลัก                              🔔 5  👤 │
│          ├───────────────────────────────────────────────┤
│ ✓ 🏠     │                                               │
│   👥     │ ภาพรวม Koolman HR — Koolman               │
│   📋 (8) │                                               │
│   💰 (3) │ ┌───────┬───────┬───────┬───────┐             │
│   📅     │ │ คำขอลา │ คำขอเบิก│ ยอดหัก  │ พนักงาน│             │
│   💸 ⚠   │ │ รออนุ.│ รออนุ. │ เดือน  │ ทั้งหมด │             │
│   📊     │ │   8   │   3   │ ฿4.2K │  124   │             │
│   📜     │ └───────┴───────┴───────┴───────┘             │
│   ⚙️     │                                               │
│          │ ┌─────────────────────┬──────────────────────┐ │
│          │ │ คำขอที่รอดำเนินการ      │ ใครลาวันนี้           │ │
│          │ ├─────────────────────┼──────────────────────┤ │
│          │ │ • ส้ม - ลาพักร้อน     │ 1. นภา (ลาป่วย)        │ │
│          │ │ • บอย - ลาป่วย        │ 2. เอ๋ (ลากิจ)         │ │
│          │ │ • พลอย - เบิก ฿5K    │ 3. ตุ่น (สาย)          │ │
│          │ │ ดูทั้งหมด →            │ ดูปฏิทิน →             │ │
│          │ └─────────────────────┴──────────────────────┘ │
│          │                                               │
│          │ ┌──────────────────────────────────────────┐  │
│          │ │  Trend ยอดหัก 6 เดือนหลัง                  │  │
│          │ │  [chart]                                  │  │
│          │ └──────────────────────────────────────────┘  │
│          │                                               │
│          │ ┌──────────────────────────────────────────┐  │
│          │ │ ⚠ มีสลิป Draft ของ เม.ย. 2569 — ยังไม่ publish│  │
│          │ │                          [ไปจัดการ →]      │  │
│          │ └──────────────────────────────────────────┘  │
│          │                                               │
└──────────┴───────────────────────────────────────────────┘
```

### Components

| Element | Component |
|---|---|
| KPI card row | 4 `<KpiCard>` with number + label |
| Pending requests list | `<Card>` with rows + link |
| Today on leave list | similar |
| Trend chart | `recharts` line chart, 6 months |
| Alert banner | `<Alert>` warning variant + CTA |

### Server Actions

- `getAdminDashboardData()` — single fetch
  - Returns: `{ kpis, pendingItems, todayOnLeave, trendData, alerts }`

### States

- **Loading:** skeleton cards
- **No pending items:** "ไม่มีรายการรออนุมัติ ✓"
- **No payroll alert:** hide alert banner

---

## S-N2: Employee list

- **Path:** `/admin/employees`
- **Purpose:** Browse, filter, search, manage employees

### Wireframe

```
พนักงาน                               [📤 Bulk Import] [+ เพิ่มพนักงาน]

┌─────────────────────────────────────────────────────────────┐
│ Filters: [ค้นหา ID/ชื่อ...] [แผนก ▼] [สาขา ▼] [Status ▼]    │
└─────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────┐
│ ☐ │ ID    │ ชื่อ        │ แผนก    │ สาขา      │ ฐาน    │ สถานะ │ ⋮│
├────────────────────────────────────────────────────────────┤
│ ☐ │ EMP-1 │ ตงค์ สมศรี   │ Tech    │ สำนักงาน  │ 30,000 │ Active│ ▶│
│ ☐ │ EMP-2 │ ส้ม สมศักดิ์ │ Sales   │ สำนักงาน  │ 25,000 │ Active│ ▶│
│ ☐ │ EMP-3 │ บอย สุวรรณ  │ Install │ บางกะปิ   │ 22,000 │ Probation│▶│
│ ...                                                       │
└────────────────────────────────────────────────────────────┘

[ Bulk: 0 selected ]    Pagination: ‹ 1 2 3 ... 13 ›
```

### Components

- `<DataTable>` with sticky header, sortable columns
- `<Input>` search (debounced)
- `<Select>` filters
- Bulk action bar (only when rows selected)

### Server Actions

- `listEmployees(filter, pagination)`
- `archiveEmployees(ids[])` for bulk
- `exportEmployees(filter)` to CSV

### Interactions

- Click row → `/admin/employees/[id]`
- Click `▶` icon → `/admin/employees/[id]` (same)
- Click `⋮` → row menu: Edit / Archive / Resend Invite / Export
- Bulk select → action bar appears: Archive selected, Export selected

### States

- **Empty:** "ยังไม่มีพนักงาน — [+ เพิ่มพนักงานคนแรก] หรือ [Bulk Import]"
- **No search results:** "ไม่พบ — ลองคำค้นอื่น"

---

## S-N3: Employee new

- **Path:** `/admin/employees/new`
- **Purpose:** Create new employee → triggers invite email

### Wireframe

Wizard with 3 steps via `<Stepper>`:

```
[① ข้อมูลพื้นฐาน]──[② งาน + เงินเดือน]──[③ บัญชี + อื่นๆ]──[ตรวจสอบ]
```

Or single long form (V1 simpler — single page).

### Form: see [F-N1](#f-n1-employee-form)

---

## S-N4: Employee detail/edit

- **Path:** `/admin/employees/[id]`
- **Purpose:** View + edit single employee

### Layout

Tabs:
- **ข้อมูลพื้นฐาน** — name, contact, address, etc.
- **งาน** — branch, dept, role, salary
- **บัญชีธนาคาร**
- **บันทึกการลา/ขาด** — link to /admin/attendance filtered by this emp
- **ประวัติเงินเดือน** — link to /admin/payroll filtered

Action buttons in header:
- [Resend Invite] (if `auth_user_id` not set yet)
- [Archive] (M-N modal)
- [Rehire] (only if archived)

---

## S-N5: Bulk import

- **Path:** `/admin/employees/import`
- **Purpose:** Onboarding — bulk create employees from CSV

### Wireframe

```
นำเข้าพนักงาน                                          [← กลับ]

Step 1: ดาวน์โหลด template
[📥 employees-template.csv]
└── columns: email, fullName, branch, department, jobTitle, baseSalary, ...

Step 2: อัปโหลดไฟล์
┌──────────────────────────────────────┐
│  📎  ลากไฟล์มาวาง หรือ คลิกเลือก         │
│      .csv only · ≤2MB                 │
└──────────────────────────────────────┘

Step 3: ตรวจสอบ + บันทึก
[Preview table — appears after upload]
```

After upload, preview:

```
✅ 47 rows OK  ⚠️ 3 rows with issues

┌────────────────────────────────────────────┐
│ ☐ │ # │ Email          │ Name      │ Status │
├────────────────────────────────────────────┤
│ ☐ │ 1 │ a@finnix.com   │ Anna Lee  │ ✅      │
│ ☐ │ 2 │ b@finnix.com   │ Bob Brown │ ✅      │
│ ☐ │ 3 │ INVALID        │ ...       │ ⚠ email│
│ ☐ │ 4 │ d@example.com  │ ...       │ ⚠ dup  │
└────────────────────────────────────────────┘

Issues: 1 invalid email · 1 duplicate · 1 unknown department

[ Skip invalid rows ] [ บันทึก 47 rows ]   [ ยกเลิก ]
```

### Form: see [F-N2](#f-n2-bulk-import)

---

## S-N6: Leave approval inbox

- **Path:** `/admin/leave`
- **Purpose:** Review pending leave requests, approve/reject in bulk or individual

### Wireframe

```
อนุมัติคำขอลา                                                    🔔 5

Filter: [รออนุมัติ ▼]  [แผนก ▼]  [ประเภท ▼]  [วันที่ ▼]

┌────────────────────────────────────────────────────────────┐
│ ☐ │ พนักงาน        │ ประเภท     │ วันที่         │ วัน│ สถานะ │
├────────────────────────────────────────────────────────────┤
│ ☐ │ ส้ม สมศักดิ์    │ พักร้อน     │ 12-13 พ.ค.   │ 2 │ ⏳     │ ▶
│ ☐ │ บอย สุวรรณ    │ ป่วย       │ 8 พ.ค.       │ 1 │ ⏳     │ ▶
│ ☐ │ ฝน นภา       │ กิจ         │ 15 พ.ค.      │ 1 │ ⏳     │ ▶
│ ☐ │ เอ๋ พรพรรณ   │ พักร้อน     │ 18-22 พ.ค.   │ 5 │ ⏳     │ ▶
└────────────────────────────────────────────────────────────┘

[ ✅ Approve selected (0) ]  [ ❌ Reject selected (0) ]
```

Click row → drawer [D-N1](#d-n1-leave-drawer) opens with full detail.

### States

- **Empty (all done):** "ไม่มีคำขอรออนุมัติ ✓"
- **Filtered to approved/rejected:** historical view, no bulk actions

### Interactions

- Filter by: status / department / type / date range
- Click row → drawer opens
- Bulk select → bulk approve/reject (M-N1 confirm modal)

---

## S-N7: Advance approval inbox

Same pattern as S-N6 but for cash advance.

```
อนุมัติคำขอเบิก                                                 🔔 3

Filter: [รออนุมัติ ▼]  [แผนก ▼]

┌────────────────────────────────────────────────────────────┐
│ ☐ │ พนักงาน        │ จำนวน      │ ขอเมื่อ        │ สถานะ │
├────────────────────────────────────────────────────────────┤
│ ☐ │ พลอย ดารา    │ ฿5,000     │ 28 เม.ย. 14:30 │ ⏳    │ ▶
│ ☐ │ ตุ่น สมหวัง   │ ฿2,500     │ 27 เม.ย. 16:00 │ ⏳    │ ▶
└────────────────────────────────────────────────────────────┘
```

Click row → `/admin/advance/[id]` (S-N8 — full page, not drawer, because needs receipt upload).

---

## S-N8: Advance detail + receipt upload

- **Path:** `/admin/advance/[id]`
- **Purpose:** Approve/reject with receipt image attachment

### Wireframe

```
← กลับ              คำขอเบิก #123                      [Audit log]

┌─ Employee info ──────────────────┐  ┌─ Request ──────────────┐
│  ┌──┐  ตงค์ สมศรี                  │  │  ฿ 5,000              │
│  │T │  EMP-001 · Tech              │  │  ขอเมื่อ 28 เม.ย. 14:30  │
│  └──┘  สำนักงานใหญ่                  │  │                       │
│                                  │  │  เหตุผล:                │
│  เงินเดือนพื้นฐาน: ฿30,000           │  │  ค่ารักษาพยาบาลฉุกเฉิน  │
│  ขอเบิกเดือนนี้: 1 ครั้ง (รวมนี้)     │  │                       │
│  ขอเบิกปีนี้: ฿15,000              │  │                       │
└──────────────────────────────────┘  └───────────────────────┘

┌─ Action: อนุมัติ ────────────────────────────────────────┐
│                                                       │
│ แนบสลิปการโอน *                                         │
│ ┌──────────────────────────────────────────────────┐  │
│ │  📎 ลากรูปสลิปมาวาง                                │  │
│ │     หรือ คลิกเลือก                                  │  │
│ │     JPG, PNG, PDF · ≤5MB                          │  │
│ └──────────────────────────────────────────────────┘  │
│                                                       │
│ หมายเหตุ (optional):                                    │
│ [textarea]                                            │
│                                                       │
│ [ ✅ อนุมัติพร้อมแนบสลิป ]  [ ❌ ปฏิเสธ ]                  │
└───────────────────────────────────────────────────────┘
```

After approve: receipt uploads to Supabase Storage, status updated, employee notified.

### Form: see [F-N4](#f-n4-advance-approval)

---

## S-N9: Attendance records

- **Path:** `/admin/attendance`
- **Purpose:** Browse all attendance records, filter, override

### Wireframe

```
ลงเวลา                                  [+ คีย์มือ] [📤 อัปโหลด Excel]

Filter: [เดือน 2026-04 ▼] [พนักงาน ▼] [ประเภท ▼]

┌──────────────────────────────────────────────────────────────┐
│ ID  │ พนักงาน    │ วันที่    │ ประเภท   │ Duration │ ยอดหัก │ ⋮ │
├──────────────────────────────────────────────────────────────┤
│ 001 │ ตงค์      │ 1 เม.ย.  │ ทำงาน    │ 1 วัน   │ -      │ ▶ │
│ 002 │ ส้ม      │ 2 เม.ย.  │ 🟧 สาย   │ 30 นาที │ ฿250   │ ▶ │
│ 003 │ บอย      │ 3 เม.ย.  │ 🟦 ป่วย  │ 1 วัน   │ ฿0     │ ▶ │
│ 004 │ ตงค์      │ 5 เม.ย.  │ ❌ ขาด    │ 1 วัน   │ ฿1,000 │ ▶ │
│       (auto-calc)                                          │
│ 005 │ ฝน       │ 6 เม.ย.  │ 🟧 สาย   │ 45 นาที │ ฿500 ✏ │ ▶ │
│       (manual override — orange dot)                       │
└──────────────────────────────────────────────────────────────┘
```

Override indicator (✏ icon + colored dot) shows DeductionMode='manual'.

### Server Actions

- `listAttendance(filter)`
- `overrideDeduction(id, amount, note)` — see M-N3

### Click row

Opens drawer with details + override option [F-N7].

---

## S-N10: Manual attendance

- **Path:** `/admin/attendance/manual`
- **Purpose:** Admin keys in attendance (when employee forgot to scan, etc.)

### Form: see [F-N5](#f-n5-manual-attendance)

---

## S-N11: Excel upload

- **Path:** `/admin/attendance/upload`
- **Purpose:** Bulk import from scanner Excel file
- **Critical:** This is a key V1 feature — fallback for scanner integration

### Multi-step wireframe

**Step 1: Upload**

```
นำเข้า Excel จากเครื่องสแกน                                    [← กลับ]

ดาวน์โหลด template (ถ้ายังไม่มี): [📥 attendance-template.xlsx]

┌──────────────────────────────────────┐
│  📎  ลากไฟล์ Excel มาวาง                │
│      หรือ คลิกเลือก                     │
│      .xlsx only · ≤5MB                 │
└──────────────────────────────────────┘
```

**Step 2: Processing (Inngest job)**

```
กำลังประมวลผลไฟล์ scanner_2026-04-30.xlsx ... 78%

[progress bar]

นี่เป็นการ processing แบบ async — สามารถปิดหน้านี้ไปได้
ระบบจะแจ้งเตือนเมื่อพร้อม preview
```

**Step 3: Preview + commit**

```
รีวิวการนำเข้า                                          [← กลับ]

scanner_2026-04-30.xlsx · 500 rows · uploaded 5 พ.ค. 16:00

✅ 487 rows OK    ⚠️ 13 rows with issues

[ทั้งหมด] [✅ Valid] [⚠️ Issues]   ← tab filter

┌─────────────────────────────────────────────────────────┐
│ ☐ │ # │ EmpID │ Date     │ ClockIn│ Status │ Issue       │
├─────────────────────────────────────────────────────────┤
│ ☑ │ 1 │ EMP-1 │ 1/4/2026 │ 09:00  │ ทำงาน  │ -          │
│ ☑ │ 2 │ EMP-2 │ 1/4/2026 │ 09:15  │ สาย    │ -          │
│ ☐ │ 3 │ EMP-? │ 1/4/2026 │ 09:00  │ ?      │ ⚠ EmpID ไม่พบ│
│ ☐ │ 4 │ EMP-1 │ 1/4/2026 │ 09:00  │ ทำงาน  │ ⚠ duplicate│
└─────────────────────────────────────────────────────────┘

Issues:
  ⚠ 8 EmpID ไม่พบ — [Map manually]
  ⚠ 5 duplicate — [Skip all]

[ ✅ บันทึก 487 rows ]    [ ยกเลิก ]
```

### Form: see [F-N6](#f-n6-excel-upload)

---

## S-N12: Payroll months list

- **Path:** `/admin/payroll`
- **Purpose:** Choose month to run payroll

### Wireframe

```
เงินเดือน                                              [+ เริ่มเดือนใหม่]

┌──────────────────────────────────────────────────────────┐
│ เดือน              │ พนักงาน│ ยอดสุทธิ      │ สถานะ      │
├──────────────────────────────────────────────────────────┤
│ พ.ค. 2569         │   124   │ -           │ ⏳ ยังไม่เริ่ม│
│ เม.ย. 2569 ⭐     │   124   │ ฿3,892,450  │ 📝 Draft   │ ▶
│ มี.ค. 2569         │   122   │ ฿3,810,200  │ ✅ Published│ ▶
│ ก.พ. 2569         │   120   │ ฿3,750,000  │ ✅ Published│ ▶
└──────────────────────────────────────────────────────────┘
```

⭐ = current month draft. Click → S-N13.

---

## S-N13: Payroll monthly run

- **Path:** `/admin/payroll/[month]`
- **Purpose:** Calculate, review, override, publish payroll for month
- **Priority:** ⭐⭐ MOST CRITICAL screen in the app

### Wireframe

```
← กลับ          เงินเดือน เม.ย. 2569 [📝 Draft]                 [⏷]

124 พนักงาน · เริ่มประมวลผล 5 พ.ค. 16:00 · เผยแพร่ -

┌──────────────────────────────────────────────────┐
│  สรุปเดือน                                        │
│                                                  │
│  รวมรายรับ      ฿4,500,000                        │
│  รวมรายหัก      ฿607,550                          │
│  รวมสุทธิ       ฿3,892,450                        │
│                                                  │
│  ค่าใช้จ่ายบริษัท    ฿2,892,450 (75%)              │
│  จ่ายแทน-รับคืน    ฿1,000,000 (25%)              │
└──────────────────────────────────────────────────┘

[ ⚡ Trigger Payroll ]  [ 📤 Publish all 124 slips ]

⚠ Override warnings (3)
  • EMP-3 (บอย): NetPay < ฿20,000 — เคย OT?
  • EMP-7 (ฝน): Income_Other = ฿0 (last month มีคอม)
  • EMP-12 (เอ๋): หักรวม > 30% — ตรวจสอบ

────────────────

Filter: [ทุกแผนก ▼] [ทุก status ▼] [⚠ Warnings only]

┌──────────────────────────────────────────────────────────────────┐
│ ID  │ ชื่อ      │ แผนก │ ฐาน    │ อื่น  │ ป.ส. │ เบิก  │ ลา/สาย │ สุทธิ  │
├──────────────────────────────────────────────────────────────────┤
│ E-1 │ ตงค์      │ Tech │ 30,000 │ 5,000│ 750 │ 2,000│ 833    │ 31,417│ ✏
│ E-2 │ ส้ม      │ Sale │ 25,000 │ 3,000│ 750 │ -    │ 1,500  │ 25,750│ ✓
│ E-3 │ บอย⚠   │ Inst │ 22,000 │ -    │ 750 │ -    │ 2,200  │ 19,050│ ✏
│ ...                                                              │
└──────────────────────────────────────────────────────────────────┘
```

### Status flow

- **ยังไม่เริ่ม (Pending):** before Trigger
- **กำลังคำนวณ (Calculating):** Inngest fan-out running, Realtime progress shown
- **📝 Draft:** all slips generated, Admin reviewing
- **✅ Published:** locked, emails sent, Realtime "X / 124 sent"
- **🔒 Published + revisions exist:** if Admin unlocked any slip

### Click row

Opens [S-N14](#s-n14-payroll-per-employee) per-emp drilldown.

### Click ✏

Opens [M-N3 / M-N6 override modal](#m-n6-override-payroll-field).

---

## S-N14: Payroll per-employee

- **Path:** `/admin/payroll/[month]/[empId]`
- **Purpose:** Detailed slip view + override per-field with audit

### Wireframe

```
← เม.ย. 2569       สลิป EMP-001 ตงค์ สมศรี                    [Audit log]

┌─ Employee info ──────────────────────┐
│ ตงค์ สมศรี · EMP-001                   │
│ Tech Department · สำนักงานใหญ่         │
│ ฐานเงินเดือน: ฿30,000                  │
└──────────────────────────────────────┘

┌─ Income ─────────────────────────────────┐
│ เงินเดือนพื้นฐาน      ฿30,000.00           │
│ รายได้อื่น           ฿5,000.00 ✏          │
│  (commission คีย์มือ)                     │
│ ─                                        │
│ รวม              ฿35,000.00              │
└──────────────────────────────────────────┘

┌─ Deductions ─────────────────────────────┐
│ ประกันสังคม          ฿750.00 (auto 5%)    │
│ เบิกเงินล่วงหน้า     ฿2,000.00 (1 รายการ)  │
│ ขาด/ลา/มาสาย       ฿833.00 (3 รายการ)   │
│ หักหนี้              ฿0 ✏                │
│ ─                                        │
│ รวม              ฿3,583.00               │
└──────────────────────────────────────────┘

┌─ NetPay ─────────────────────────────────┐
│   ฿31,417.00                             │
│   ✓ Published 30 เม.ย. · email sent       │
│   [📥 Download PDF] [🔓 Unlock for revision]│
└──────────────────────────────────────────┘

History:
  • 30 เม.ย. 16:00 — Published by Admin
  • 30 เม.ย. 14:30 — Income_Other override 0 → 5,000 (Admin: "April commission")
  • 30 เม.ย. 14:00 — Auto-calculated
```

### Click ✏ on field

Opens [M-N6 override modal](#m-n6-override-payroll-field) — required Note, audit log entry.

---

## S-N15: Accounting export

- **Path:** `/admin/accounting`
- **Purpose:** Generate PEAK CSV / summary Excel for monthly accounting

### Wireframe

```
Export ลงบัญชี (PEAK Account)

Filter:
  เดือน:        [เม.ย. 2569 ▼]
  Group:       [ทุกกลุ่ม ▼] (or specific AccountingGroup)
  Branch:      [ทุกสาขา ▼]
  Status:      ✅ Published only (auto)

┌──────────────────────────────────────────────────┐
│  Preview                                         │
│                                                  │
│  124 พนักงาน · ฿3,892,450 NetPay total            │
│                                                  │
│  By group:                                       │
│  • ค่าใช้จ่ายบริษัท   85 emp · ฿2,892,450          │
│  • จ่ายแทน-รับคืน    39 emp · ฿1,000,000          │
└──────────────────────────────────────────────────┘

[ 📤 Export PEAK CSV ]   [ 📊 Export Excel summary ]

Recent exports:
  • peak-2026-04-all.csv (5 พ.ค. 17:00 by Admin)
  • peak-2026-03-all.csv (1 เม.ย. 17:00 by Admin)
```

### Form: see [F-N9](#f-n9-export-filter)

---

## S-N16: Audit log

- **Path:** `/admin/audit`
- **Purpose:** View all admin actions for compliance + investigation

### Wireframe

```
Audit Log                                            [📥 Export CSV]

Filter:
  ช่วงวันที่: [1-30 เม.ย. 2569]
  Actor:    [ทุกคน ▼]
  Action:   [ทุกประเภท ▼]
  Entity:   [ทุกประเภท ▼]
  ค้นหา:    [...]

┌──────────────────────────────────────────────────────────────┐
│ Time           │ Actor  │ Action            │ Entity  │      │
├──────────────────────────────────────────────────────────────┤
│ 30/4 16:00    │ Admin1 │ payroll.publish   │ April   │ ▶ 124│
│ 30/4 14:30    │ Admin1 │ payroll.override  │ EMP-001 │ ▶    │
│ 28/4 17:00    │ Admin2 │ advance.approve   │ #123    │ ▶    │
│ 25/4 09:00    │ Admin1 │ employee.archive  │ EMP-50  │ ▶    │
│ ...                                                          │
└──────────────────────────────────────────────────────────────┘
```

Click row → drawer [D-N3](#d-n3-audit-drawer) with full before/after JSON.

---

## S-N17: Settings (general)

- **Path:** `/admin/settings`
- **Purpose:** Index page for all settings sub-tabs

### Layout

Side-tabs (vertical) with sub-pages:

```
ตั้งค่า

┌──── Sub-nav ────┬─────────────────────────┐
│ ✓ ทั่วไป            │  ทั่วไป                  │
│   สาขา           │                         │
│   แผนก           │  ชื่อบริษัท: Koolman    │
│   กลุ่มลงบัญชี      │  Logo: [upload]            │
│   ประเภทลา         │  เวลาทำงาน: Tue-Sun 9-18  │
│   วันหยุด           │  รอบจ่ายเงิน: รายเดือน      │
│   เงินเดือน config │  ...                      │
└──────────────────┴─────────────────────────┘
```

---

## S-N18 → S-N22: Settings sub-pages (similar CRUD pattern)

Each sub-page follows same pattern:

### Generic CRUD layout

```
Settings > {Subject}                         [+ เพิ่ม]

┌──────────────────────────────────────────┐
│ ชื่อ            │ ใช้งาน  │ Action       │
├──────────────────────────────────────────┤
│ Bangkok Main   │ ✓       │ ✏ ลบ        │
│ Pattaya Branch │ ✓       │ ✏ ลบ        │
│ Old Branch     │ ✗       │ ✏           │
└──────────────────────────────────────────┘
```

[+ เพิ่ม] / ✏ Edit → drawer or modal with form.

| Page | Path | Subject |
|---|---|---|
| S-N18 Branches | /admin/settings/branches | Name, Address, IsActive |
| S-N19 Departments | /admin/settings/departments | Name, IsActive |
| S-N20 Accounting Groups | /admin/settings/groups | Name, AccountingCode (PEAK), Description |
| S-N21 Leave Types | /admin/settings/leave-types | Name, DefaultQuota, IsPaid, RequiresDoc, ResetPolicy |
| S-N22 Holidays | /admin/settings/holidays | Date, Name, Type (national/company), WorkPayMultiplier |

### Form: see [F-N11](#f-n11-settings-crud)

---

## S-N23: Payroll config

- **Path:** `/admin/settings/payroll-config`
- **Purpose:** Edit system-wide payroll formulas + rates

### Wireframe

Key-value editor with section grouping:

```
ตั้งค่าเงินเดือน

─ ประกันสังคม
  อัตรา: [5] %
  เพดาน: [฿750] / เดือน

─ ลงเวลา / หักเงิน
  สาย threshold: [15] นาที
  สูตรหักขาดงาน: [BaseSalary / 30 ▼]
    หรือ: BaseSalary / working_days_in_month

─ รอบจ่าย
  วันตัดรอบ: [สิ้นเดือน ▼]
  วันจ่าย:   [สิ้นเดือน ▼]

[💾 บันทึกการเปลี่ยนแปลง]
```

### Form: see [F-N12](#f-n12-payroll-config)

---

# Forms

## F-N1: Employee form

- **Used in:** S-N3 (new), S-N4 (edit)
- **Submit:** `createEmployee` / `updateEmployee`

### Field groups

**Basic info** (required for new)

| Field | Type | Required | Validation |
|---|---|---|---|
| `email` | email | Yes | RFC 5322, unique |
| `fullName` | text | Yes | 2–100 chars |
| `phone` | tel | No | Thai mobile format |
| `nationalId` | text | No | 13-digit Thai ID + checksum |

**Work info**

| Field | Type | Required | Validation |
|---|---|---|---|
| `branchId` | select (Branches) | Yes | active branches only |
| `department` | select (Departments) | Yes | from Departments |
| `jobTitle` | text | Yes | |
| `startDate` | date | Yes | ≤ today + 60 days |
| `employmentStatus` | select | Yes | Probation / Regular |
| `baseSalary` | number | Yes | > 0 |
| `probationSalaryRate` | number | If Probation | > 0 |
| `role` | select | Yes | User / Admin / Owner |
| `accountingGroupId` | select | Yes | from AccountingGroups |

**Bank + extras**

| Field | Type | Required | Validation |
|---|---|---|---|
| `bankAccount` | text | No | 10-12 digit |
| `bankName` | select | No | dropdown |
| `socialSecurityNo` | text | No | |
| `address` | textarea | No | |
| `addressPerID` | textarea | No | |
| `emergencyContact` | composite (name/phone/relation) | No | |

### Submit behavior

```
on submit:
  Zod validate
  if create:
    insertEmployee → status=Pending, send invite email
    if rehire detected (NationalID match) → reuse auth_user_id
  if update:
    updateEmployee → audit log
  toast T-N1
  redirect /admin/employees
```

---

## F-N2: Bulk CSV import

- **Used in:** S-N5
- **Submit:** `bulkImportEmployees(rows[])`

### Behavior

1. User uploads CSV
2. Server-side parse (PapaParse) → return preview + validation
3. User selects rows to import (default: all valid rows)
4. Submit → server inserts row-by-row + sends invite emails (rate-limited)
5. Show progress bar, success count

### Validation per row

- email format + uniqueness (within file + existing)
- required fields present
- `branch`, `department` lookup against existing
- `baseSalary` > 0

---

## F-N3: Leave approval

- **Used in:** D-N1 drawer (S-N6)
- **Submit:** `approveLeaveRequest(id, note)` / `rejectLeaveRequest(id, reason)`

| Field | Type | Required | Validation |
|---|---|---|---|
| `note` (approve) | textarea | No | ≤500 chars |
| `reason` (reject) | textarea | Yes for reject | 10–500 chars |

Approve auto-creates Attendance records for each day. See [FL-5](./flows.md#fl-5-submit-leave-request).

---

## F-N4: Advance approval

- **Used in:** S-N8
- **Submit:** `approveAdvance(id, receiptFile, note)` / `rejectAdvance(id, reason)`

Approve form requires:
- `receiptFile` (Yes — JPG/PNG/PDF, ≤5MB) → uploaded to Supabase Storage first
- `note` (No)

Reject form requires:
- `reason` (Yes — 10–500 chars)

---

## F-N5: Manual attendance

- **Used in:** S-N10
- **Submit:** `createAttendance(data)`

| Field | Type | Required | Validation |
|---|---|---|---|
| `employeeId` | combobox | Yes | active emp only |
| `date` | date | Yes | ≤ today |
| `type` | select | Yes | enum |
| `duration` | text | Conditional | required for "ลา" types |
| `deductionAmount` | number | Auto-filled | editable, override → DeductionMode='manual' |
| `note` | textarea | If override | ≤500 chars |

---

## F-N6: Excel upload + preview

- **Used in:** S-N11
- **Submit:** `commitAttendance(rows[])` after preview reviewed

Upload triggers async parse (Inngest job).

Preview table allows row-by-row select/skip + manual EmpID mapping for unknown rows.

---

## F-N7: Override deduction

- **Used in:** M-N3 (modal from S-N9)
- **Submit:** `overrideDeduction(id, amount, note)`

| Field | Required | Validation |
|---|---|---|
| `amount` | Yes | ≥0 |
| `note` (เหตุผล) | Yes | 10–500 chars |

If override > threshold (e.g., > ฿2,000) → notify Owner.

---

## F-N8: Override payroll field

- **Used in:** M-N6 (modal from S-N13/S-N14)
- **Submit:** `overrideField(slipId, field, value, note)`

`field` enum: `Income_Other` / `Deduct_Debt` / `Deduct_SocialSecurity` (advanced)

Required Note (for audit). Each override creates audit log entry with before/after.

---

## F-N9: Export filter

- **Used in:** S-N15
- **Submit:** `exportPeakCsv` or `exportSummaryExcel`

Returns Blob → triggers browser download.

---

## F-N10: Audit filter

URL search-param filters (no submit button) — see audit table.

---

## F-N11: Settings CRUD

Generic form per setting type. Create/Edit drawer with relevant fields. Save/Cancel.

---

## F-N12: Payroll config edit

Key-value config editor with grouped sections. Save persists to PayrollConfig table; affects future calculations only (doesn't retroactively change existing slips).

---

# Modals + Drawers

## M-N1: Bulk approve/reject confirm

- **Trigger:** Click bulk action button with N rows selected
- **Title:** "อนุมัติ {N} คำขอ?" / "ปฏิเสธ {N} คำขอ?"
- **Body:** Lists employee names compactly + warns "อนุมัติจะสร้าง Attendance อัตโนมัติ"
- **Actions:** [ยกเลิก] / [ยืนยัน] (success/danger color per action)

## M-N2: Trigger payroll confirm

- **Trigger:** Click "⚡ Trigger Payroll" on S-N13
- **Title:** "เริ่มคำนวณเงินเดือน {month}?"
- **Body:** "จะคำนวณสลิปสำหรับ {N} พนักงาน · ใช้เวลาประมาณ 30 วินาที"
- **Actions:** [ยกเลิก] / [เริ่มคำนวณ] (primary)

## M-N3: Override deduction modal

- **Trigger:** Click ✏ on attendance row
- **Body:** Shows current auto-calculated amount + edit input + required Note
- **Actions:** [ยกเลิก] / [บันทึก override]

## M-N4: Publish payroll confirm

- **Trigger:** Click "📤 Publish" on S-N13
- **Title:** "Publish {N} สลิป?"
- **Body:**
  - "Publish จะ:"
  - "• Lock การแก้ไข"
  - "• ส่ง email + PDF สลิปให้พนักงานทุกคน"
  - "• Mark CashAdvance.IsDeducted=true"
  - "ดำเนินการต่อ?"
- **Actions:** [ยกเลิก] / [Publish] (primary)

## M-N5: Unlock published slip

- **Trigger:** Click "🔓 Unlock for revision" on S-N14
- **Title:** "Unlock สลิป {empName}?"
- **Body:** "การ unlock จะสร้าง revision ใหม่ — สลิปเดิมจะเก็บไว้ใน history"
- **Required:** Reason (textarea)
- **Actions:** [ยกเลิก] / [Unlock + แก้ไข]

## M-N6: Override payroll field modal

Same pattern as M-N3 but for Payroll fields. Required Note, audit log on save.

## D-N1: Leave approval drawer

- **Trigger:** Click row in S-N6 inbox
- **Layout:** slide from right, 480px wide on desktop, full-screen mobile
- **Content:**
  - Employee info (avatar, name, dept)
  - Leave details (type, dates, duration, reason, attachment preview)
  - Team calendar context (who else on leave same days)
  - Past leave history (this employee, last 6 months)
  - Approve/Reject form (F-N3)
- **Actions:** [✅ อนุมัติ] / [❌ ปฏิเสธ + เหตุผล] / [ปิด]

## D-N2: Advance drawer

Similar to D-N1 but for cash advance — links to S-N8 for receipt upload (full page needed).

## D-N3: Audit log detail drawer

- **Trigger:** Click row in S-N16 audit list
- **Content:**
  - Action metadata (when, who, IP, UA)
  - Entity details (link to entity page if exists)
  - **Before** value (JSON formatted, syntax highlighted)
  - **After** value (JSON formatted)
  - Diff view (highlight changed fields)
- **Actions:** [Close]

## D-N4: Notification drawer (cross-cutting)

- **Trigger:** Click 🔔 in topbar
- **Tabs:** ทั้งหมด / ที่ยังไม่อ่าน
- **Items:** linked to source page on click
- See [navigation.md §9](./navigation.md#9-notification-bell--drawer) for full spec

---

# Admin toasts

| ID | Trigger | Type | Message |
|---|---|---|---|
| T-N1 | createEmployee success | success | "เพิ่มพนักงานสำเร็จ — ส่งคำเชิญทาง email" |
| T-N2 | updateEmployee success | success | "บันทึกข้อมูลแล้ว" |
| T-N3 | bulk approve/reject success | success | "อนุมัติ {N} รายการสำเร็จ" |
| T-N4 | reject success | info | "ปฏิเสธคำขอแล้ว" |
| T-N5 | Excel commit success | success | "นำเข้าสำเร็จ {N} รายการ" |
| T-N6 | overrideDeduction success | success | "Override บันทึกแล้ว · audit logged" |
| T-N7 | publishPayroll success | success | "Publish สลิป {N} ใบสำเร็จ — กำลังส่ง email..." |
| T-N8 | exportPeakCsv success | success | "Export สำเร็จ" |
| T-N9 | inviteResent success | success | "ส่งคำเชิญใหม่แล้ว" |
| T-N10 | error generic | error | "เกิดข้อผิดพลาด — โปรดลองใหม่" |
| T-N11 | new request notif (live push) | info | "คำขอลาใหม่จาก {name}" + [ดู] action |

---

# Admin edge cases

## X-N1: Concurrent edit conflict

- **Trigger:** 2 admins edit same employee simultaneously
- **UX:** First save wins. Second save shows toast "ข้อมูลถูกแก้ไขโดย {Admin2} เมื่อสักครู่ — refresh + ลองใหม่"
- **Mitigation:** Optimistic concurrency control via `updatedAt` field

## X-N2: Excel import partial failure

- **Trigger:** During commit, some rows fail (DB constraint, etc.)
- **UX:** Don't rollback all. Show summary: "บันทึก {success}/{total} · {failed} ล้มเหลว — ดู log"
- **Audit:** log per-row outcome

## X-N3: Payroll trigger while previous still running

- **Trigger:** Admin clicks Trigger again before previous completes
- **UX:** Detect existing in-progress job → show "กำลังประมวลผลอยู่ ({progress}%) — โปรดรอ"
- **Backend:** unique job ID per month, idempotency

## X-N4: Publish while reviews pending

- **Trigger:** Admin clicks Publish but warnings unaddressed
- **UX:** M-N4 shows additional warning "มี {N} warning ยังไม่จัดการ — ยืนยัน publish?"

## X-N5: Cash advance receipt upload fails mid-upload

- **Trigger:** Network error during S3 upload
- **UX:** Toast error + retry button (re-upload), preserve form state
- **Backend:** orphan receipts cleaned up by daily Inngest job

## X-N6: Empty payroll month (no active employees)

- **Trigger:** Trigger payroll but 0 active employees
- **UX:** Toast warning "ไม่มีพนักงาน Active — เพิ่มพนักงานก่อน"

## X-N7: Settings: delete branch with active employees

- **Trigger:** Try to delete a Branch that has Employees assigned
- **UX:** Modal warning: "ไม่สามารถลบสาขานี้ — มี {N} พนักงานสังกัดอยู่ · กรุณาย้ายหรือ archive ก่อน"

## X-N8: PEAK CSV format change (external)

- **Trigger:** PEAK Account changes their import format
- **Mitigation:** PEAK format defined as separate adapter module (src/server/services/peak-export.ts) — change adapter, not all callers
- **Detection:** customer reports "PEAK ไม่รับไฟล์" → Admin contact us

---

# Acceptance criteria (admin section)

- ✅ Sidebar nav with active state correct per route
- ✅ Mobile drawer works smoothly (swipe close)
- ✅ Employee CRUD full flow works (create → invite → edit → archive → rehire)
- ✅ Bulk CSV import handles 100+ rows with rate-limit invites
- ✅ Leave approval flow works (drawer → approve → auto-create attendance)
- ✅ Advance approval requires receipt + uploads to Supabase Storage
- ✅ Excel upload parses real customer scanner format (test with provided sample)
- ✅ Override deduction logged in audit
- ✅ Payroll trigger fan-out finishes for 100 emp in < 60s
- ✅ Publish sends 100 PDF emails in < 5 min
- ✅ Unlock + revision creates new Payroll row (history preserved)
- ✅ PEAK export imports successfully into PEAK Account
- ✅ Audit log queryable with filters in < 2s
- ✅ All settings CRUD work (with X-N7 protection)
- ✅ Notification bell live updates via Realtime
- ✅ All toasts in Thai

---

# Cross-references

- Flows: [FL-9](./flows.md#fl-9-approve-leave-request) (approve leave), [FL-11 Excel](./flows.md#fl-11-import-attendance-from-excel), [FL-13 payroll](./flows.md#fl-13-run-monthly-payroll), [FL-14 PEAK](./flows.md#fl-14-export-peak-accounting)
- Navigation: [navigation.md](./navigation.md)
- Forms / RLS / server actions: [architecture.md](../architecture.md)
- Backend logic: [feature-spec.md](../feature-spec.md)
