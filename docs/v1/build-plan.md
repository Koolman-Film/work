# V1 Build Plan — Phased Approach

แบ่งเป็น 4 phases · เสนอราคา/ส่งมอบแยกกัน · ขายต่อเนื่อง

> **Auth (lock 2026-05):** phone + password (primary), SMS OTP สำหรับ reset password เท่านั้น (ไม่ใช่ 2FA login). Email = optional secondary สำหรับ slip PDF + notification.

---

## Phase summary

| Phase | Scope | Hours (AI heavy) | Calendar | Quote (THB) | Stack tier |
|---|---|---|---|---|---|
| **Phase 1** ⭐ | Core Workflow — Leave + Attendance + Advance | 60–90 | 2–4 wk | **130K** | Free tier |
| **Phase 2** | Payroll Engine + Pay Slip | 80–120 | 3–4 wk | **150K** | Pro tier (~$45/mo customer) |
| **Phase 3** | Polish — Excel, PEAK, Owner, Audit, Bulk | 60–90 | 2–3 wk | **100K** | Pro tier |
| **Phase 4** (optional) | LINE LIFF + Messaging API | 25–35 | 1–2 wk | **50K** | Pro tier + LINE OA |
| **Total V1 complete** | All phases | 225–335 | 8–13 wk | **430K** | — |

> ลูกค้าเลือกได้ — ทำทีละ phase, หรือบาง phase, หรือสลับลำดับ. แต่ **ห้ามข้าม Phase 1** — เป็นรากฐานของทุก phase.

---

# Phase 1 — Core Workflow (Leave + Attendance + Cash Advance)

**Quote:** 130K THB · **Calendar:** 2–4 wk · **Hours:** 60–90 (AI-heavy)

**Goal:** ลูกค้าได้สิ่งที่ยังไม่เคยมี — บันทึก ขาด/ลา/มาสาย + ขอเบิกเงินล่วงหน้า

**Why this is Phase 1:** ลูกค้าบอกตรงๆว่าอยากได้สิ่งนี้ก่อน. ส่วน payroll ลูกค้ามีอยู่แล้ว (อาจเป็น Excel หรือระบบเก่า). เลื่อนได้.

**Stack:** Free tier ทั้งหมด — Vercel Hobby + Supabase Free + Resend Free. ไม่ต้อง SMS provider (admin reset password แทน).

## Phase 1 Detailed Checklist

### 1.1 Foundation (~10 hr)
- [ ] `pnpm create next-app` Next.js 16 + TypeScript + Tailwind 4 + Biome
- [ ] Init Prisma 6 with Supabase Postgres (free tier, SG region)
- [ ] Install shadcn/ui — base components: button, input, label, form, card, table, drawer, dialog
- [ ] IBM Plex Sans Thai via next/font
- [ ] Tailwind 4 theme: brand colors (Blue 600, Amber 500) ใน `globals.css`
- [ ] Dark mode auto detection
- [ ] Vercel project linked, first deploy
- [ ] GitHub Actions CI: lint + Prisma validate on PR
- [ ] Sentry SDK (free tier)
- [ ] Cron ping function (GitHub Actions every 6 days) — ป้องกัน Supabase auto-pause

### 1.2 Auth (~6 hr)
- [ ] Migration: `Employees` table + link `auth_user_id` to `auth.users`
- [ ] Supabase Auth: enable Phone provider, disable Email provider for login
- [ ] Server Actions: `signIn(phone, password)`, `signOut()`
- [ ] Server Action: `adminResetPassword(employeeId)` — generate temp password, return ให้ admin บอกพนักงานปากเปล่า
- [ ] Page `/login` — phone + password form (UI from mockup 01-login.html)
- [ ] Middleware: redirect by role (Employee → /dashboard, Admin → /admin)
- [ ] RLS policies — Employees can only read own row, Admins can CRUD all
- [ ] Session refresh middleware
- [ ] **Edge cases** (UI from `05-edge-states.html`):
  - [ ] X-A1 Rate limit: 5 wrong logins → cooldown 5 min + countdown UI
  - [ ] X-A2 Wrong password lockout: warning at 3 attempts
  - [ ] X-A3 Invalid invite token: friendly error page + "ติดต่อ Admin" CTA
  - [ ] X-A5 Expired reset token: "ขอ OTP ใหม่" button
  - [ ] M-A1 Session expired modal: "เซสชันหมดอายุ — login ใหม่" + redirect /login

