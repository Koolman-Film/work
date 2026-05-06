# User Flows

Cross-screen user journeys for V1 — shows how user navigates between screens to complete tasks, plus error/edge branches.

**Section prefix:** `FL` (e.g., FL-1, FL-2, ...)

---

## Index

### Auth flows
- [FL-1: First-time onboarding (Admin invites Employee)](#fl-1-first-time-onboarding) ⭐
- [FL-2: Daily login (returning user)](#fl-2-daily-login) ⭐
- [FL-3: Forgot password recovery](#fl-3-password-recovery)
- [FL-4: Sign out](#fl-4-sign-out)

### Employee flows
- [FL-5: Submit leave request](#fl-5-submit-leave-request) ⭐
- [FL-6: Submit cash advance](#fl-6-submit-cash-advance) ⭐
- [FL-7: View monthly pay slip](#fl-7-view-monthly-pay-slip) ⭐
- [FL-8: Update profile + LINE link (V1.5)](#fl-8-update-profile)

### Admin flows
- [FL-9: Approve leave request](#fl-9-approve-leave-request) ⭐
- [FL-10: Approve cash advance + receipt](#fl-10-approve-cash-advance) ⭐
- [FL-11: Import attendance from Excel](#fl-11-import-attendance) ⭐
- [FL-12: Manual attendance entry / override deduction](#fl-12-manual-attendance)
- [FL-13: Run monthly payroll](#fl-13-run-monthly-payroll) ⭐⭐ critical
- [FL-14: Export PEAK accounting](#fl-14-export-peak-accounting) ⭐
- [FL-15: Onboard new employee (CSV bulk import)](#fl-15-bulk-import-employees)
- [FL-16: View audit log](#fl-16-view-audit-log)

### Owner flows
- [FL-17: Daily company-wide overview](#fl-17-owner-daily-overview)
- [FL-18: Review specific employee's records](#fl-18-owner-employee-drilldown)

### Cross-cutting
- [FL-19: Notification routing](#fl-19-notification-routing)
- [FL-20: Session expiry recovery](#fl-20-session-expiry)

---

## Conventions

### Step format

```
Step N. [Actor] action → [Screen-ID or System]
   ↓
Step N+1. ...
```

### ASCII flow diagram

```
[Start]
   │
   ▼
{Screen S-A1}
   │ submit
   ▼
< condition? >
 ├ YES → {Screen X}
 └ NO  → {Toast Y}
```

- `[box]` = state or system event
- `{Screen}` = UI screen (refs auth.md, employee.md, admin.md, owner.md)
- `< condition >` = decision point
- `(Server Action)` = backend call

### Time markers

- ⚡ instant (< 200ms feedback)
- ⏳ async (Inngest job — eventual consistency)
- 📧 email send (delayed — minutes)
- 🔔 in-app notification

---

# Auth flows

## FL-1: First-time onboarding

**Actor:** Admin → Employee (2-actor flow)
**Trigger:** New employee hired, Admin needs to add to system
**Outcome:** Employee has working account + completes setup

### Steps

```
ADMIN SIDE:
1. Admin navigates to /admin/employees                      → S-N3 (employee list)
2. Click [+ เพิ่มพนักงาน]                                    → S-N4 (employee form)
3. Fill form (name, email, branch, dept, role, salary, ...) → F-N1
4. Submit                                                   → (Server Action: createEmployee)
   ↓
   • Insert Employees row (status: Pending)
   • Call supabase.auth.admin.inviteUserByEmail(email)
   • Audit log entry
   ↓
5. ⚡ Toast T-N1: "เพิ่มพนักงานสำเร็จ — ส่งคำเชิญไปทาง email"
6. Redirect to /admin/employees with new row visible

📧 EMAIL DELIVERY (~30s later):
7. Employee receives E-A1 email with [ตั้งรหัสผ่าน] button

EMPLOYEE SIDE:
8. Employee clicks button in email → /welcome?token=...    → S-A3 (welcome)
9. Server validates token (X-A3 if invalid)
10. Employee fills password + confirm                       → F-A3
11. Submit                                                  → (Server Action: setInitialPassword)
    ↓
    • Set password
    • Auto sign-in (set session cookie)
    • Insert into Employees: auth_user_id = newly created auth.users.id
    • Audit log
    ↓
12. ⚡ Toast T-A6: "ยินดีต้อนรับ!"
13. Redirect to role-based dashboard (Employee → S-E1)
```

### Branches

- **Email never received:**
  - Employee tells Admin
  - Admin can resend invite from /admin/employees/[id] → "Resend invite"

- **Token expired (X-A3) (after 7 days):**
  - Employee sees error state on /welcome
  - Click "กลับสู่หน้าเข้าสู่ระบบ" → /login
  - Or contact Admin → Admin re-invite

- **Email already in auth.users (rehire):**
  - Server detects via email match
  - Reuse `auth.users.id` → link to new Employees row
  - Skip invite email → Admin tells employee directly
  - (V1: rare, V2: dedicated rehire flow)

### Cross-references
- Screens: S-N3 (admin emp list), S-N4 (emp form), S-A3 (welcome)
- Forms: F-N1 (employee form), F-A3 (welcome form)
- Email: E-A1 (invite)
- Audit: 2 entries (createEmployee + setInitialPassword)

---

## FL-2: Daily login

**Actor:** Any user (Employee/Admin/Owner)
**Trigger:** User opens app or browser cookie expired
**Outcome:** User reaches role-based dashboard

```
1. User opens app URL (any path)
2. Middleware checks session cookie
   ├ Valid + role match → redirect to current path
   └ No session → redirect /login
3. User on /login                          → S-A1
4. Enter email + password → submit         → F-A1
5. (Server Action: signIn)
   ├ Bad creds → ⚡ T-A2 toast (stay on /login)
   ├ Rate limited → X-A1 (5min cooldown)
   └ OK + 2FA required → continue
6. Server triggers: supabase.auth.signInWithOtp({ email })
7. ⚡ T-A1 toast: "ส่ง OTP ไปยัง t***@finnixfilm.com"
8. Redirect /verify-otp?email=...           → S-A2

📧 EMAIL DELIVERY (~10s):
9. User checks email — sees E-A2 with 6-digit code

10. User types/pastes code → auto submit when 6 digits → F-A2
11. (Server Action: verifyOtp)
    ├ Wrong → ⚡ T-A2 toast (cells flash, clear)
    ├ Wrong 3 times → X-A2 lockout
    ├ Expired → ⚡ T-A2 + click "ส่งรหัสอีกครั้ง"
    └ OK → set session cookie
12. ⚡ T-A4 toast: "เข้าสู่ระบบสำเร็จ"
13. Redirect by role:
    ├ User      → /dashboard (S-E1)
    ├ Admin     → /admin/dashboard (S-N1)
    └ Owner     → /owner/dashboard (S-O1)
```

### Branches

- **User opens /login while already logged in:** X-A6 — server-side redirect to dashboard, no flicker
- **User opens deep link while logged out:** redirect /login?redirectTo=/the/path → after auth, jump to original path

---

## FL-3: Password recovery

**Actor:** User who forgot password
**Trigger:** User clicks "ลืมรหัสผ่าน?" on /login

```
1. /login → click forgot link → /reset-password (Step 1)  → S-A4 step 1
2. User enters email → submit                              → F-A4
3. (Server Action: resetPasswordRequest)
   • Privacy: always show same UI even if email not found (X-A4)
4. ⚡ Show success state "ส่งลิงก์รีเซ็ตแล้ว"

📧 EMAIL DELIVERY (~30s):
5. User receives E-A3 email with reset button

6. Click [รีเซ็ตรหัสผ่าน] → /reset-password?token=...     → S-A4 step 2
7. Server validates token (X-A5 if invalid/expired >1h)
8. User enters new password + confirm → submit            → F-A5
9. (Server Action: resetPassword)
   • Update password
   • Auto sign-in → cookie set
   • Send E-A4 (password changed notification, security)
10. ⚡ T-A5: "เปลี่ยนรหัสผ่านสำเร็จ"
11. Redirect to role-based dashboard
```

---

## FL-4: Sign out

**Actor:** Any user
**Trigger:** User clicks "ออกจากระบบ" in profile dropdown

```
1. Click profile avatar → dropdown opens
2. Click "ออกจากระบบ"
3. M-A2 modal opens: "ออกจากระบบ?"
4. Click [ออกจากระบบ] (danger)
5. (Server Action: signOut)
   • Clear cookie
   • Audit log
6. Redirect /login
```

---

# Employee flows

## FL-5: Submit leave request

**Actor:** Employee → Admin
**Outcome:** Leave approved (or rejected) → Attendance record created (if approved)

```
EMPLOYEE SIDE:
1. Employee on /dashboard (S-E1)
2. Click 📅 (bottom nav) → /leave (S-E3)
3. Click [+ ส่งคำขอลา] → /leave/new (S-E4)
4. Fill form: type / dates / reason / attach optional → F-E2
5. Click "ส่งคำขอ"
6. (Server Action: createLeaveRequest)
   • Insert LeaveRequest row, Status=รออนุมัติ
   • Upload attachment to Supabase Storage if any
   • Audit log
   • Inngest event "leave.submitted" fired
7. ⚡ T-E1 toast: "ส่งคำขอลาเรียบร้อย — รอแอดมินอนุมัติ"
8. Redirect to /leave (list shows new row "รออนุมัติ")

⏳ INNGEST: notify-event handler:
9.    🔔 In-app notification → Admin
10.   📧 Email E-N1 to Admin (subject: "คำขอลาใหม่จาก {name}")

ADMIN SIDE:
11. Admin sees notification bell badge increase
12. Click bell → drawer → see "คำขอลาใหม่จาก ตงค์ สมศรี"
13. Click → /admin/leave (S-N5 inbox) with item highlighted
14. Click row → drawer opens with details (D-N1)
15. Admin reviews → click [✅ อนุมัติ] (or ปฏิเสธ + reason)
16. (Server Action: approveLeaveRequest)
    • Update LeaveRequest status
    • Auto-create Attendance rows for each day in range
    • Audit log
    • Inngest event "leave.approved"

⏳ INNGEST notify employee:
17.   🔔 In-app notif → Employee
18.   📧 Email E-N2 to Employee

EMPLOYEE SIDE (later):
19. Employee opens app → sees notif: "คำขอลาของคุณได้รับการอนุมัติ"
20. Click → /leave/[id] → status: อนุมัติแล้ว
```

### Branches

- **Rejected:** Status=ปฏิเสธ + reason + email E-N3 to employee
- **Cancelled by employee** (before approval): allow if Status=รออนุมัติ
- **Calendar conflict:** server warns "{name} ลาวันเดียวกัน 2 คนแล้ว — ยังต้องการอนุมัติ?" (V2)
- **Over quota** (V2): warning before submit

---

## FL-6: Submit cash advance

**Actor:** Employee → Admin
**Outcome:** Advance approved with receipt + auto-deducted next payroll

```
EMPLOYEE SIDE:
1. /dashboard → click 💰 → /advance (S-E5)
2. Click [+ ขอเบิกเงิน] → /advance/new (S-E6)
3. Fill: amount + reason → F-E3
4. Submit
5. (Server Action: createAdvance)
6. ⚡ T-E2: "ส่งคำขอเบิกเรียบร้อย"
7. Redirect /advance with new row (รออนุมัติ)

⏳ Notify Admin (in-app + email)

ADMIN SIDE:
8. Admin clicks notif → /admin/advance/[id] (S-N9)
9. Reviews + drags receipt image to upload area → upload to Supabase Storage
10. Click [✅ อนุมัติ + แนบสลิป]
11. (Server Action: approveAdvance with receiptUrl)
    • Update Status=อนุมัติแล้ว, ReceiptImageURL, IsDeducted=false
    • Audit log

⏳ Notify Employee

EMPLOYEE SIDE (later):
12. Open app → see notif "คำขอเบิกอนุมัติแล้ว — ฿5,000"
13. Click → /advance/[id] → see receipt image (download via presigned URL)

NEXT MONTH:
14. Admin runs FL-13 (payroll)
    • Server queries CashAdvance.IsDeducted=false → auto-include in Deduct_Advance
    • After publish → flag IsDeducted=true
15. Employee sees deduction in slip
```

---

## FL-7: View monthly pay slip

**Actor:** Employee
**Trigger:** Monthly slip published by Admin (FL-13) OR user opens manually

```
WHEN ADMIN PUBLISHES (FL-13):
0a. Inngest fan-out: 1 email per employee with PDF slip
0b. 🔔 In-app notif "สลิปเงินเดือน {month} พร้อมแล้ว"

EMPLOYEE OPENS:
1. /dashboard → click 📄 → /payslip (S-E7)
2. List shows months with status badge
3. Click month → /payslip/[month] (S-E8)
4. View detail: income / deductions / NetPay table
5. Optional: click [📥 ดาวน์โหลด PDF]
   • (Server Action: downloadSlipPdf) → returns presigned URL
   • Browser triggers download
```

---

## FL-8: Update profile

**Actor:** Employee
**Trigger:** Self-service update (phone, email, notification prefs)

```
1. Topbar → click avatar → "โปรไฟล์" → /profile (S-E9)
2. View current data (read-only by default)
3. Click [แก้ไข] on section → form opens inline
4. Edit phone / email / notification prefs → F-E5
5. Submit → (Server Action: updateOwnProfile)
6. ⚡ T-E5: "บันทึกแล้ว"

V1.5 LINE LINK:
7. Section "เชื่อมต่อ LINE" → click [เชื่อม LINE]
8. Open LIFF URL in LINE app → LIFF SDK returns userId
9. POST /api/line/link → save lineUserId to Employees
10. Section shows "เชื่อมแล้ว ✓ {LINE display name}"
```

### Read-only fields (V1)

User cannot self-edit:
- FullName (ติดต่อ Admin)
- Department, Branch, Job title, Salary
- NationalID, BankAccount

User CAN edit: phone, email, address, emergency contact, notification preferences

---

# Admin flows

## FL-9: Approve leave request

(See [FL-5 employee side merging into admin side](#fl-5-submit-leave-request) — admin half of that flow)

Quick reference:
```
1. Inbox /admin/leave → filter by "รออนุมัติ"
2. Click row → drawer with detail
3. Decide:
   • Approve → Server Action approveLeaveRequest → auto-creates Attendance
   • Reject → required reason → Server Action rejectLeaveRequest
4. Notification fired to employee
```

---

## FL-10: Approve cash advance

(See [FL-6](#fl-6-submit-cash-advance) employee side — admin half is steps 8–11)

---

## FL-11: Import attendance from Excel

**Actor:** Admin
**Trigger:** Daily/weekly Admin uploads scanner export Excel file
**Outcome:** Attendance rows created with auto-calc deductions

```
1. /admin/attendance → click [📤 อัปโหลด Excel] → /admin/attendance/upload (S-N12)
2. Drag Excel file (.xlsx) to drop area
3. Browser uploads file via Server Action → Supabase Storage path imports/{adminId}/{ts}.xlsx
4. Inngest event "attendance/excel.uploaded" fired

⏳ INNGEST WORKER (parse-attendance-excel):
5.    Parse with ExcelJS
6.    Validate per row:
       • Match EmployeeID (or NationalID)
       • Detect late (compare ClockIn to working_hours start + tolerance)
       • Detect missing scan
       • Map status code from scanner
7.    Save preview to ImportJob table
8.    🔔 Notify admin "พร้อม preview {500} rows"

ADMIN SIDE (preview):
9. Click notif → see preview table
10. Validation summary:
    ✅ 487 rows OK
    ⚠️ 8 rows: พนักงาน ID ไม่พบ (highlight แดง)
    ⚠️ 5 rows: duplicate (highlight เหลือง)
11. Admin can:
    • Skip invalid rows (uncheck)
    • Manually fix EmployeeID lookup
    • Skip duplicates
12. Click [💾 บันทึก {487} rows]
13. (Server Action: commitAttendance)
    • Bulk insert
    • Auto-calc DeductionAmount per row using PayrollConfig formula
    • Mode: 'auto' (Admin can override per row later — see FL-12)
14. Audit log entry: "imported 487 attendance records from {filename}"
15. ⚡ T-N5: "นำเข้าสำเร็จ 487 รายการ"
16. Redirect /admin/attendance with new rows
```

### Branches

- **File format wrong:** Inngest job fails → 🔔 notif "ไฟล์ไม่ถูกต้อง — โปรดตรวจสอบ format"
- **All rows invalid:** Block commit, show error
- **Already imported same file:** Detect by checksum, warn "ไฟล์นี้นำเข้าแล้วเมื่อ 2 ชม.ที่แล้ว"

---

## FL-12: Manual attendance / override deduction

**Actor:** Admin
**Triggers:**
- Employee forgot to scan, asks Admin to add manually
- Admin needs to override auto-calc DeductionAmount (gap from competitor systems!)

### A. Manual entry

```
1. /admin/attendance → click [+ คีย์ลงเวลามือ] → /admin/attendance/manual (S-N11)
2. Fill: employee combobox / date / type / duration → F-N4
3. Submit → (Server Action: createAttendance)
4. Audit log
5. Toast → redirect to list
```

### B. Override deduction (key differentiator from competitor)

```
1. /admin/attendance → click ✏ on row → modal M-N3 opens
2. Show current DeductionAmount (auto)
3. Edit amount field
4. Required: Note explaining override
5. Submit → (Server Action: overrideDeduction)
   • Update DeductionAmount, DeductionMode='manual', OverriddenBy, OverriddenAt
   • Audit log entry with before/after
6. If override > threshold → 🔔 notify Owner (alert)
7. Toast → close modal → row updates
```

---

## FL-13: Run monthly payroll ⭐⭐ MOST CRITICAL

**Actor:** Admin (or Vercel Cron auto-trigger)
**Trigger:** End of month / pay date / manual button
**Outcome:** All employees have published Payroll slip + emails sent

```
TRIGGER (manual):
1. Admin → /admin/payroll → see month list
2. Click "เม.ย. 2026" → /admin/payroll/[month] (S-N13)
3. Status: 📝 Draft, table empty
4. Click [⚡ Trigger Payroll]
5. Confirm dialog "จะคำนวณสลิปสำหรับ 124 พนักงาน OK?" (M-N4)
6. Click ยืนยัน
7. (Server Action: triggerPayroll(month))
   • Insert Payroll job tracking row
   • Inngest event "payroll/generate.requested"

⏳ INNGEST FAN-OUT:
8. Inngest creates 1 sub-job per active employee
9. Each sub-job:
   • Fetch employee + base salary (probation rate if applicable)
   • Calc Income_Base, Income_Other (manual or 0)
   • Calc Deduct_SocialSecurity = min(BaseSalary*0.05, 750)
   • Sum approved CashAdvance.IsDeducted=false → Deduct_Advance
   • Sum Attendance.DeductionAmount for month → Deduct_Attendance
   • Calc NetPay
   • Insert Payroll row, Status='Draft'

ADMIN MONITORING:
10. Page shows realtime progress via Supabase Realtime subscribe
    "กำลังคำนวณ... 78/124"
11. When done → table populated with all rows

ADMIN REVIEW:
12. Admin reviews each employee
    • Click ✏ on row → edit dialog (M-N6)
    • Override field (Income_Other, Deduct_Debt, etc.) with required Note
    • (Server Action: overrideField) — audit log per change
13. Override warnings shown inline:
    ⚠️ EMP-3: NetPay < ฿20,000 (เคย OT คืน?)
14. Mark each as "Reviewed" (optional UX nicety)

PUBLISH:
15. Click [📤 Publish all 124 slips]
16. Confirm dialog "Publish ล็อกการแก้ไข + ส่ง email สลิปให้ทุกคน — ยืนยัน?" (M-N5)
17. Click ยืนยัน
18. (Server Action: publishPayroll)
    • Update all Payroll rows: Status='Published', PublishedAt
    • Mark all included CashAdvance.IsDeducted=true
    • Audit log: "published payroll month 2026-04"
    • Inngest fan-out: 1 send-slip job per employee

⏳ INNGEST SEND SLIPS:
19. Per employee:
    • Render PDF slip (@react-pdf/renderer)
    • Upload to Supabase Storage path slips/{empId}/{month}.pdf
    • Send email E-N5 with [Download PDF] link (presigned URL TTL 7 days)
    • 🔔 In-app notif

ADMIN MONITORING (realtime):
20. Page shows "กำลังส่งสลิป... 88/124 ส่งแล้ว"
21. Complete → Status: 🔒 Published

EMPLOYEE SIDE:
22. Each employee gets 🔔 in-app + 📧 email simultaneously
23. Open /payslip → see new month → click → /payslip/[month] (S-E8)
```

### Branches

- **Auto-trigger (Vercel Cron):**
  - Cron runs daily 1am, checks if today = pay date (e.g., 25th of month)
  - If yes → trigger payroll automatically
  - Admin notified to review (no auto-publish — always Admin manual publish)

- **Need to revise after publish (e.g., found error):**
  - Admin opens slip → click [Unlock]
  - Required: reason
  - Creates revision Payroll row (RevisionOf=originalId, Version=2)
  - Original kept; new editable
  - When re-published → email sent again with revision label

- **Employee leaves mid-month:**
  - Admin manually adjusts: Override Income_Base = pro-rata calc
  - Document in Note field

- **Calc error / Inngest job fails:**
  - Sentry alert
  - Admin sees row missing — manual retry button per employee

---

## FL-14: Export PEAK accounting

**Actor:** Admin (Accounting role typically)
**Trigger:** End of month after payroll publish
**Outcome:** CSV file ready to import into PEAK Account

```
1. /admin/accounting (S-N14)
2. Filter: month = "เม.ย. 2026", group = "ทั้งหมด" (or specific AccountingGroup)
3. Click [📤 Export PEAK CSV]
4. (Server Action: exportPeakCsv)
   • Query Payroll for month + group filter
   • Build CSV per PEAK format
   • Return as Blob to client
5. Browser triggers download: payroll-2026-04-peak.csv
6. ⚡ T-N7: "Export สำเร็จ"

EXTERNAL:
7. Admin opens PEAK Account → Import CSV → done
8. (Optional) Click [📤 Export Excel summary] for reference
```

---

## FL-15: Bulk import employees

**Actor:** Admin (during onboarding setup)
**Trigger:** Initial setup or annual hiring batch

```
1. /admin/employees/import (S-N5)
2. Download template CSV (link)
3. Admin fills template offline
4. Drag/upload CSV
5. Browser parses → preview table with validation per row
6. Admin reviews, fixes errors, removes invalid rows
7. Click [💾 Import {N} employees]
8. (Server Action: bulkImportEmployees)
   • Per row: insert Employees row + send invite email
   • Throttled to avoid rate limits
9. Show progress bar
10. Done → redirect /admin/employees with all new rows
```

---

## FL-16: View audit log

**Actor:** Admin (Super) or Owner
**Trigger:** Investigate suspicious activity / quarterly compliance

```
1. /admin/audit (S-N16) or /owner/audit (S-O4)
2. Filter: date range / actor / entity / action
3. Table shows entries
4. Click row → drawer (D-N3) with full before/after JSON
5. Optional [Export CSV] for archive
```

---

# Owner flows

## FL-17: Owner daily overview

**Actor:** Owner
**Trigger:** Morning routine — check company status

```
1. /owner/dashboard (S-O1)
2. KPI cards visible at top:
   • พนักงาน active total
   • วันนี้: ขาด/ลา/สาย counts
   • เดือนนี้: ยอดเบิก, ยอดหัก, NetPay total (estimated)
3. Trend charts: 6-month deduction trend
4. Click "ดูปฏิทิน" → /owner/calendar (S-O2)
5. Browse calendar by month, filter by branch/dept
6. Click any cell → drawer with details
```

---

## FL-18: Owner employee drilldown

**Actor:** Owner
**Trigger:** Specific concern about an employee

```
1. /owner/calendar → click cell mentioning employee
2. Drawer shows employee's records that day
3. Click "ดูทั้งหมด" → /admin/employees/[id] (read-only mode for Owner)
4. View full profile
5. Click /owner/payroll → see slip history (read-only)
```

---

# Cross-cutting flows

## FL-19: Notification routing

**Actor:** System (no user direct input)
**Trigger:** Any notification-eligible event fires

```
EVENT (e.g., leave.approved):
1. Server Action publishes event:
   inngest.send({ name: 'leave.approved', data: { recipientId, ... } })

⏳ INNGEST notify-event handler:
2. Lookup recipient's NotificationPreference for this event type
3. For each enabled channel:
   ├ in-app: Insert Notification row → realtime push to recipient if online
   ├ email:  Send via Resend with react-email template
   ├ LINE:   (V1.5) push via LINE Messaging API
   └ SMS:    (V2) skip in V1
4. Audit log "notified {recipientId} via {channels}"

RECIPIENT:
5. If browsing app → realtime bell badge increment
6. If logged out → email arrives (≤1 min)
7. Open app → click bell → drawer
8. Click notification → navigate to source page
9. Mark read on click
```

---

## FL-20: Session expiry recovery

**Actor:** Any logged-in user
**Trigger:** JWT expired, refresh failed (network issue, password changed elsewhere)

```
1. User performs any action → Server Action returns 401
2. Client detects → trigger M-A1 modal "เซสชันหมดอายุ"
3. User clicks [เข้าสู่ระบบ]
4. Redirect /login?redirectTo={originalPath}
5. After successful login → redirect back to original path
6. Toast T-C1 (common): "ยินดีต้อนรับกลับ"
```

---

# Flow priority for build

ลำดับ implement ตาม [build-plan.md](../build-plan.md):

| Week | Flows |
|---|---|
| W1–W2 | FL-1 (onboarding), FL-2 (login), FL-3 (reset), FL-4 (signout), FL-15 (bulk import) |
| W3 | FL-11 (Excel import), FL-12 (manual attendance + override) |
| W4 | FL-5 (leave), FL-9 (approve leave), FL-19 (notification routing — partial) |
| W5 | FL-6 (advance), FL-10 (approve advance) |
| W6 | FL-13 (payroll) ⭐⭐ |
| W7 | FL-7 (employee view slip), FL-17/18 (owner views) |
| W8 | FL-14 (PEAK export), FL-16 (audit) |
| W9 | FL-8 (profile), FL-19 (notification full polish) |
| W10 | FL-20 (session) + edge cases polish |
| V1.5 | FL-8 LINE link section, mobile clock-in flow |

---

# Cross-references

- **Screens:** [auth.md](./auth.md), [employee.md](./employee.md), [admin.md](./admin.md), [owner.md](./owner.md)
- **Server Actions:** [architecture.md §6](../architecture.md#6-server-actions-inventory)
- **Notifications:** [feature-spec.md §M8](../feature-spec.md#module-8-notifications)
- **Build schedule:** [build-plan.md](../build-plan.md)
