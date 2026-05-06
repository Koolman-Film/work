# V1 Architecture

ครอบคลุม: project structure, auth flows, data flow, server actions, jobs, RLS, schema final

---

## 1. System diagram

```
                  Users (Tue–Sun 9–18 BKK)
                          │
                          ▼
              ┌────────────────────────┐
              │   Vercel Edge (CDN)    │  ← Singapore POP
              └──────────┬─────────────┘
                         │
                ┌────────▼────────────┐
                │   Vercel Pro        │
                │   Next.js 16 app    │
                │   - Server Actions  │
                │   - Vercel Cron     │
                │   - Edge / Node fns │
                └────────┬────────────┘
                         │
        ┌────────────────┼─────────────────┬──────────────┐
        ▼                ▼                 ▼              ▼
┌──────────────┐  ┌──────────────┐  ┌──────────┐  ┌──────────┐
│  Supabase    │  │  Inngest     │  │  Resend  │  │  Sentry  │
│  (SG region) │  │  (jobs)      │  │  (email) │  │  (errors)│
│  - Postgres  │  │              │  │          │  │          │
│  - Storage   │  │              │  │          │  │          │
│  - Auth      │  │              │  │          │  │          │
│  - Realtime  │  │              │  │          │  │          │
└──────────────┘  └──────────────┘  └──────────┘  └──────────┘

External:
  - PEAK Account ← CSV export download (manual upload by Admin)
```

---

## 2. Project folder structure

