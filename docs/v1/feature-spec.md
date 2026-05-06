# V1 Feature Spec (per-module detail)

ครอบคลุม per-feature: validations, edge cases, acceptance criteria, error states

---

## Module 1: Authentication

### F1.1 Login (phone + password)

**Inputs:** phone (required, E.164 format), password (required, ≥ 8 chars)

**Server Action:** `signIn(phone, password)`
- Calls `supabase.auth.signInWithPassword`
- On success → check `Employees.requires_2fa` → always trigger OTP
- Generate `signInWithOtp({ phone })` to send 6-digit code
- Redirect `/verify-otp?phone=...`

**Errors:**
- Invalid credentials → "อีเมลหรือรหัสผ่านไม่ถูกต้อง"
- Account not invited → "ยังไม่ได้รับคำเชิญ — ติดต่อแอดมิน"
- Account archived → "บัญชีไม่ได้ใช้งาน — ติดต่อแอดมิน"
- Rate limit → "พยายามบ่อยเกินไป กรุณารอ X นาที"

**Edge cases:**
- Phone with non-digit chars → strip
- Caps lock detect → show hint
- Browser autofill → react-hook-form support `useForm({ mode: 'all' })`

### F1.2 Verify OTP

**Inputs:** 6-digit code (required, 6 numeric chars)

**Server Action:** `verifyResetOtp(phone, code)`
- Calls `supabase.auth.verifyOtp({ phone, token: code, type: 'sms' })`
- On success → set cookie session via SSR helpers
- Redirect by role: Employee → `/dashboard`, Admin → `/admin/dashboard`, Owner → `/owner/dashboard`

**Errors:**
- Wrong code → "รหัส OTP ไม่ถูกต้อง"
- Expired (after 10 min) → "รหัสหมดอายุ — ขอใหม่"
- Too many attempts → lockout

**Edge cases:**
- Auto-submit when 6 digits entered
- Resend after 60s cooldown
- Paste 6-digit from clipboard auto-fills

### F1.3 Reset Password

**Trigger:** `/login` → "ลืมรหัสผ่าน"

**Flow:**
1. Submit phone
2. `supabase.auth.sendResetOtpSms(phone)`
3. SMS OTP → user enters at `/reset-password` step 2
4. Set new password (≥ 8 chars, at least 1 number) → submit
5. Auto sign-in → redirect dashboard

### F1.4 Admin Invite Employee

**Trigger:** Admin creates new Employee record

**Flow:**
1. Admin fills `/admin/employees/new` form
2. Submit → Server Action `createEmployee` → DB insert (Status: Pending)
3. Same action → call `supabase.auth.admin.inviteUserByPhone(phone)`
4. Supabase sends invite SMS → Employee receives magic link
5. Employee clicks → `/welcome?token=...` → set password
6. After save → DB update `auth_user_id`, Status: Active

**Edge case:** Phone already exists in `auth.users` (rehire) → use existing UUID, link to new EmployeeID

---

## Module 2: Employee Management

### F2.1 Create Employee

**Form fields (required):**
- Phone (unique in auth.users, E.164 format)
- FullName
- BranchID (FK)
- Department
- JobTitle
- StartDate
- BaseSalary
- Role (Owner / Admin / User — default User)
- AccountingGroupID (FK)
- EmploymentStatus (Probation / Regular)

**Optional:**
- Phone, Address, NationalID, AddressPerID, SocialSecurityNo, BankAccount, EmergencyContact, ProbationSalaryRate

**Validations:**
- Phone format (E.164), uniqueness
- NationalID = 13 digits Thai (use checksum)
- BankAccount = 10–12 digits
- BaseSalary > 0
- StartDate ≤ today

**Edge cases:**
- Rehire: detect by NationalID match → reuse old EmployeeID, archive previous → reactivate new record
- Probation auto-converts to Regular after X months (V2 — V1 manual flip by Admin)

**Audit:** logAudit({ action: 'employee.create', entity: 'Employees', entityId, before: null, after })

### F2.2 Bulk Import (CSV)

**Format:** CSV with header row matching field names

**Process:**
1. Admin uploads `.csv` → parse client-side preview
2. Validate each row → red highlight invalid
3. Submit valid rows → Server Action bulk insert
4. Each new employee auto-receives invite SMS
5. Audit log: 1 entry per import job + per-row entries