### 1.3 Schema (~4 hr)
- [ ] `Employees` (id, auth_user_id, phone, email?, fullName, baseSalary, status, branchId?, departmentId?)
- [ ] `Branches` (id, name, address?) — seed ค่าเริ่มต้น 1 branch
- [ ] `Departments` (id, name) — seed default 5 ค่า
- [ ] `LeaveTypes` (id, name, color, deductSalary) — seed 6 types
- [ ] `Holidays` (id, date, name) — seed Thai 2026 holidays
- [ ] `LeaveRequest` (id, employeeId, type, startDate, endDate, reason, status, approvedBy?, attachmentUrl?)
- [ ] `Attendance` (id, employeeId, date, type, deductAmount, note, manualEntry, createdBy)
- [ ] `CashAdvance` (id, employeeId, amount, reason, status, approvedBy?, receiptUrl?, isDeducted)
- [ ] Audit log table (basic, no UI yet)

### 1.4 Employee management + Admin Dashboard (~10 hr)
- [ ] Page `/admin/employees` — table list, filter, search (mockup `adm-employee-list.html`)
- [ ] Server Actions: `listEmployees`, `createEmployee`, `updateEmployee`, `archiveEmployee`
- [ ] Page `/admin/employees/new` — form, sectioned (mockup `adm-employee-form.html`)
- [ ] Page `/admin/employees/[id]` — edit
- [ ] Auto-create auth.users record on createEmployee + send temp password to admin
- [ ] Page `/profile` — employee view own profile, edit phone + email + bank (mockup `emp-profile.html` — LINE tab disabled until Phase 4)
- [ ] Sign-out flow
- [ ] **Page `/admin/dashboard`** (mockup `adm-dashboard.html`) — Phase 1 baseline:
  - [ ] 4 KPI cards: คำขอลา/เบิก รออนุมัติ · ใครลาวันนี้ · พนักงานทั้งหมด
  - [ ] Pending requests panel (links to leave/advance inboxes)
  - [ ] Today on leave panel
  - [ ] Phase 2/3 sidebar items shown but disabled (เงินเดือน P2, บัญชี P3, Audit P3)
  - [ ] Trend chart placeholder with "🔒 Phase 2" overlay (real chart in Phase 2)
- [ ] **Page `/dashboard`** (mockup `emp-dashboard.html`) — Phase 1 baseline:
  - [ ] Greeting + name
  - [ ] NetPay hero card empty state ("ยังไม่มีสลิป — Phase 2")
  - [ ] KPI mini-cards (วันลา/ขาด/มาสาย counts)
  - [ ] Quick actions (ขอลา, ขอเบิก)
  - [ ] Pending requests of own list
  - [ ] Bottom nav 5 items, "📄 สลิป" disabled until Phase 2

### 1.5 Leave management (~16 hr)
- [ ] Page `/leave/new` (Employee) — form: type, date range, reason, attachment (mockup emp-leave-new.html)
- [ ] Server Action `createLeaveRequest` — validation: date overlap, weekend skip, max days
- [ ] Page `/leave` (Employee) — list own + tabs (list/calendar) (mockup emp-leave-list.html)
- [ ] Page `/leave/[id]` (Employee) — detail + cancel button (mockup emp-leave-detail.html)
- [ ] Page `/admin/leave-approvals` (Admin) — inbox pattern + drawer (mockup adm-leave-inbox.html)
- [ ] Server Actions: `approveLeave`, `rejectLeave` (note required)
- [ ] Auto-create Attendance record on approve
- [ ] Bulk approve UI
- [ ] File upload (medical cert) → Supabase Storage
- [ ] Email notification: leave-submitted (Admin), leave-approved/rejected (Employee)
- [ ] **Shared component:** Override modal (M-N3) — built in 1.6, reused by Phase 2 (§2.4) for payroll override