```
koolman-hr/
├── .env.local                  # local secrets (gitignored)
├── .env.example                # template
├── .github/
│   └── workflows/
│       ├── ci.yml              # test + lint on PR
│       └── deploy-migrations.yml  # prisma migrate deploy on main
├── biome.json                  # Biome config
├── docker-compose.yml          # local Postgres for dev
├── next.config.ts
├── package.json
├── playwright.config.ts
├── pnpm-lock.yaml
├── postcss.config.mjs
├── prisma/
│   ├── schema.prisma           # source of truth
│   ├── migrations/             # generated SQL
│   └── seed.ts                 # seed depts, holidays, leave types, payroll config
├── public/
│   ├── favicon.ico
│   ├── logo.svg
│   └── fonts/                  # local Thai fonts (Sarabun, IBM Plex Sans Thai)
├── src/
│   ├── app/                    # Next.js App Router
│   │   ├── (auth)/             # public routes (no auth required)
│   │   │   ├── login/page.tsx
│   │   │   ├── verify-otp/page.tsx
│   │   │   ├── reset-password/page.tsx
│   │   │   └── layout.tsx
│   │   ├── (employee)/         # role: User
│   │   │   ├── dashboard/page.tsx
│   │   │   ├── attendance/page.tsx       # ดูเวลาของฉัน
│   │   │   ├── leave/
│   │   │   │   ├── page.tsx              # list + calendar tab
│   │   │   │   ├── new/page.tsx          # create form
│   │   │   │   └── [id]/page.tsx         # detail
│   │   │   ├── advance/
│   │   │   │   ├── page.tsx
│   │   │   │   ├── new/page.tsx
│   │   │   │   └── [id]/page.tsx
│   │   │   ├── payslip/
│   │   │   │   ├── page.tsx              # list
│   │   │   │   └── [month]/page.tsx      # detail + PDF download
│   │   │   ├── profile/page.tsx
│   │   │   └── layout.tsx                # bottom-nav mobile-first
│   │   ├── (admin)/            # role: Admin
│   │   │   ├── dashboard/page.tsx
│   │   │   ├── employees/
│   │   │   │   ├── page.tsx              # table list
│   │   │   │   ├── new/page.tsx          # create
│   │   │   │   ├── [id]/page.tsx         # detail + edit
│   │   │   │   └── import/page.tsx       # bulk CSV
│   │   │   ├── leave/page.tsx            # approval inbox
│   │   │   ├── advance/
│   │   │   │   ├── page.tsx              # approval inbox
│   │   │   │   └── [id]/page.tsx         # detail + receipt upload
│   │   │   ├── attendance/
│   │   │   │   ├── page.tsx              # records list + filter
│   │   │   │   ├── manual/page.tsx       # manual entry form
│   │   │   │   ├── upload/page.tsx       # Excel upload
│   │   │   │   └── [id]/override/page.tsx  # override ยอดหัก
│   │   │   ├── payroll/
│   │   │   │   ├── page.tsx              # months list
│   │   │   │   ├── [month]/page.tsx      # detail (review + override + publish)
│   │   │   │   └── [month]/[empId]/page.tsx  # per-employee review
│   │   │   ├── accounting/page.tsx       # PEAK export
│   │   │   ├── audit/page.tsx
│   │   │   ├── settings/
│   │   │   │   ├── page.tsx              # general
│   │   │   │   ├── branches/page.tsx
│   │   │   │   ├── departments/page.tsx
│   │   │   │   ├── groups/page.tsx       # AccountingGroups
│   │   │   │   ├── leave-types/page.tsx
│   │   │   │   ├── holidays/page.tsx
│   │   │   │   └── payroll-config/page.tsx
│   │   │   └── layout.tsx                # sidebar desktop-first
│   │   ├── (owner)/            # role: Owner
│   │   │   ├── dashboard/page.tsx
│   │   │   ├── calendar/page.tsx         # full attendance calendar
│   │   │   ├── payroll/page.tsx          # read-only slip browser
│   │   │   ├── audit/page.tsx
│   │   │   └── layout.tsx                # sidebar (lighter than admin)
│   │   ├── api/
│   │   │   ├── inngest/route.ts          # Inngest endpoint
│   │   │   ├── webhooks/
│   │   │   │   └── line/route.ts         # V1.5 — placeholder
│   │   │   ├── cron/
│   │   │   │   └── monthly-payroll/route.ts  # Vercel cron trigger
│   │   │   └── auth/
│   │   │       └── callback/route.ts     # Supabase auth callback
│   │   ├── error.tsx                     # global error boundary
│   │   ├── not-found.tsx
│   │   ├── layout.tsx                    # root layout (fonts, providers)
│   │   └── globals.css                   # Tailwind 4 + CSS theme
│   ├── components/
│   │   ├── ui/                           # shadcn/ui primitives (button, input, dialog, ฯลฯ)
│   │   ├── layout/
│   │   │   ├── employee-bottom-nav.tsx
│   │   │   ├── admin-sidebar.tsx
│   │   │   ├── owner-sidebar.tsx
│   │   │   └── topbar.tsx                # notification bell + profile
│   │   ├── features/
│   │   │   ├── employees/
│   │   │   │   ├── employee-form.tsx
│   │   │   │   ├── employee-table.tsx
│   │   │   │   └── bulk-import-dialog.tsx
│   │   │   ├── leave/
│   │   │   │   ├── leave-form.tsx
│   │   │   │   ├── leave-calendar.tsx
│   │   │   │   └── approval-inbox.tsx
│   │   │   ├── attendance/
│   │   │   │   ├── excel-uploader.tsx
│   │   │   │   ├── manual-entry-form.tsx
│   │   │   │   └── override-dialog.tsx
│   │   │   ├── payroll/
│   │   │   │   ├── payroll-runner.tsx
│   │   │   │   ├── slip-viewer.tsx
│   │   │   │   └── publish-dialog.tsx
│   │   │   ├── advance/
│   │   │   │   ├── advance-form.tsx
│   │   │   │   └── approval-inbox.tsx
│   │   │   ├── notifications/
│   │   │   │   ├── notification-bell.tsx
│   │   │   │   └── notification-drawer.tsx
│   │   │   └── audit/
│   │   │       └── audit-table.tsx
│   │   └── shared/
│   │       ├── data-table.tsx            # generic TanStack Table wrapper
│   │       ├── empty-state.tsx
│   │       ├── error-state.tsx
│   │       ├── loading-spinner.tsx
│   │       ├── thai-date.tsx             # format date in Thai locale
│   │       └── money.tsx                 # format THB
│   ├── lib/
│   │   ├── supabase/
│   │   │   ├── server.ts                 # server-side client
│   │   │   ├── browser.ts                # browser client
│   │   │   ├── middleware.ts             # cookie refresh
│   │   │   └── admin.ts                  # service-role client (admin tasks)
│   │   ├── prisma.ts                     # Prisma singleton
│   │   ├── auth.ts                       # session helpers, role check
│   │   ├── audit.ts                      # logAudit() helper
│   │   ├── email/
│   │   │   ├── client.ts                 # Resend instance
│   │   │   ├── templates/                # react-email .tsx files
│   │   │   │   ├── welcome.tsx
│   │   │   │   ├── otp.tsx
│   │   │   │   ├── leave-submitted.tsx
│   │   │   │   ├── leave-approved.tsx
│   │   │   │   ├── advance-approved.tsx
│   │   │   │   ├── payslip-published.tsx
│   │   │   │   └── override-alert.tsx
│   │   │   └── send.ts                   # sendEmail() helper
│   │   ├── pdf/
│   │   │   └── slip.tsx                  # @react-pdf/renderer slip template
│   │   ├── inngest/
│   │   │   ├── client.ts
│   │   │   └── functions/
│   │   │       ├── payroll-generate.ts
│   │   │       ├── email-send.ts
│   │   │       ├── attendance-parse-excel.ts
│   │   │       └── notify-event.ts
│   │   ├── locale/
│   │   │   └── th.ts                     # Thai date/number formatters
│   │   └── utils.ts                      # cn(), formatters
│   ├── server/
│   │   ├── actions/                      # Server Actions per domain
│   │   │   ├── auth.ts
│   │   │   ├── employees.ts
│   │   │   ├── leave.ts
│   │   │   ├── advance.ts
│   │   │   ├── attendance.ts
│   │   │   ├── payroll.ts
│   │   │   ├── accounting.ts
│   │   │   ├── audit.ts
│   │   │   └── config.ts
│   │   ├── services/                     # business logic
│   │   │   ├── payroll-calc.ts           # SS, deductions, pro-rata
│   │   │   ├── attendance-deduct.ts      # auto-calc formula
│   │   │   ├── excel-parser.ts           # parse scanner Excel
│   │   │   └── peak-export.ts            # PEAK CSV format
│   │   └── repositories/                 # Prisma queries grouped
│   │       ├── employees.ts
│   │       ├── attendance.ts
│   │       ├── payroll.ts
│   │       └── ...
│   └── types/
│       ├── database.ts                   # Prisma types re-export
│       └── enums.ts                      # shared enums
├── tests/
│   ├── unit/                             # Vitest
│   │   ├── payroll-calc.test.ts
│   │   ├── excel-parser.test.ts
│   │   └── ...
│   └── e2e/                              # Playwright
│       ├── auth.spec.ts
│       ├── employee-flow.spec.ts
│       ├── admin-flow.spec.ts
│       └── owner-flow.spec.ts
├── tsconfig.json
└── README.md
```

