# Koolman HR v2 — Requirement Diff

**Source of truth:** [`/requirement.docx`](../../requirement.docx) — the customer's original brief.
**This doc:** maps every claim in `requirement.docx` to its v2 design home, flags gaps closed, and lists intentional expansions to confirm with the customer before signoff.

---

## 1. Original requirement (verbatim, summarized)

The customer specified **4 tables** and a **3-part system overview**.

### 1.1 Database tables (from requirement.docx)

| # | Table | Fields |
|---|---|---|
| 1 | **Employees** | EmployeeID (PK), FullName, **Department**, StartDate, BaseSalary, Role (Admin/User) |
| 2 | **CashAdvance** | RequestID (PK), EmployeeID (FK), Amount, RequestDate, Status (pending/approved/rejected), AdminID (FK), ApprovalDate, ReceiptImageURL, IsDeducted |
| 3 | **Attendance** | AttendanceID (PK), EmployeeID (FK), Date, Type (sick / personal / vacation / late / no-scan), Duration, DeductionAmount |
| 4 | **Payroll** | PayrollID (PK), EmployeeID (FK), MonthYear, Income_Base, Income_Other, Deduct_SocialSecurity, Deduct_Advance, Deduct_Attendance, **Deduct_Debt**, NetPay |

### 1.2 System overview (from requirement.docx)

**Employee Interface:**
- Time tracking: clock in/out via mobile **or fingerprint scanner (มีอยู่แล้ว — already exists)**
- Leave: **ดูปฏิทินคนลาในทีม** (see team leave calendar) + submit leave requests for approval
- Finance: submit cash advance request + view own payslip with clear deduction breakdown

**Admin / Accounting Interface:**
- Approve cash advance with receipt attachment, with notification on new requests
- **แยกพนักงานเป็น 2 กลุ่ม** (split employees into 2 groups for accounting): company-expense group and paid-on-behalf / refundable group
- Monthly summary table: salary, bonuses, SSO, advances, attendance deductions in one report
- **Accounting-Ready**: pull reports grouped by employee group for direct Journal Entry (no manual splitting)

**Data Integration:**
- Single DB; approvals + late records auto-flow into payslip + monthly summary

---

## 2. Schema diff — requirement vs v2

| Requirement field | v2 design | Verdict |
|---|---|---|
| `Employees.EmployeeID` PK | `Employee.id` (uuid) | ✅ |
| `Employees.FullName` | `firstName` + `lastName` + optional `nickname` | ✅ richer |
| **`Employees.Department`** | `departmentId` FK + **`Department` model** (added v2) | ✅ |
| `Employees.StartDate` | `hiredAt` | ✅ |
| `Employees.BaseSalary` | `baseSalary` `@db.Decimal(12, 2)` | ✅ |
| `Employees.Role` (Admin/User) | `User.role` enum (Employee / Admin / Owner) | ✅ + Owner added (intentional expansion — see §4) |
| `CashAdvance.RequestID` PK | `CashAdvance.id` | ✅ |
| `CashAdvance.EmployeeID` FK | `CashAdvance.employeeId` | ✅ |
| `CashAdvance.Amount` | `amount` Decimal(12, 2) | ✅ |
| `CashAdvance.RequestDate` | `requestedAt` | ✅ |
| `CashAdvance.Status` | `status` enum | ✅ + Cancelled state added |
| `CashAdvance.AdminID` | `approvedById` | ✅ |
| `CashAdvance.ApprovalDate` | `approvedAt` | ✅ |
| `CashAdvance.ReceiptImageURL` | `receiptUrl` | ✅ |
| `CashAdvance.IsDeducted` | `isDeducted` + `deductedInPayrollId` for traceability | ✅ |
| `Attendance.AttendanceID` PK | `Attendance.id` | ✅ |
| `Attendance.EmployeeID` FK | `Attendance.employeeId` | ✅ |
| `Attendance.Date` | `date` `@db.Date` | ✅ |
| `Attendance.Type` (sick / personal / vacation / late / no-scan) | **split** into: `Attendance.type` (CheckIn / CheckOut / Absent / Late / EarlyLeave / OnLeave) + separate `LeaveRequest` + `LeaveType` tables | ✅ better normalization. The five "leave-ish" types in the requirement collapse into `Attendance.type=OnLeave` + a join to `LeaveRequest.leaveType` (which has its own seeded list). Documented in §3.4 architecture.md. |
| **`Attendance.Duration`** | `Attendance.durationMinutes Int?` (added v2) | ✅ |
| `Attendance.DeductionAmount` | `deductAmount` | ✅ |
| `Payroll.PayrollID` PK | `Payroll.id` | ✅ |
| `Payroll.EmployeeID` FK | `employeeId` | ✅ |
| `Payroll.MonthYear` | `month` (YYYY-MM string) | ✅ |
| `Payroll.Income_Base` | `incomeBase` | ✅ |
| `Payroll.Income_Other` | `incomeOther` | ✅ |
| `Payroll.Deduct_SocialSecurity` | `deductSso` | ✅ |
| `Payroll.Deduct_Advance` | `deductAdvance` | ✅ |
| `Payroll.Deduct_Attendance` | `deductAttendance` | ✅ |
| **`Payroll.Deduct_Debt`** | `deductDebt` + **`RecurringDeduction` table** (added v2) | ✅ |
| `Payroll.NetPay` | `netPay` | ✅ |