**Errors:**
- Malformed CSV → friendly error
- Duplicate phone in file → reject row
- Phone collision with existing employee → reject row

### F2.3 Archive (soft delete)

**Action:** Admin clicks "ปิดใช้งาน"
- Confirm dialog "ยืนยันการ archive — ผู้ใช้จะ login ไม่ได้"
- Server Action `archiveEmployee(id)` → set EmploymentStatus = Terminated, log audit
- Auth.users record kept (don't delete) — for rehire link

### F2.4 Rehire

**Action:** Admin opens archived employee → click "Rehire"
- Reactivate (EmploymentStatus → Probation/Regular)
- New StartDate
- Log audit
- Auth re-invite (if phone lost) or re-enable

---

## Module 3: Time Tracking (Attendance)

### F3.1 Manual Entry

**Form:**
- Employee (combobox)
- Date
- Type (enum: ลาป่วย/ลากิจ/ลาพักร้อน/สาย/ไม่สแกนนิ้ว/ขาด)
- Duration (1 day / half day / X minutes)
- DeductionAmount (auto-calc preview, editable)
- DeductionMode (auto/manual)
- Note (optional)

**Validations:**
- Employee must be active
- Date ≤ today
- DeductionAmount ≥ 0
- If `manual` override → require Note

**Server Action:** `createAttendance(data)`
- Insert row
- Audit log
- Trigger Inngest `notify-event` for any payroll-affecting change

### F3.2 Excel Upload

**Supported format:** `.xlsx`, `.xls`

**Expected columns** (configurable in admin settings):
- EmployeeID (or NationalID)
- Date (yyyy-mm-dd or dd/mm/yyyy)
- ClockIn (HH:MM)
- ClockOut (HH:MM)
- Status (raw scanner code → mapped)

**Process:**
1. Upload to Supabase Storage (path: `imports/{adminId}/{timestamp}.xlsx`)
2. Inngest job: parse with ExcelJS → return JSON
3. Validate per row:
   - Match EmployeeID
   - Detect late (compare ClockIn vs working_hours start + tolerance from config)
   - Detect missing scan (no ClockIn/ClockOut)
   - Map status code
4. Generate preview table → save to ImportJob table
5. Admin reviews → mark rows to commit/skip
6. Commit → bulk insert Attendance rows + auto-calc DeductionAmount

**Edge cases:**
- Multiple punches per day → keep first/last only
- Cross-midnight shifts → V1 not supported (no night shift)
- Wrong date format → auto-detect, fallback ask user

### F3.3 Override Deduction

**Trigger:** Admin click ✏ on attendance row → modal
- Show current DeductionAmount (auto-calculated)
- Edit amount field
- Required: Note (เหตุผล override)
- Submit → Server Action `overrideDeduction(id, amount, note)`
- Update DeductionMode='manual', OverriddenBy, OverriddenAt
- Audit log entry with before/after

**Validations:** amount ≥ 0, Note required

---

## Module 4: Leave Management

### F4.1 Submit Leave Request (Employee)

**Form:**
- LeaveType (select from active LeaveTypes)
- StartDate, EndDate (date range)
- Duration (auto-calc: business days excluding holidays)
- Reason (required, ≥ 10 chars)
- AttachmentURL (optional file upload)

**Validations:**
- StartDate ≥ today (V1 disallow back-dating)
- EndDate ≥ StartDate
- File: image/pdf, max 5 MB
- Server-side: check no overlapping approved leave for same employee

**Server Action:** `createLeaveRequest(data)`
- Insert with Status='รออนุมัติ'
- Upload file to Supabase Storage if any
- Audit log
- Inngest event `leave.submitted` → notify Admin (in-app + email)

**Edge cases:**
- Half-day → V2 (V1 disable)
- Cross-month leave → split? V1: keep as single record, count days correctly
- Over-quota → V1: no quota tracking → allow, Admin's call

### F4.2 Approve / Reject (Admin)

**Action:** click row in inbox → drawer

**Approve:**
- Optional Admin note
- Submit → Server Action `approveLeaveRequest(id, note)`
- Update Status, ApprovalDate, ApproverID, ApprovalNote
- **Auto-create Attendance records** for each day in range (Type=LeaveType, DeductionAmount=0 default)
- Audit log
- Inngest event `leave.approved` → notify Employee

**Reject:**
- Required reject reason
- Submit → Server Action `rejectLeaveRequest(id, reason)`
- Update Status='ปฏิเสธ'
- Notify Employee

**Bulk:** select multiple → bulk approve/reject (single audit batch)

### F4.3 Calendar View

**Three scopes:**
- Employee: own department only (read-only)
- Admin: all company (with edit access)
- Owner: all company + filter by branch (read-only)

**Layout:** monthly grid, each day cell shows:
- Number of people on leave (badge)
- Color dots by leave type
- Click cell → drawer with names + types

---

## Module 5: Cash Advance

### F5.1 Submit Request (Employee)

**Form:**
- Amount (number > 0)
- Reason (required, ≥ 10 chars)

**Validations:**
- Amount ≥ 100 baht (configurable)
- Amount ≤ 5× BaseSalary (configurable safety limit)
- No active pending request? V1: allow unlimited (q54 confirmed)

**Server Action:** `createAdvance(data)`
- Insert Status='รออนุมัติ', RequestDate=now
- Audit + notify Admin

### F5.2 Approve + Attach Receipt (Admin)

**Action:** /admin/advance/[id]
- Show employee details, history, current balance estimate
- Approve dialog:
  - Required: upload Receipt image (jpg/png/pdf, max 5MB) → Supabase Storage presigned upload
  - Optional: note
  - Server Action `approveAdvance(id, receiptUrl, note)`
  - Update Status, AdminID, ApprovalDate, ReceiptImageURL
  - **IsDeducted = false** (จะหักเดือนหน้า)
  - Audit log
  - Notify Employee
- Reject:
  - Required reason
  - Update Status='ปฏิเสธ'

### F5.3 Auto-deduct in Payroll

**Logic in payroll-calc service:**
```
Deduct_Advance = sum(CashAdvance.Amount where
  EmployeeID = X
  AND Status = 'อนุมัติแล้ว'
  AND IsDeducted = false
  AND ApprovalDate < cutoff_date
)
```

After payroll **publish:**
- Mark all those CashAdvance.IsDeducted = true
- Log audit

---

## Module 6: Payroll

### F6.1 Calculate Payroll for Month

**Trigger:**
- Manual: Admin clicks "Trigger Payroll" on `/admin/payroll/[month]`
- Auto: Vercel Cron 25th monthly (configurable)

**Inngest function `payroll.generate`:**

```pseudo
for each active Employee:
  emp = fetch(employeeId)
  baseSalary = emp.EmploymentStatus == 'Probation' ? emp.ProbationSalaryRate : emp.BaseSalary

  income_base   = baseSalary
                  - pro_rata_for_partial_month_if_new_or_terminated  // V2 auto, V1 manual
  income_other  = sum(manual_entries_by_admin)  // V1 admin keys ใน config
  ss            = min(baseSalary * 0.05, 750)
  advance       = sum(approved CashAdvance not yet deducted)
  attendance    = sum(Attendance.DeductionAmount for the month)
  debt          = manual entry by admin if any
  netpay        = income_base + income_other - ss - advance - attendance - debt

  insert Payroll(employeeId, month, ...amounts, status='Draft')
```

**Performance:** 100 emp × ~2s = ~200s if sequential. Inngest fan-out → < 30s.

### F6.2 Override Field

**Trigger:** Admin clicks any field on payroll row → edit dialog
- Editable fields: Income_Other, Deduct_*, Note
- Required: Reason note if amount changed
- Server Action `overrideField(slipId, field, value, note)`
- Audit log with before/after

### F6.3 Publish Payroll

**Pre-flight check:**
- All slips reviewed? (no warning flags unaddressed)
- Click [📤 Publish 124 slips]
- Confirm dialog: "Publish จะ lock การแก้ไข + ส่ง email สลิปให้ทุกคน — ยืนยัน?"

**Server Action `publishPayroll(month)`:**
1. Update all Payroll rows for month: Status='Published', PublishedAt
2. Mark CashAdvance.IsDeducted = true for all included
3. Inngest fan-out: 1 email per employee with PDF slip attached
4. Audit log: "published payroll month 2026-04 — 124 slips"

### F6.4 Pay Slip PDF

**Template `src/lib/pdf/slip.tsx`** (using @react-pdf/renderer):

```
┌─────────────────────────────────────────┐
│   [Logo]  สลิปเงินเดือน — เมษายน 2569      │
│                                         │
│   ตงค์ สมศรี  (EMP-001)                 │
│   แผนก: Tech / สาขา: สำนักงานใหญ่           │
│   ─────────────────────────              │
│                                         │
│   รายรับ                                  │
│     เงินเดือนพื้นฐาน          ฿ 30,000.00  │
│     รายได้อื่น (คอมมิชชั่น)     ฿  5,000.00  │
│     ─────────────                        │
│     รวมรายรับ              ฿ 35,000.00   │
│                                         │
│   รายหัก                                  │
│     ประกันสังคม               ฿    750.00  │
│     เบิกเงินล่วงหน้า          ฿  2,000.00   │
│     ขาด/ลา/มาสาย             ฿    833.00  │
│     หักหนี้                   ฿       0     │
│     ─────────────                        │
│     รวมรายหัก               ฿  3,583.00  │
│                                         │
│   ─────────────                          │
│   ยอดสุทธิ                ฿ 31,417.00    │
│   ─────────────                          │
│                                         │
│   วันที่ออก: 30 เม.ย. 2569                  │
│   ผ่านการตรวจสอบโดยระบบ Koolman HR        │
└─────────────────────────────────────────┘
```

**Generation:**
- Server-side render to PDF buffer
- Upload to Supabase Storage (private bucket `slips/`) with structured path `{employeeId}/{year-month}.pdf`
- Pre-signed URL for download (TTL 15 min)

### F6.5 Lock + Revision

**After publish:** all Payroll rows have `IsLocked=true`

**To edit:** Admin clicks "Unlock" on slip → ระบุเหตุผล →
- New Payroll row created with `RevisionOf=originalId, Version=2`
- Original kept as historical
- New row editable until re-published
- Audit log entry

---

## Module 7: Accounting Export (PEAK)

### F7.1 Export PEAK CSV

**Filter:**
- Month
- AccountingGroup (optional — default all)
- Branch (optional)

**CSV format** (research PEAK actual format W7 — placeholder schema):
```
"Date","Account","Description","Debit","Credit","Reference"
"2026-04-30","5100","เงินเดือน — Sales","250,000.00","","PAY-2026-04"
"2026-04-30","2100","ค่าใช้จ่ายค้างจ่าย","","250,000.00","PAY-2026-04"
...
```

**Lines generated:**
- Per group + per account
- Income debit, deduction credit

**Action:** Server Action `exportPeakCsv(month, groupId?)` → returns Blob → trigger client download

### F7.2 Export Summary Excel

**Format:** sheet per group, columns = full payroll breakdown per employee + totals row

---

## Module 8: Notifications

### F8.1 In-app

**Trigger:** various server events
- Insert into `Notification` table (UserId, Type, Title, Message, Data JSON, ReadAt nullable)
- Topbar bell shows unread count
- Click bell → drawer with last 20 notifications
- Click item → navigate to related page + mark read

### F8.2 Email (Resend)

**Templates per event:**

| Event | Recipient | Subject |
|---|---|---|
| `leave.submitted` | Admin | คำขอลาใหม่จาก {name} |
| `leave.approved` | Employee | คำขอลาของคุณได้รับการอนุมัติ |
| `leave.rejected` | Employee | คำขอลาของคุณถูกปฏิเสธ |
| `advance.submitted` | Admin | คำขอเบิกเงินใหม่จาก {name} |
| `advance.approved` | Employee | คำขอเบิกเงินอนุมัติแล้ว — ฿{amount} |
| `advance.rejected` | Employee | คำขอเบิกเงินถูกปฏิเสธ |
| `payslip.published` | Employee | สลิปเงินเดือน {month} พร้อมแล้ว |
| `override.alert` | Owner | Admin override: {field} ฿{before} → ฿{after} |

**Sender:** `Koolman HR <noreply@finnixfilm.com>`

**Templates** (react-email .tsx) — responsive, brand-colored

### F8.3 Channel preferences

**Per-user table `NotificationPreference`:**
- UserId
- EventType
- InApp (bool)
- Email (bool)
- LINE (bool — V1.5)

**Defaults:**
- Admin: in-app+email for all
- Employee: in-app for all, email for personal events (own approval, slip)
- Owner: in-app+email for override alerts only

---

## Module 9: Audit Log

### F9.1 Logging

**Helper `logAudit({ actorId, action, entity, entityId, before, after })`** called from every Server Action that mutates data.

**Stored fields:**
- LogID, ActorID (FK Employees), Action, EntityType, EntityID
- BeforeValue (JSON), AfterValue (JSON)
- Timestamp, IPAddress, UserAgent
- (Sensitive: don't log password, OTP, full bank acc — mask)

### F9.2 Viewer

**Filters:**
- Date range
- Actor (Admin combobox)
- Entity type
- Action (search)

**Display:** table with sortable columns + drawer for full before/after JSON view

**Access:** Owner + Super Admin (V2 RBAC) — V1: Owner + any Admin

---

## Module 10: Settings (Admin)

### F10.1 General

- Company name, logo URL (upload to Supabase Storage)
- Default working hours
- Pay cycle, pay date, cut-off

### F10.2 Branches

CRUD: Name, Address, IsActive

### F10.3 Departments

CRUD: Name, IsActive

### F10.4 AccountingGroups

CRUD: Name, AccountingCode (PEAK mapping), Description

### F10.5 LeaveTypes

CRUD: Name, DefaultQuota (V1 informational only — no enforcement), IsPaid, RequiresDoc, DocAfterDays, ResetPolicy

### F10.6 Holidays

CRUD: Date, Name, Type (national/company), WorkPayMultiplier (default 2.0), BranchScope

V1 seed: Thai national holidays for 2026 (manually maintained — Admin can edit)

### F10.7 Payroll Config

Key-value editor:
- `social_security_rate` (default 0.05)
- `social_security_cap` (default 750)
- `attendance_deduct_formula` (`BaseSalary / 30` or `BaseSalary / working_days`)
- `late_threshold_min` (default 15)
- `late_deduct_per_min` (default 0 — config flat or per-min)
- `cutoff_date` (default end of month)

---

## Module 11: Owner views

### F11.1 Dashboard

**KPI cards:**
- พนักงานทั้งหมด (active)
- ขาดวันนี้ / ลาวันนี้ / สายวันนี้
- ยอดเบิกเงินเดือนนี้ (รวม)
- ยอดหักเดือนนี้ (รวม)
- เงินเดือนรวมเดือนนี้ (predicted หรือ published)

**Charts:**
- Trend ยอดหักรายเดือน (line) — 6 เดือนหลัง
- Top 10 พนักงานขาด/ลา/สายเดือนนี้

### F11.2 Calendar (full company)

ดู [screens/owner.md § Calendar](./screens/owner.md#s-o2-owner-calendar)

### F11.3 Payroll review (read-only)

Same UI as Admin payroll page but no edit actions — just view + drill-down + download PDF

### F11.4 Audit log

Same as Admin viewer

---

## Cross-cutting acceptance criteria

ทุก module ต้องผ่าน:

### Functional
- ✅ Happy path tested (E2E)
- ✅ Validation errors shown clearly in Thai
- ✅ Loading states (skeleton)
- ✅ Empty states (no data view)
- ✅ Error states (network failure)
- ✅ Audit log entry created for every mutation

### Performance
- ✅ Page render < 2s on 4G
- ✅ Server Action response < 500ms (p95)
- ✅ Excel parse < 30s for 500 rows
- ✅ Payroll generate < 60s for 100 emp

### Security
- ✅ Role check on every page (middleware + page-level)
- ✅ RLS enforced where applicable
- ✅ Input validated (Zod schema)
- ✅ XSS-safe (React auto-escape)
- ✅ Audit log immutable

### UX
- ✅ Mobile-friendly (320–480px tested)
- ✅ Keyboard navigable
- ✅ Toast feedback on actions
- ✅ Confirm dialogs for destructive actions
- ✅ Breadcrumb on admin pages

### Localization
- ✅ All strings in Thai
- ✅ Date format Thai BE
- ✅ Number format Latin numerals + commas
- ✅ Currency format `฿X,XXX.XX`