---

## 3. Data flow

### Authentication
```
User → /login → submit phone/password
     → Server Action `signIn` → Supabase Auth
     → if 2FA: send SMS OTP → /verify-otp (reset only)
     → submit code → verify → set cookie session
     → middleware refreshes JWT → redirect by role
        - Employee → /(employee)/dashboard
        - Admin    → /(admin)/dashboard
        - Owner    → /(owner)/dashboard
```

### Leave request flow
```
Employee → /leave/new → fill form → Server Action `createLeaveRequest`
        → DB insert + audit log
        → Inngest event `leave.submitted` fired
        → Inngest handler:
            - send email to Admin (via Resend)
            - in-app notification record for Admin
        → Admin → /admin/leave inbox → approve
        → Server Action `approveLeaveRequest`
        → DB update Status, create Attendance record auto
        → Inngest event `leave.approved`
        → email + notif to Employee
```

### Cash advance flow
```
Employee → /advance/new → submit → Server Action `createAdvance`
        → notify Admin (Inngest)
Admin   → /admin/advance/[id] → approve + upload receipt to S3 (Supabase Storage)
        → Server Action `approveAdvance(id, receiptUrl)`
        → DB update + email Employee
        → IsDeducted=false until next payroll
        → On payroll generate: include in Deduct_Advance, set IsDeducted=true
```