**Result:** Every field from the requirement is now in v2. The four originally-missing items — `Department` model, `AccountingGroup` model, `Payroll.Deduct_Debt`, `Attendance.Duration` — are all added.

---

## 3. Feature diff — requirement vs v2

| Requirement | v2 design | Verdict |
|---|---|---|
| Employee clock-in via mobile **or fingerprint scanner (already exists)** | Phase 1: LIFF GPS check-in is primary; Phase 3: Excel import from scanner as fallback per-branch | ✅ matches intent ("via mobile" = LINE; scanner kept) |
| **"ดูปฏิทินคนลาในทีม"** (employee sees team leave calendar) | Phase 1 W4: `/liff/calendar` — month view of own branch / assigned-branch leave (added v2) | ✅ |
| Employee submits leave for approval | Phase 1 W4: `/liff/leave/new` | ✅ |
| Employee views own payslip with deduction breakdown | Phase 2 W9: `/liff/payslip` + `/liff/payslip/[month]` | ✅ |
| Admin notified on new cash advance | Phase 1 W4: in-app bell via Supabase Realtime | ✅ |
| Admin approves cash advance **with receipt attachment** | Phase 1 W4: drawer with mandatory receipt upload before Approve | ✅ |
| **แยกพนักงาน 2 กลุ่ม เพื่อการลงบัญชี** | **`AccountingGroup` model** + `Employee.accountingGroupId` FK (added v2) | ✅ |
| Monthly summary table for admin | Phase 3 W11: `/admin/reports` + Owner dashboard | ✅ |
| **Accounting-Ready — pull reports grouped by group for Journal Entry** | Phase 3 W12: `exportPeakCsv(month, groupId?)` — splits CSV per AccountingGroup | ✅ |
| Auto data-flow (advance + attendance → payroll → monthly report) | Phase 2 W6: pure calc function reads from all three sources | ✅ |

**Result:** Every workflow from the requirement has an explicit phase + week home in the build plan.

---

## 4. Intentional expansions beyond requirement

These are additions made during v1 design and carried into v2. They are **not asked for** in `requirement.docx` but were judged valuable. Confirm with the customer before final scope lock.

| Expansion | Lives in | Justification | Customer should confirm? |
|---|---|---|---|
| **Owner role** (read-only KPI / calendar / payroll / audit) | Phase 1 stub + Phase 3 full | Implicit in "Admin & Accounting Interface" — the company owner usually wants visibility without edit rights | ✅ Yes — confirm 3-role model |
| **LINE LIFF as employee identity provider** | Phase 1 W2–W3 | Pivot decision (this conversation) | ✅ Confirmed in pivot |
| **Multi-branch with per-branch geofence** | Phase 1 W2 (Branch model) + W3 (server logic) | Customer proposal mentions multi-branch; geofence makes LINE check-in trustworthy | ✅ Confirm GPS works in each branch via site visit |
| **Multi-branch employee assignment** (`assignedBranchIds`) | Phase 1 W2 | Some staff rotate between branches | ✅ Confirm how many employees do this |
| **Selfie capture per check-in** (toggleable per branch) | Phase 1 W3 | Anti-cheat (prevents buddy clock-in) | ✅ Confirm cultural acceptance |
| **Disputed check-in inbox** | Phase 1 W3 | When GPS / selfie fails, admin reviews | ✅ Confirm SLA expectation |
| **AuditLog** | Cross-cutting | Good HR-system hygiene; supports Owner audit view | ⚠️ Not requested but low-friction; flag |
| **WorkSchedule model** | Phase 1 W1 | Required for late-detection algorithm | ✅ Confirm Tue-Sun 09:00–18:00 universal or per-branch |
| **`SalaryType` enum (Monthly/Daily/Hourly)** | Phase 1 W1 | Customer didn't say all employees are monthly; daily-wage installers + weekend helpers are common in this trade | ✅ **Critical** — confirm employee mix |
| **Probation / Active / Archived status** | Phase 1 W1 | Standard HR field | ✅ Confirm |
| **`Holidays` table with auto-Monday-substitution** | Phase 1 W5 | Tue-Sun + closed-Monday shop needs this logic | ✅ Confirm auto-substitution rule |
| **`RecurringDeduction` table** instead of just `Payroll.Deduct_Debt` field | Phase 2 W6 | Auto-stops when `monthsRemaining=0`; cleaner than a free-form field | ✅ Optional structure choice |