### 1.6 Attendance manual entry (~10 hr)
- [ ] Page `/admin/attendance` — list filter month/employee/type (mockup adm-attendance.html)
- [ ] Server Action `createAttendance` — admin manually records ขาด/ลา/มาสาย
- [ ] Form: pick employee, date, type, deductAmount preview, note
- [ ] Server Action `overrideDeduction` — change deduct amount + note required
- [ ] List view shows daily/monthly toggle
- [ ] Page `/attendance` (Employee) — own records, month filter
- [ ] Empty state + filter UX

### 1.7 Cash advance (~12 hr)
- [ ] Page `/advance/new` (Employee) — money input + reason + receipt upload (mockup `emp-advance-new.html`)
- [ ] Server Action `createAdvanceRequest` — validation: max ceiling (50% of salary)
- [ ] Page `/advance` (Employee) — list own + filter by status (mockup `emp-advance-list.html`)
- [ ] Page `/advance/[id]` (Employee) — detail + status timeline + cancel button (mockup `emp-advance-detail.html`)
- [ ] Page `/admin/advance-approvals` (Admin) — inbox + drawer + receipt upload (mockup `adm-advance-inbox.html`)
- [ ] Server Actions: `approveAdvance` (with receipt upload optional), `rejectAdvance`
- [ ] Email notification on approve/reject
- [ ] `IsDeducted` flag (will be used by Phase 2 payroll)

### 1.8 Notifications (~8 hr)
- [ ] Schema: `Notification` + `NotificationPreference` (per-user matrix: in-app/email per event type)
- [ ] Server Actions: createNotification, markRead, markAllRead, listMine
- [ ] Topbar bell icon + unread count badge
- [ ] Drawer with list of notifications
- [ ] **Notification preference matrix UI** (mockup `emp-profile.html` Notifications tab) — toggles per event × channel (in-app/email; LINE column disabled until Phase 4)
- [ ] Email via Resend (free tier 3K/mo): leave-submitted, leave-approved, leave-rejected, advance-submitted, advance-approved, advance-rejected
- [ ] react-email templates ใน `src/lib/email/templates/`
- [ ] Inngest function `notify-event` — fan-out in-app + optional email (LINE channel added in Phase 4)

### 1.9 Polish (~8 hr)
- [ ] Empty states — all list pages
- [ ] Error boundaries — all pages
- [ ] Loading skeletons — all data pages
- [ ] Toast: success / error / info patterns
- [ ] Mobile responsive pass: 320px / 768px / 1024px
- [ ] Touch targets ≥ 44×44

### 1.10 Deploy + handover (~5 hr)
- [ ] Production deploy to Vercel (custom subdomain or vercel.app)
- [ ] DNS configuration (if customer has domain)
- [ ] Supabase migration deploy
- [ ] Resend domain verification (~1 day calendar)
- [ ] Smoke test in prod
- [ ] Final env vars check

### 1.11 Customer touchpoints (~16 hr · calendar-blocking)
- [ ] Pre-Phase: 1 onboarding call (collect employee list, branches, leave types)
- [ ] Mid-Phase: 1 demo session (~2 hr) — capture feedback
- [ ] UAT: customer tests for 2-3 days, you fix critical bugs
- [ ] Training session (1 hr) — show admin how to use
- [ ] Thai user manual (PDF or web docs)
- [ ] 14-day warranty support

### Phase 1 Definition of Done