### Payroll flow
```
Admin → /admin/payroll/new (or via Vercel Cron monthly)
     → Server Action `triggerPayroll(month)`
     → Inngest fan-out: 1 job per employee
        - calc Income_Base / Income_Other
        - calc Deduct_SocialSecurity (5% capped 750)
        - sum Deduct_Advance from approved CashAdvance
        - sum Deduct_Attendance from Attendance.DeductionAmount
        - calc NetPay
        - insert Payroll row (Status: Draft)
     → Admin reviews each → override if needed (audit log)
     → Click Publish → Status: Published, Lock
        → Inngest send slip emails to all employees
        → CashAdvance.IsDeducted = true
```

### Attendance Excel upload flow
```
Admin → /admin/attendance/upload → drop xlsx
     → Server Action `parseAttendanceExcel(fileUpload)`
     → upload to Supabase Storage (temp) → trigger Inngest job
     → Inngest parses Excel → validate per row → preview
     → Admin confirms → Server Action `commitAttendance(parsedRows)`
     → Bulk insert + auto-calc DeductionAmount per row
     → audit log
```

---

## 4. Authentication detail

### Login flow (V1)
1. **Login page** — phone + password
2. Server Action calls `supabase.auth.signInWithPassword({ phone, password })`
3. If success → check `profile.requires_2fa` (always true V1) → redirect /verify-otp
4. **/verify-otp**: backend triggered `supabase.auth.signInWithOtp({ phone })` → 6-digit SMS code
5. User enters code → `supabase.auth.verifyOtp({ phone, token: code, type: 'sms' })`
6. Session cookie set → middleware redirect by role

### Admin invite flow
1. Admin creates Employee record via `/admin/employees/new`
2. Server Action calls `supabase.auth.admin.inviteUserByPhone(phone, { redirectTo: '/welcome' })`
3. Supabase sends invite SMS with magic link → Employee clicks
4. Lands on `/welcome` → set password → redirect login
5. After first login → flagged `phone_verified=true`

### Reset password (V1: SMS OTP, not email)
1. `/login` → "ลืมรหัสผ่าน" → submit phone
2. Server: issue 6-digit OTP, store hashed in Redis/DB w/ 5min TTL, send via Thai SMS provider
3. `/reset-password` step 2: user enters OTP + new password
4. Server: verify OTP → `supabase.auth.admin.updateUserById(authUserId, { password })`
5. Auto-login → redirect /dashboard

### Session refresh
- Middleware (`src/middleware.ts`) calls `supabase.auth.getUser()` on every request
- Refresh JWT cookie if near expiry (Supabase SSR handles auto)

### Role check (middleware + page level)

```ts
// src/lib/auth.ts
export async function requireRole(role: 'Owner' | 'Admin' | 'User') {
  const supabase = createClient(); // server client
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const employee = await prisma.employees.findUnique({
    where: { auth_user_id: user.id },
    select: { Role: true, EmployeeID: true, FullName: true }
  });
  if (!employee) redirect('/login');
  if (role === 'Admin' && employee.Role === 'User') notFound();
  if (role === 'Owner' && employee.Role !== 'Owner') notFound();
  // Admin can access Employee pages, Owner can access all read pages
  return employee;
}
```

---

## 4a. User roles + permissions

ระบบมี 3 บทบาทหลัก. RLS section §5 บังคับใช้ที่ DB layer.

### Owner (เจ้าของ)
- ดูปฏิทินสรุปการขาด/ลา/มาสายทั้งบริษัท (read-only)
- **ดูข้อมูลเงินเดือนของพนักงานได้** (q12 confirmed)
- **Override Admin decision ได้** — แต่ต้องเป็น **explicit action** (V2 — ไม่ทำใน V1, ใช้ Audit log review แทน)
- ไม่อนุมัติคำขอประจำวัน

### Admin (HR / Accountant) — multi-level RBAC
- **Super Admin** — full access + จัดการ Admin คนอื่น + ตั้งค่าระบบ
- **HR Admin** — จัดการพนักงาน, อนุมัติลา, OT
- **Accounting Admin** — อนุมัติเบิก, จัดกลุ่ม, export PEAK
- ทุกระดับ: บันทึก ขาด/ลา/มาสาย + manual override (พร้อม note + audit log)