---

## 5. Things explicitly out of scope V1 (vs v1 plan)

These were in v1 but **removed in v2 pivot**. Document so the dev doesn't reintroduce them.

| Removed | Why |
|---|---|
| Phone + password Employee login | Replaced with LINE LIFF |
| SMS OTP (any path) | LINE handles employee identity; admin uses email+password without OTP |
| 2FA | Removed per pivot |
| ThaiBulkSMS provider account | No more SMS needed anywhere |
| `inviteUserByPhone` Supabase API dependency | Doesn't actually exist; replaced with single-use JWT + QR/link share |
| PDPA consent flows + retention crons + privacy policy page | Out of V1 scope per pivot. **Note:** customer still needs to address PDPA legally; they should consult a Thai labor lawyer for the employee privacy notice. This is documented in [maintenance.md](../v1/maintenance.md) but not in code. |
| Email notifications to employees | LINE only |
| In-app notification center for employees | LINE only |
| Resend (separate email provider) | Supabase Auth's built-in SMTP handles admin password reset; no separate provider needed in V1 |
| Custom LIFF-token verification per Server Action | Replaced by Supabase Custom OIDC Provider (`custom:line`) — Employee gets real Supabase session via `signInWithIdToken`; standard `requireRole()` works for all roles |

---

## 6. Open expansions deferred to V2

Not in `requirement.docx`, considered for v2 of the system (not v2 of this plan), explicitly out of V1:

- Tax PND.1 / PND.91 / 50 ทวิ withholding tax forms
- ส.ป.ส.1-10 SSO monthly filing
- Severance / termination pay calculation
- Multi-level RBAC (Branch Manager role) — landed in Phase 4 optional
- Native mobile app (iOS / Android) for stronger biometrics
- Face recognition / liveness — landed in Phase 4 optional
- Cross-tenant SaaS (currently single-tenant per Supabase project — [architecture.md §1](./architecture.md#1-locked-decisions) decision 2)

---

## 7. Verification checklist for customer signoff

Before the dev writes code, confirm with the customer:

- [ ] 3-role model: Employee + Admin + Owner (read-only). OK?
- [ ] LINE Login for Employees only; Admin/Owner use email+password. OK?
- [ ] No SMS, no 2FA. OK?
- [ ] LINE check-in/out is the primary attendance source in Phase 1. Excel from fingerprint scanner stays in Phase 3 as fallback. OK?
- [ ] Selfie default off; admin can opt-in per branch. OK?
- [ ] Multi-branch employee assignment supported. How many employees rotate?
- [ ] Tue–Sun 09:00–18:00 work schedule; Monday closed. Holiday-on-Monday → auto-substitute next Tuesday. OK?
- [ ] Late deduction ladder: provide exact rules.
- [ ] Force-checkout if no check-out by 23:00 BKK. OK?
- [ ] AccountingGroup seeded with "ค่าใช้จ่ายบริษัท" + "จ่ายแทน-รับคืน". Confirm names + PEAK chart-of-accounts codes.
- [ ] Salary types in use: monthly only? Daily? Hourly? Mix?
- [ ] PDPA legal notice: customer engages own lawyer; system provides technical means only.
- [ ] LINE OA verification submitted (2–4 wk wait — start day 1).