- ✅ Admin login, add 5 test employees
- ✅ Each employee receives temp password (admin tells verbally)
- ✅ Employee logs in, submits leave request → Admin approves → Employee sees status
- ✅ Admin records 1 absence + 1 late → reflected in employee's attendance page
- ✅ Employee submits cash advance → Admin approves with receipt → Employee sees approval
- ✅ All notifications fire correctly (in-app + email)
- ✅ Mobile responsive on iPhone Safari + Android Chrome
- ✅ Lighthouse Performance > 80, Accessibility > 90
- ✅ UAT signed off by customer

### Phase 1 Payment milestones

| Milestone | Trigger | THB | Cumulative |
|---|---|---|---|
| Contract sign | Day 0 | 40K | 40K |
| Mid-phase demo | ~W2 | 40K | 80K |
| UAT pass + go-live | ~W3 | 50K | **130K** |

---

# Phase 2 — Payroll Engine + Pay Slip

**Quote:** 150K THB · **Calendar:** 3–4 wk · **Hours:** 80–120

**Goal:** คำนวณเงินเดือนรายเดือน + ส่งสลิป + override + lock

**Prerequisites:** Phase 1 stable + 1 month real data ใน Attendance + Advance.

**Stack upgrade required:** Supabase Pro ($25/mo) + Vercel Pro ($20/mo) — for daily backups + production-grade resources. ลูกค้าจ่ายตรง provider.

## Phase 2 Detailed Checklist

### 2.1 Payroll schema + config (~8 hr)
- [ ] `Payroll` (id, employeeId, month, status, baseSalary, otHours, otAmount, ssoAmount, taxAmount, deductTotal, advanceDeducted, netPay, publishedAt, lockedAt, revision)
- [ ] `PayrollConfig` (key-value): SSO rate (5%), OT rate multiplier (1.5x), max OT hours/month, monthly cycle (1-31)
- [ ] `AccountingGroup` (id, name) — seed default 5 groups
- [ ] `Employees.accountingGroupId` FK
- [ ] Migration + seed PayrollConfig

### 2.2 Calculation service (~14 hr)
- [ ] `src/server/services/payroll-calc.ts` — pure function
- [ ] Formula: `NetPay = BaseSalary + OT - SSO - Tax - Deductions - AdvanceDeducted`
- [ ] Pro-rate logic: probation, partial month, mid-month start
- [ ] Holiday handling
- [ ] Leave deduction (unpaid leave only)
- [ ] Late deduction: read from PayrollConfig threshold
- [ ] Unit tests: ≥ 15 test cases (probation, partial, OT-less, no advance, etc.)

### 2.3 Payroll month management (~10 hr)
- [ ] Page `/admin/payroll` — list of months (mockup adm-payroll-list.html)
- [ ] Year tabs, status chips (Not started / Draft / Published / Locked)
- [ ] Server Action `triggerPayroll(month)` — Inngest function fans out per employee
- [ ] Real-time progress UI (Supabase Realtime subscribe)

### 2.4 Payroll review + override (~16 hr)
- [ ] Page `/admin/payroll/[month]` — review table 11 columns (mockup adm-payroll-run.html)
- [ ] State machine: draft → calculating → reviewing → publishing → published → locked
- [ ] Override modal (M-N3): change any field with required note
- [ ] Audit log every override
- [ ] Warning: override > ฿2,000 → notify Owner (Phase 3 will activate)
- [ ] Filter: show only override rows / warn rows
- [ ] Per-employee detail page `/admin/payroll/[month]/[empId]` (mockup adm-payroll-detail.html)
- [ ] Field-level override (✏ icon per row)

### 2.5 Publish flow (~10 hr)
- [ ] Confirm modal (M-N4) — list consequences
- [ ] Mass status update + IsDeducted flag on linked CashAdvance
- [ ] Inngest fan-out: 1 PDF per employee
- [ ] Email send with PDF attached (Resend with attachment)
- [ ] Realtime progress UI ระหว่าง publish
- [ ] Success state — redirect to month list