### Employee (พนักงาน)
- ลงเวลา (manual / Excel — V1) / มือถือ (V1.5) / สแกนนิ้ว (V1.5)
- ส่งคำขอลา + ดูปฏิทินทีม
- ส่งคำขอเบิกเงินล่วงหน้า
- ดูสลิปเงินเดือนของตนเอง
- ไม่เห็นข้อมูลพนักงานคนอื่น (ยกเว้นปฏิทินทีม)

### Manager (รองรับ V2 — ไม่ใช้ V1)
**Approval flow configurable:**
- ถ้ามี Manager → Employee → Manager → (Admin ถ้าจำเป็น)
- V1 default: Employee → Admin ตรงๆ

### Permission matrix

| Action | Owner | Admin | Employee |
|---|:-:|:-:|:-:|
| ดูปฏิทินขาด/ลา/สาย ทั้งบริษัท | ✅ | ✅ | ❌ |
| ดูข้อมูลเงินเดือนทุกคน | ✅ | ✅ (Accounting) | ❌ |
| ดูข้อมูลตนเอง | ✅ | ✅ | ✅ |
| ส่งคำขอลา / เบิก / OT | — | — | ✅ |
| อนุมัติคำขอ | ❌ (override V2) | ✅ | ❌ |
| แนบสลิปโอนเงิน | ❌ | ✅ | ❌ |
| ออกรายงานเดือน | ✅ (read) | ✅ | ❌ |
| Export PEAK | ❌ | ✅ (Accounting) | ❌ |
| จัดการพนักงาน | ❌ | ✅ (HR) | ❌ |
| Manual override ยอดหัก | ❌ | ✅ | ❌ |
| จัดการ AccountingGroups | ❌ | ✅ (Accounting) | ❌ |
| จัดการ Admin คนอื่น | ❌ | ✅ (Super) | ❌ |
| ดู Audit Log | ✅ | ✅ (Super) | ❌ |

Implementation: `Employees.role` enum + RLS check JWT claim. ดู §5 RLS policies.

---

## 5. RLS policies (Supabase Postgres)

**Strategy:** RLS at DB layer = defense-in-depth. App layer also enforces, but DB rejects unauthorized access if app layer ever has bug.

```sql
-- Employees table
alter table public.employees enable row level security;

-- Employee can read own record
create policy "employees_self_read"
  on public.employees for select
  using (auth_user_id = auth.uid());

-- Admin / Owner can read all
create policy "employees_admin_owner_read"
  on public.employees for select
  using (
    exists (
      select 1 from public.employees e
      where e.auth_user_id = auth.uid()
        and e.role in ('Admin', 'Owner')
    )
  );

-- Only Admin can insert/update
create policy "employees_admin_write"
  on public.employees for insert with check (
    exists (
      select 1 from public.employees e
      where e.auth_user_id = auth.uid()
        and e.role = 'Admin'
    )
  );
create policy "employees_admin_update"
  on public.employees for update using (
    exists (
      select 1 from public.employees e
      where e.auth_user_id = auth.uid()
        and e.role = 'Admin'
    )
  );

-- (similar policies for Attendance, Payroll, CashAdvance, LeaveRequest)

-- Audit log — no one can modify
create policy "audit_no_update"
  on public.audit_log for update using (false);
create policy "audit_no_delete"
  on public.audit_log for delete using (false);

-- Owner + Admin can read audit
create policy "audit_admin_owner_read"
  on public.audit_log for select using (
    exists (
      select 1 from public.employees e
      where e.auth_user_id = auth.uid()
        and e.role in ('Admin', 'Owner')
    )
  );
```

> **Note:** Use Prisma + Supabase ที่เปิด RLS ต้องระวัง — query ทาง Prisma จะวิ่งใน role default `postgres` (bypass RLS). ใช้ Supabase JS client หรือ pgConnection พิเศษเพื่อ enforce RLS. **Strategy V1:** ใช้ Prisma สำหรับ admin operations (bypass RLS = trusted server code), ใช้ Supabase JS สำหรับ user-context queries

---

## 6. Server Actions inventory

