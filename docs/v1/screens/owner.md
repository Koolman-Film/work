# Owner Screens

4 screens, 0 forms (all read-only), 0 modals (no actions), 0 toasts.

**Section prefix:** `O` (e.g., S-O1, X-O1)

> Owner role = **read-only** observer. Sees company-wide data + can drill down. No mutations except optional override of admin decisions (configured via "explicit action" flow — V2).

---

## Index

### Screens (4)
- [S-O1: Owner Dashboard](#s-o1-owner-dashboard)
- [S-O2: Calendar (full company)](#s-o2-owner-calendar) ⭐
- [S-O3: Payroll review (read-only)](#s-o3-owner-payroll)
- [S-O4: Audit log](#s-o4-owner-audit)

### Edge cases (3)
- [X-O1: Salary visibility toggle](#x-o1-salary-visibility)
- [X-O2: Override Admin decision (V2)](#x-o2-override-admin-decision)
- [X-O3: Owner sees archived employees](#x-o3-owner-archived-view)

---

## Layout

Owner uses `<OwnerLayout>` — same sidebar pattern as Admin but lighter (only 4 items + bottom profile/sign-out).

```
┌──────────┬───────────────────────────────────────┐
│  [Logo]  │  Topbar: breadcrumb · 🔔 · 👤          │
│ ──────  ├───────────────────────────────────────┤
│ 🏠 หน้าหลัก │                                        │
│ 📅 ปฏิทิน  │  PAGE CONTENT                          │
│ 💸 เงินเดือน│  (read-only, dashboard-leaning)        │
│ 📜 Audit │                                        │
│           │                                        │
│ ──────   │                                        │
│ 👤 Profile│                                        │
│ ⏏ ออก     │                                        │
│  220px    │                                        │
└──────────┴───────────────────────────────────────┘
```

See [navigation.md §2](./navigation.md#owner--sidebar-lighter) for nav details.

---

# Screens

## S-O1: Owner Dashboard

- **Path:** `/owner/dashboard`
- **Purpose:** Daily overview for company-wide health
- **Priority:** ⭐ Owner's daily home

### Layout

Dashboard-heavy, no actions:
1. KPI hero row (5 cards) — visible salary if confirmed (q12: yes)
2. Today's status (who's on leave/late/absent)
3. Multiple trend charts (6-month deduction, monthly payroll total, employee count)
4. Top lists: most leave/late/absent this month
5. Optional: recent audit highlights (override alerts)

### Wireframe

```
┌──────────┬───────────────────────────────────────────────┐
│ Sidebar  │ ภาพรวม Koolman                  🔔 2  👤 │
│          ├───────────────────────────────────────────────┤
│ ✓ 🏠     │                                               │
│   📅     │ ภาพรวม                                         │
│   💸     │ ─────  ข้อมูล ณ 5 พ.ค. 2569                       │
│   📜     │                                               │
│          │ ┌──────┬──────┬──────┬──────┬──────┐         │
│          │ │ พนง.  │ ขาดวัน│ ลาวัน │ ยอดหัก│ NetPay│         │
│          │ │ ทั้งหมด│ นี้   │ นี้   │ เดือน  │ เดือน │         │
│          │ │  124  │  3   │  5   │ 4.2K │ 3.9M │         │
│          │ └──────┴──────┴──────┴──────┴──────┘         │
│          │                                               │
│          │ ┌──────────────────────────────────────────┐ │
│          │ │ Trend: ยอดเงินเดือนรวม 6 เดือนหลัง            │ │
│          │ │ [chart]                                    │ │
│          │ └──────────────────────────────────────────┘ │
│          │                                               │
│          │ ┌────────────────────┬───────────────────┐   │
│          │ │ Top 10 ขาด/ลา/สาย │ Override alerts    │   │
│          │ │ • ตงค์ 5 ครั้ง       │ • EMP-3 +฿5K            │   │
│          │ │ • ส้ม 4 ครั้ง         │ • EMP-7 หักเป็น 0         │   │
│          │ │ ดูทั้งหมด →           │ ดู audit →               │   │
│          │ └────────────────────┴───────────────────┘   │
│          │                                               │
│          │ ┌──────────────────────────────────────────┐ │
│          │ │ ใครลาวันนี้                                  │ │
│          │ │ • นภา (Sales) ลาป่วย                          │ │
│          │ │ • เอ๋ (Marketing) ลากิจ                         │ │
│          │ │ ดูปฏิทิน →                                     │ │
│          │ └──────────────────────────────────────────┘ │
│          │                                               │
└──────────┴───────────────────────────────────────────────┘
```

### Components

| Element | Component |
|---|---|
| KPI row | 5 `<KpiCard>` |
| Trend chart | `recharts` line chart, 6 months |
| Top 10 list | similar to Admin dashboard pattern |
| Override alerts | filtered audit recent (only override-type) |
| Today on leave | shared with Admin component |

### Server Actions

- `getOwnerDashboardData()` — single fetch
  - Returns: `{ kpis, trends, topLeaveAbsent, overrideAlerts, todayStatus }`
  - **Includes salary data** (q12 confirmed)
  - Filters by Owner's branch scope (V2 if multiple Owners with different scope; V1 = full company)

### States

- **Loading:** skeleton cards
- **No override alerts:** hide section ("ไม่มี override ผิดปกติ ✓")
- **Empty payroll month:** show "Admin ยังไม่ได้ publish เงินเดือนเดือนล่าสุด"

---

## S-O2: Owner Calendar

- **Path:** `/owner/calendar`
- **Purpose:** Full company-wide attendance calendar
- **Priority:** ⭐ Owner's most-used screen

### Wireframe

```
ปฏิทินการขาด/ลา/สาย                  [ทุกแผนก ▼] [ทุกสาขา ▼] [ทุกประเภท ▼]

◀ พฤษภาคม 2569 ▶                                          [Day | Week | Month]

┌────────────────────────────────────────────────────────────────┐
│  จ      อ      พ      พฤ      ศ      ส      อา                │
│ ──────────────────────────────────────────────────────────────  │
│           1      2      3      4      5      6      7           │
│         (today)                                                  │
│ ┌────────────────────────────────┐                              │
│ │  • ลา 0 · ขาด 0 · สาย 0          │ — daily summary in cell      │
│ └────────────────────────────────┘                              │
│                                                                 │
│  8                                  → click cell                 │
│ ┌────────────────────────────────┐                              │
│ │  ●●● 🟥 🟦 🟧                     │  3 events                    │
│ │  ลา 1 · ขาด 0 · สาย 1            │                              │
│ │  3 พนักงาน                       │                              │
│ └────────────────────────────────┘                              │
│                                                                 │
│ ...                                                              │
└────────────────────────────────────────────────────────────────┘

Legend: 🟥 ขาด · 🟦 ลาป่วย · 🟪 ลากิจ · 🟩 พักร้อน · 🟧 สาย · ⬜ ไม่สแกน
```

### View modes

- **Month** (default) — 7-col grid, rich daily summary
- **Week** — horizontal lanes per employee
- **Day** — full hour-by-hour breakdown (less useful, V2)

### Components

- `<Calendar>` — custom month/week/day grid
- `<Filter>` chips: department, branch, type
- `<Drawer>` for day-cell click — shows full list of events that day

### Day drawer content

```
8 พฤษภาคม 2569

🟦 ลาป่วย (1)
  • นภา จันทรา · Sales · 1 วัน [ดูรายละเอียด →]

🟧 สาย (1)
  • ตุ่น สมหวัง · Installation · 30 นาที (09:30 ClockIn)

🟥 ขาด (0)
  ไม่มี

🟩 พักร้อน (0)
  ไม่มี
```

### Server Actions

- `getOwnerCalendar(month, filters)`
- Pre-aggregates daily counts for fast loading

### States

- **Loading:** skeleton calendar grid
- **Empty month (no leave):** clean month with "ไม่มีรายการ" minimal cells

---

## S-O3: Owner Payroll review

- **Path:** `/owner/payroll`
- **Purpose:** Read-only browse + drill-down to slips
- **Permissions:** can see all slip data + amounts (q12 confirmed)

### Wireframe

```
เงินเดือน                                          [📥 Export PDF report]

┌──────────────────────────────────────────────────────────┐
│ เดือน        │ พนักงาน│ รวม Income │ รวม Deduct│ NetPay   │
├──────────────────────────────────────────────────────────┤
│ พ.ค. 2569   │   124  │ ฿4,500K   │ ฿607K    │ ฿3,892K │ 📝 Draft
│ เม.ย. 2569 ⭐│   124  │ ฿4,500K   │ ฿607K    │ ฿3,892K │ ✅ Published ▶
│ มี.ค. 2569   │   122  │ ฿4,420K   │ ฿590K    │ ฿3,830K │ ✅ Published ▶
└──────────────────────────────────────────────────────────┘

Click month → /owner/payroll/[month]
```

### S-O3 detail view: `/owner/payroll/[month]`

Reuses Admin's S-N13 monthly payroll table layout but **read-only**:
- No "Trigger" / "Publish" buttons
- ✏ icons replaced with 🔍 (view-only detail)
- Override badges still visible (Owner needs visibility)

Click row → /owner/payroll/[month]/[empId] (read-only slip view, similar to S-N14 but no edit/unlock)

### Server Actions

- `listPayrollMonths(filter)` — same as admin but enforces Owner role
- `getPayrollRow(month, empId)` — read-only

### States

- **Includes Draft months** Owner can see what's coming
- **Override warnings** highlighted same as admin

---

## S-O4: Owner Audit Log

- **Path:** `/owner/audit`
- **Purpose:** Same as Admin S-N16 but Owner accesses for compliance oversight

### Layout

Identical to S-N16 (admin audit log) — same filter, same table, same drawer.

**Differences:**
- Owner specifically should review `*.override` actions and `*.publish` actions
- Has additional "Override Alerts" filter quick-action
- Cannot delete/modify entries (RLS enforces)

### Server Actions

- `listAudit(filter)` — same as admin

---

# Edge cases

## X-O1: Salary visibility toggle (future-proof)

- **Trigger:** If lokken's policy changes, Owner shouldn't see salaries
- **V1:** Always visible (q12 confirmed by customer)
- **V2:** Add toggle "Hide amounts" → masks salary cells with `••••` (audit logged when un-masked)

## X-O2: Override Admin decision

- **Trigger:** Owner wants to override an Admin's approval
- **V1:** Not implemented (q13: "probably but not easy")
- **V2 design:**
  - Owner navigates to entity (e.g., approved leave)
  - Click "Owner override" → confirmation modal explaining consequences
  - Required reason
  - Audit log entry with `actor=Owner, action=*.owner_override`
  - Notify both Employee + Admin
  - Friction-by-design (multiple confirmations) to prevent accidental clicks

## X-O3: Owner sees archived employees

- **Trigger:** Owner browsing payroll history, encounters terminated employee
- **UX:** Show normally, archived flag visible (gray text + "(Archived)" suffix)
- **Permissions:** Owner sees historical data even if employee archived

---

# Acceptance criteria

- ✅ Sidebar shows only 4 main items (lighter than Admin)
- ✅ Dashboard loads with KPIs + charts in < 2s
- ✅ Calendar handles 100+ employees in same month gracefully
- ✅ Payroll read-only (no edit buttons rendered)
- ✅ Audit log identical to Admin's
- ✅ Salary visible by default (q12)
- ✅ All toasts, errors in Thai

---

# Cross-references

- Flows: [FL-17](./flows.md#fl-17-owner-daily-overview), [FL-18](./flows.md#fl-18-owner-employee-drilldown)
- Admin equivalents: payroll = S-N12/13/14 read-only · audit = S-N16
- Navigation: [navigation.md §2](./navigation.md#owner--sidebar-lighter)
- Roles: [architecture.md § 4a User roles](../architecture.md#4a-user-roles--permissions)