### 2.6 PDF slip generator (~12 hr)
- [ ] `@react-pdf/renderer` template — Thai font bundle
- [ ] Layout: company header, employee info, income table, deduction table, NetPay hero, signature line
- [ ] Server-side render → upload to Supabase Storage
- [ ] Presigned URL for download (24 hr expiry)
- [ ] Test with Thai characters + amount formatting

### 2.7 Employee pay slip view (~8 hr)
- [ ] Page `/payslip` — list of months · year tabs · NetPay hero · year summary (mockup `emp-payslip-list.html`)
- [ ] Page `/payslip/[month]` — slip detail (mockup `emp-payslip-detail.html`)
- [ ] Download PDF button
- [ ] Mobile-optimized layout
- [ ] Empty state when no published slip yet
- [ ] Action sheet (M-E3): download / share / print

### 2.8 Revision (unlock) (~6 hr)
- [ ] Unlock flow with required reason (M-N5)
- [ ] Create revision Payroll row (don't overwrite)
- [ ] Send corrected slip + email
- [ ] Audit log entry

### 2.9 Polish + testing (~10 hr)
- [ ] Error states for failed calculation
- [ ] Edge case: employee fired mid-month, employee onboarded mid-month
- [ ] Run 2 full months on real data
- [ ] Compare to customer's existing manual calculation

### 2.10 Customer touchpoints (~12 hr · calendar-blocking)
- [ ] Pre-Phase: collect PayrollConfig values (SSO rate, OT rate, late threshold, ฯลฯ)
- [ ] Mid-Phase demo: run on real data, customer reviews
- [ ] UAT: customer compares to existing system (1-2 weeks of real shadow run)
- [ ] Training: payroll cycle walkthrough
- [ ] Phase 2 user manual addendum

### Phase 2 Definition of Done

- ✅ Trigger payroll → calculation completes < 30 sec for 124 employees
- ✅ Review table shows all employees with correct totals
- ✅ Override 1 employee — audit log records who/when/before/after
- ✅ Publish → 124 emails sent with PDF slips attached
- ✅ Employee logs in → sees own slip → downloads PDF
- ✅ Unlock + revise 1 slip → corrected slip resent
- ✅ Calculation matches customer's manual calc within 1 ฿ tolerance for 2 sample months
- ✅ Customer signs off

### Phase 2 Payment milestones

| Milestone | Trigger | THB |
|---|---|---|
| Phase 2 sign | Day 0 | 50K |
| First payroll cycle published successfully | ~W3 | 50K |
| Customer UAT pass + warranty start | ~W4 | 50K |

---

# Phase 3 — Polish (Excel, PEAK, Owner, Audit, Bulk)

**Quote:** 100K THB · **Calendar:** 2–3 wk · **Hours:** 60–90

**Goal:** Operational efficiency — bulk import, fingerprint scan, accounting export, audit log, owner role.

**Prerequisites:** Phase 1 + Phase 2 complete + ~1 month live usage.

## Phase 3 Detailed Checklist

### 3.1 Excel attendance upload (~14 hr)
- [ ] Page `/admin/attendance/upload` (mockup adm-excel-upload.html)
- [ ] File upload to Supabase Storage
- [ ] ExcelJS parser (server-side via Inngest)
- [ ] Preview UI: validation per row, fix-or-skip
- [ ] EmpID matcher: auto match + manual map for unknowns
- [ ] Bulk insert with audit
- [ ] Test with customer's actual scanner Excel

### 3.2 Bulk CSV employee import (~8 hr)
- [ ] Page `/admin/employees/import`
- [ ] CSV parser (papaparse) + preview
- [ ] Per-row validation: phone format, duplicates, branch/dept exists
- [ ] Bulk insert + auto-invite (admin gets list of temp passwords)
- [ ] Template CSV download

### 3.3 PEAK accounting export (~12 hr)
- [ ] Page `/admin/accounting` (mockup adm-accounting.html)
- [ ] Confirm PEAK CSV format with customer's accountant
- [ ] Define mapping: Koolman fields → PEAK accounts (per accounting group)
- [ ] Server Action `exportPeakCsv(month, groupId?)`
- [ ] CSV streaming → client download
- [ ] Excel summary export
- [ ] Re-export warning — เตือนการ post ซ้ำ

### 3.4 Audit log UI (~8 hr)
- [ ] Page `/admin/audit` (mockup adm-audit-log.html)
- [ ] Filter: user, action, date range, entity
- [ ] Table with action badges
- [ ] Drawer with before/after JSON pretty-print
- [ ] Export audit (CSV) for compliance
- [ ] Pagination 50/page

### 3.5 Owner role + dashboard (~14 hr)
- [ ] Schema: Role enum extended → Employee, Admin, Owner
- [ ] RLS: Owner read-only on all tables
- [ ] Page `/owner/dashboard` (mockup own-dashboard.html)
- [ ] 5 KPI cards + trend chart (recharts) + donut breakdown
- [ ] Today on leave list + override alerts
- [ ] Page `/owner/payroll` — read-only payroll review (mockup own-payroll.html)
- [ ] Page `/owner/audit` — same as admin but read-only

### 3.6 Owner calendar (~10 hr)
- [ ] Page `/owner/calendar` — full company-wide view (mockup own-calendar.html)
- [ ] 31-day grid color-coded by event type
- [ ] Filter: department, branch, type
- [ ] Click cell → drawer with names grouped by type
- [ ] Drill-down to employee detail (read-only)

### 3.7 Settings sub-pages (~6 hr)

> **Mockup strategy:** `adm-settings-branches.html` is **the generic CRUD pattern** — same UI structure applies to 5 sub-pages below. `adm-payroll-config.html` is the special key-value editor (different pattern).

- [ ] `/admin/settings/branches` CRUD (mockup `adm-settings-branches.html` — pattern reference)
- [ ] `/admin/settings/departments` CRUD (reuse pattern)
- [ ] `/admin/settings/leave-types` CRUD (reuse pattern)
- [ ] `/admin/settings/holidays` CRUD (reuse pattern + Thai 2026 seed)
- [ ] `/admin/settings/accounting-groups` CRUD (reuse pattern)
- [ ] `/admin/settings/payroll-config` key-value editor (mockup `adm-payroll-config.html` — separate pattern)
- [ ] FK reference check: cannot delete if in-use, suggest archive (mockup shows blocked-delete modal)
- [ ] Generic CRUD component `<SettingsListPage>` — list + drawer + form, reused by 5 sub-pages above

### 3.8 Customer touchpoints (~10 hr)
- [ ] PEAK format confirmation with accountant
- [ ] Excel upload test with real scanner file
- [ ] Owner training (different from admin training)
- [ ] Final manual update

### Phase 3 Definition of Done

- ✅ Customer uploads 1 month of fingerprint scan Excel → all attendance records created
- ✅ Customer exports PEAK CSV → accountant successfully imports to PEAK
- ✅ Owner logs in → sees company-wide dashboard with real numbers
- ✅ Owner reviews override audit log
- ✅ Bulk CSV import: customer imports 50 new employees in < 5 min
- ✅ All settings pages CRUD working

### Phase 3 Payment milestones

| Milestone | Trigger | THB |
|---|---|---|
| Phase 3 sign | Day 0 | 30K |
| Excel + PEAK + Owner working | ~W2 | 35K |
| UAT pass + handover | ~W3 | 35K |

---

# Phase 4 — LINE LIFF + Messaging API (optional)

**Quote:** 50K THB · **Calendar:** 1–2 wk · **Hours:** 25–35

**Goal:** Push notification ผ่าน LINE OA + ผูกบัญชี LINE ของพนักงาน

**Prerequisites:**
- Phase 1 minimum (auth + employees exist)
- Customer has LINE OA verified (~1-2 weeks calendar wait — submit early)
- LINE Developer console channel created

## Phase 4 Detailed Checklist

### 4.1 LINE setup (~3 hr · customer-side)
- [ ] LINE Developer Console: create Provider + Messaging API channel + Login channel
- [ ] LIFF app config under Login channel
- [ ] LINE OA verified status (LINE Business ID submission)
- [ ] LINE OA name + display picture + welcome message

### 4.2 Schema (~1 hr)
- [ ] Migration: add `Employees.lineUserId UNIQUE`, `lineLinkedAt`, `lineDisplayName`

### 4.3 LIFF link page (~4 hr) — UI from `emp-line-link.html`
- [ ] Page `/line/link` — LIFF endpoint (mockup state 3 — "LIFF in LINE app")
- [ ] `liff.init()` + `liff.getProfile()` flow
- [ ] Token issuer: short-lived JWT (5 min) signed with employee session
- [ ] Loading state (mockup state 4)
- [ ] Error states: token expired, already linked, not in LINE app

### 4.4 API: link/unlink (~3 hr)
- [ ] `POST /api/line/link` — validate JWT, save lineUserId
- [ ] `DELETE /api/line/link` — clear lineUserId
- [ ] Audit log entries
- [ ] UNIQUE constraint conflict handling

### 4.5 Profile UI (~3 hr) — UI from `emp-line-link.html`
- [ ] Profile tab "Notifications" → Connect LINE card (mockup state 1 — "Profile prompt")
- [ ] QR code fallback for desktop users (mockup state 2)
- [ ] Linked state — display LINE name + avatar + Unlink button (mockup state 5)
- [ ] Unlink confirm modal

### 4.6 Push notification dispatcher (~7 hr) — Flex messages from `emp-line-messages.html`
- [ ] `lib/line-push.ts` — wrapper around `@line/bot-sdk` `client.pushMessage`
- [ ] Retry logic with exponential backoff
- [ ] Update Inngest `notify-event` to add LINE channel (if employee.lineUserId exists)
- [ ] LINE flex messages for:
  - [ ] OA welcome (mockup state 1) — auto-sent when employee adds OA as friend
  - [ ] leave-approved (mockup state 2)
  - [ ] advance-approved (mockup state 3)
  - [ ] payroll-published (mockup state 4)
  - [ ] leave-rejected (mockup state 5)
- [ ] Fallback to email if LINE push fails

### 4.7 Test + handover (~4 hr)
- [ ] Test on iOS LINE app + Android LINE app + LINE Desktop
- [ ] Test linking + unlinking
- [ ] Test push delivery for all event types
- [ ] LINE OA push quota monitoring
- [ ] Document for customer how to manage LINE OA

### Phase 4 Definition of Done

- ✅ Employee opens /profile → clicks Connect LINE → links in 2 clicks
- ✅ Admin approves leave → employee receives LINE message within 30 sec
- ✅ Pay slip published → all linked employees receive LINE notification with link
- ✅ Unlink works
- ✅ LINE OA quota monitoring alert set up

### Phase 4 Payment

| Milestone | Trigger | THB |
|---|---|---|
| Phase 4 sign | Day 0 | 20K |
| LINE OA verified + LIFF working | — | 15K |
| Push notification tested + handover | — | 15K |

---

## Cross-phase considerations

### Customer infrastructure costs (passthrough)

| Phase | Stack tier | Monthly customer cost |
|---|---|---|
| Phase 1 | Free tier | **0–50 ฿** (domain optional) |
| Phase 2 onwards | Pro tier required | ~$45/mo (~1,600 ฿) |
| Phase 4 | + LINE OA | + 1,150 ฿/mo (LINE Push API paid tier) |

### Maintenance after each phase

- 14-day warranty included (bug fix only)
- Block hours retainer: **5,000 ฿/mo for 4 hr** (optional)
- Hourly support beyond warranty: **1,200 ฿/hr**
- Critical bug after warranty: respond within 48 hr if retainer; best effort otherwise

### Risk register

| Risk | Phase | Likelihood | Mitigation |
|---|---|---|---|
| Customer's Excel scanner format differs from template | 3 | High | Get sample early, test before quote |
| PEAK CSV format wrong on first export | 3 | Med | Confirm with accountant, test early |
| Real-world payroll edge cases unmodelled | 2 | Med | Run 2-month shadow comparison before go-live |
| LINE OA verify slow | 4 | High | Submit at Phase 1 start, parallel waiting |
| Free tier usage spike → forced Pro upgrade mid-Phase 1 | 1 | Low | Monitor Supabase usage, set up cron-ping |
| Customer expands scope mid-phase | All | High | Strict change request process — quote separately |
| Phase 1 success → expectation that Phase 2 is "small add" | 2 | High | Contract clearly separates phases + quotes |

### Definition of Done — V1 Complete (after all 4 phases)

- ✅ All 11 modules in feature-spec.md implemented
- ✅ Customer using daily for 30+ days
- ✅ Lighthouse Performance > 80, Accessibility > 90
- ✅ Sentry < 5 critical errors / week
- ✅ Backup automated (Supabase Pro daily)
- ✅ User manual delivered (Thai)
- ✅ Custom domain HTTPS live (if customer has domain)
- ✅ All 4 phases UAT signed off

---

## Pre-Phase 1 onboarding (do BEFORE starting timer)

### Customer-side dependencies (block Phase 1 W1)

- [ ] Domain registered (optional — `*.vercel.app` ฟรีก็ได้)
- [ ] รายชื่อ Admin คนแรก (พร้อมเบอร์มือถือ + email optional)
- [ ] Logo + brand color reference (ถ้ามี)
- [ ] Branch list + ที่อยู่
- [ ] Leave types list (ถ้าต่างจาก default 6)
- [ ] Contract signed + Phase 1 deposit (40K) paid

### Customer-side dependencies for later phases

- [ ] **Phase 2 W0:** Excel sample จากเครื่องสแกน (ถ้าใช้), PayrollConfig values
- [ ] **Phase 2 W0:** สำเนาการคำนวณเงินเดือน 2 เดือนล่าสุด สำหรับ shadow comparison
- [ ] **Phase 3 W0:** PEAK Account access / sample export format
- [ ] **Phase 4 W0:** LINE OA apply ส่งแล้ว (~2 wk wait)

### Dev-side prep (Day 0 ของ Phase 1)

- [ ] GitHub repo private created
- [ ] Vercel project linked, free tier
- [ ] Supabase project Singapore region, free tier
- [ ] Resend account + future verified domain
- [ ] Inngest account (free tier)
- [ ] Sentry project (free tier)
- [ ] Local Node 24 LTS, pnpm 10

---

## Quote summary table (give to customer)

| Phase | What | Calendar | Quote |
|---|---|---|---|
| **Phase 1** ⭐ | ขาด/ลา/มาสาย + ขอเบิกเงิน + auth + employee | 2-4 wk | **130,000 ฿** |
| Phase 2 | คำนวณเงินเดือน + สลิป PDF + override | 3-4 wk | 150,000 ฿ |
| Phase 3 | Excel upload + PEAK export + Owner role | 2-3 wk | 100,000 ฿ |
| Phase 4 (optional) | LINE notification + LIFF link | 1-2 wk | 50,000 ฿ |
| **Total V1 complete** | | 8-13 wk | **430,000 ฿** |

> เลือกเฉพาะ Phase 1 ก็ได้ — แล้วประเมินว่าจะทำต่อ phase ไหน. ลำดับ Phase 2 → 3 → 4 ปกติ แต่สลับได้.