```
src/server/actions/auth.ts
  signIn(phone, password)
  verifyResetOtp(phone, code)
  signOut()
  resetPasswordRequest(phone)
  resetPassword(code, newPassword)
  inviteEmployee(employeeId)

src/server/actions/employees.ts
  createEmployee(data)
  updateEmployee(id, data)
  archiveEmployee(id)
  rehireEmployee(id)
  bulkImportEmployees(csvFile)
  listEmployees(filter)
  getEmployee(id)

src/server/actions/branches.ts
  createBranch / updateBranch / archiveBranch / listBranches

src/server/actions/departments.ts
  createDept / updateDept / archiveDept / listDepts

src/server/actions/accountingGroups.ts
  createGroup / updateGroup / archiveGroup / listGroups

src/server/actions/leave.ts
  createLeaveRequest(data)
  approveLeaveRequest(id, note)
  rejectLeaveRequest(id, reason)
  cancelLeaveRequest(id)
  listLeaveRequests(filter)
  getLeaveCalendar(month, scope: 'team' | 'company')

src/server/actions/advance.ts
  createAdvance(data)
  approveAdvance(id, receiptFile)
  rejectAdvance(id, reason)
  listAdvances(filter)

src/server/actions/attendance.ts
  createAttendance(data)         // manual entry
  updateAttendance(id, data)
  deleteAttendance(id)
  overrideDeduction(id, amount, note)
  uploadExcel(file)              // returns parsed preview
  commitExcelImport(rows)
  listAttendance(filter)

src/server/actions/payroll.ts
  triggerPayroll(month)          // kicks off Inngest
  reviewPayroll(month)           // returns all employee slips
  overrideField(slipId, field, value, note)
  publishPayroll(month)
  unlockSlip(slipId, reason)     // creates revision
  downloadSlipPdf(slipId)
  listPayrolls(filter)

src/server/actions/accounting.ts
  exportPeakCsv(month, groupId?)
  exportSummaryExcel(month)

src/server/actions/audit.ts
  listAudit(filter)              // by entity type, actor, date range

src/server/actions/config.ts
  getConfig(key)
  updateConfig(key, value)
  listHolidays / addHoliday / updateHoliday / deleteHoliday
  listLeaveTypes / addLeaveType / updateLeaveType
```

---

## 7. Background jobs (Inngest)

### Payroll generation
```ts
inngest.createFunction(
  { id: 'payroll-generate', name: 'Generate monthly payroll' },
  { event: 'payroll/generate.requested' },
  async ({ event, step }) => {
    const { month } = event.data;
    const employees = await step.run('fetch-employees', () => listActiveEmployees());

    // fan-out per employee
    await Promise.all(employees.map(emp =>
      step.run(`calc-${emp.EmployeeID}`, async () => {
        const slip = await calcPayrollForEmployee(emp, month);
        await prisma.payroll.create({ data: slip });
      })
    ));

    // notify admin done
    await step.sendEvent('payroll-ready', {
      name: 'payroll/generate.completed',
      data: { month, count: employees.length }
    });
  }
);
```

### Email send (with retry)
```ts
inngest.createFunction(
  { id: 'email-send', name: 'Send transactional email' },
  { event: 'email/send.requested' },
  async ({ event, step }) => {
    await step.run('send', async () => {
      await resend.emails.send({
        from: 'Koolman HR <noreply@finnixfilm.com>',
        to: event.data.to,
        subject: event.data.subject,
        react: event.data.template
      });
    });
  }
);
```

### Notify event (fan-out: in-app + email + LINE V1.5)
```ts
inngest.createFunction(
  { id: 'notify-event', name: 'Multi-channel notification' },
  { event: 'notify/event.fired' },
  async ({ event, step }) => {
    const { recipientId, type, payload } = event.data;
    const prefs = await step.run('get-prefs', () => getNotifPrefs(recipientId, type));

    if (prefs.inApp) await step.run('save-inapp', () => saveInAppNotif(recipientId, type, payload));
    if (prefs.email) await step.sendEvent('email', { name: 'email/send.requested', data: ... });
    // V1.5: if (prefs.line) → LINE push
  }
);
```

### Excel parse (async)
```ts
inngest.createFunction(
  { id: 'attendance-parse', name: 'Parse attendance Excel' },
  { event: 'attendance/excel.uploaded' },
  async ({ event, step }) => {
    const { fileUrl, jobId } = event.data;
    const rows = await step.run('parse', () => parseExcelFromStorage(fileUrl));
    await step.run('save-preview', () => saveImportPreview(jobId, rows));
    // notify admin to review
  }
);
```

### Vercel Cron (scheduled)
```ts
// src/app/api/cron/monthly-payroll/route.ts
export async function GET(req: Request) {
  // verify Vercel cron secret
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) return new Response('Unauthorized', { status: 401 });

  const today = new Date();
  if (today.getDate() !== 25) return new Response('Not run day'); // 25 = pay day

  // trigger payroll generation
  await inngest.send({
    name: 'payroll/generate.requested',
    data: { month: format(today, 'yyyy-MM') }
  });
  return Response.json({ ok: true });
}

// vercel.json
{
  "crons": [
    { "path": "/api/cron/monthly-payroll", "schedule": "0 1 * * *" }  // daily 1am
  ]
}
```

---

## 8. Final V1 schema (Prisma — short form)

V1 schema (full):

- `Employees` (with `auth_user_id` FK to `auth.users`)
- `Branches`
- `Departments`
- `AccountingGroups`
- `Holidays`
- `LeaveTypes` (seed only — no quota tracking V1)
- `LeaveRequest`
- `Attendance` (with override fields)
- `CashAdvance` (one-time only V1)
- `Payroll` (with lock + revision)
- `AuditLog`
- `PayrollConfig` (key-value system config)
- `Notification` (in-app)
- `NotificationPreference` (per user)

**ตาราง defer V2:** `AdminRoles`, `OvertimeRequest`, `LeaveQuota`

---

## 9. Error handling strategy

```
Server Action:
  try {
    // logic
    revalidatePath(...)
    return { ok: true, data }
  } catch (err) {
    Sentry.captureException(err)
    if (err instanceof ZodError)    return { ok: false, errors: err.flatten() }
    if (err instanceof PrismaError) return { ok: false, message: 'DB error' }
    return { ok: false, message: 'Unknown error' }
  }

Client:
  const result = await action(...)
  if (!result.ok) toast.error(result.message ?? 'เกิดข้อผิดพลาด')
```

`error.tsx` boundary catches uncaught render errors. `not-found.tsx` for 404. `unauthorized.tsx` for role mismatch.

---

## 10. Logging

```ts
// src/lib/log.ts
import pino from 'pino';
export const log = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  transport: process.env.NODE_ENV === 'development'
    ? { target: 'pino-pretty' }
    : undefined,
});
```

Server Actions log key events:
```ts
log.info({ action: 'createLeaveRequest', employeeId, leaveType }, 'leave request submitted');
```

Sentry breadcrumbs auto-attach Pino logs.

---

## 11. Observability

| Tool | Watches | Alert when |
|---|---|---|
| Sentry | Errors + perf | Error rate > 1%/min |
| Vercel Analytics | Page perf | Core Web Vitals red |
| Supabase Dashboard | DB perf | Slow query > 1s |
| Inngest Dashboard | Job runs | Failure rate > 5% |
| Vercel Logs | Application logs | (manual) |

---

## 12. Security checklist

- [x] HTTPS only (Vercel auto)
- [x] Auth.js OTP enforced (Supabase 2FA)
- [x] RLS at DB layer (defense in depth)
- [x] CSRF protection (Server Actions auto)
- [x] Rate limiting (Supabase Auth built-in)
- [x] Secrets in Vercel env vars + Supabase vault (no plain `.env` in repo)
- [x] CORS lock to own domain
- [x] No client-side admin operations (Server Actions only)
- [x] Input validation Zod (every Server Action)
- [x] SQL injection: Prisma parameterized queries
- [x] XSS: React auto-escapes + DOMPurify if rendering user HTML (none in V1)
- [x] Audit log append-only (RLS enforces)
- [x] File upload: type/size whitelist (Supabase Storage policies)
- [x] Pre-signed URL TTL ≤ 15 min for receipt download
