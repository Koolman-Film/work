# Koolman HR v2 — Architecture

**Status:** Active engineering reference. Locked decisions; defer revisions to a v3 doc.
**Updated:** 2026-05-26

---

## 0. Audience & purpose

For the dev who is about to write `src/`. Reads top-to-bottom. Each section is a decision the dev should not re-litigate while coding — those debates happened in v1 review and were resolved here.

For customer-facing scope and pricing, see [../proposal.md](../proposal.md).

---

## 1. Locked decisions

| # | Decision | Choice | Rationale |
|---|---|---|---|
| 1 | **RLS strategy with Prisma** | **Strategy A — Prisma bypasses RLS by design.** Authz happens in Server Action `requireRole()` middleware. RLS policies are deployed defensively (owner-of-row read-only) as a backstop against service-key compromise or future Supabase JS use, but the app does not depend on them. | Solo dev. Honest about what enforces what. Don't market RLS as "defense in depth" when Prisma bypasses it on every call. |
| 2 | **Tenancy model** | **Single-tenant per Supabase project.** Koolman = one Supabase project. Future SaaS customers = one new Supabase project each. No `tenant_id` column anywhere. | Cleanest isolation. Easy churn (delete the project). Multi-tenant pivot if ever needed = separate ~40 hr migration. |
| 3 | **Migration ordering** | **Expand-contract.** Every schema change ships as: PR1 add column / table → PR2 use it → PR3 drop the old. Prisma migrations run before Vercel deploy in CI; Supabase migrations contain only RLS / triggers / functions (never `create table` / `alter table add column`). | Avoids the Prisma-vs-Vercel-auto-deploy race entirely. |
| 4 | **Idempotency** | **Inngest event IDs + per-event dedup tables** (e.g., `payroll_email_sent (payrollId, employeeId) UNIQUE`). All `step.run` bodies must be safely re-runnable. | Inngest retries on Vercel timeouts. Button-mash and cron drift are real. |
| 5 | **Money type** | `@db.Decimal(12, 2)` for amounts, `@db.Decimal(5, 4)` for rates. **Arithmetic in `decimal.js`**, never JS `number`. `SUM(amount)::numeric` in Postgres for monthly totals. | Cent-rounding accumulates across 100 emp × 12 months. |
| 6 | **Timezone** | UTC in storage (`timestamptz`); `@db.Date` for calendar dates (Holidays, LeaveRequest, Attendance.date). All display via `date-fns-tz` Asia/Bangkok. Cron expressions commented with BKK equivalent. | Off-by-one-day is the #1 calendar bug in Thai apps. |
| 7 | **FK + cascade rules** | All references to `Employee` → `onDelete: Restrict`. Soft-delete via `archivedAt`. `AuditLog.actorId` → `SetNull`. Hard-delete only for Notifications (90d purge cron) and 7d Attendance correction window. | See §3 schema for the full table. |
| 8 | **Bleeding-edge smoke test** | **W0 1-day spike** verifies Next.js 16 + React 19 + Tailwind 4 + Prisma 6 + Supabase SSR + `@react-pdf/renderer` + `@line/liff` v2.27 all integrate cleanly. Pin `~16.x` (not `^16.x`) until W4. | Cheap insurance. The matrix is bleeding-edge enough that one exotic incompat can lose a week. |
| 9 | **LINE auth via Supabase Custom OIDC Provider** | Register LINE Login channel as a Supabase Auth Custom OIDC Provider with identifier `custom:line`, issuer `https://access.line.me`, `email_optional: true`. Employee sign-in: LIFF calls `liff.getIDToken()` → client calls `supabase.auth.signInWithIdToken({ provider: 'custom:line', token, nonce })` → Supabase creates / signs into `auth.users` and sets a session cookie. | Unifies sessions across Employee/Admin/Owner. Real `auth.uid()` for every Server Action. Drops the LIFF-token-verify-per-request pattern. Lets Supabase Realtime subscriptions enforce RLS (currently the live admin board would leak otherwise). |

---

## 2. Tech stack (final, post-pivot)

| Layer | Choice | Notes |
|---|---|---|
| Framework | Next.js 16 + React 19 + TypeScript 5.9 | App Router, Server Actions default |
| Styling | Tailwind 4 + shadcn/ui | CSS-first config (`@theme` in CSS) |
| ORM | Prisma 6 | Migration source-of-truth; bypasses RLS by design |
| DB / Storage / Realtime | Supabase Pro (Singapore region) | Postgres 15 |
| **Employee auth** | **LINE Login channel + LIFF SDK v2.27 + Supabase Custom OIDC Provider (`custom:line`)** | LIFF returns OIDC ID token → `signInWithIdToken` → real Supabase session for the employee. Falls back to LINE Login OAuth on web. |
| **Admin / Owner auth** | **Supabase Auth — email + password** | No OTP, no 2FA, no email verification |
| **Employee notifications** | **LINE Messaging API push** (Light plan) | Flex Messages |
| Admin / Owner notifications | In-app bell via Supabase Realtime | No email by default |
| Email (password reset) | **Supabase Auth built-in SMTP** | Default sender; no separate provider. Resend optional later if branded emails wanted. |
| Background jobs | Inngest | Free tier 50K runs/mo (V1 uses ~1.3K) |
| Scheduled jobs | Vercel Cron → fires Inngest events | Cron drift ±1 hr acceptable for our use |
| PDF generation | `@react-pdf/renderer` v4 | IBM Plex Sans Thai bundled in `public/fonts/` |
| Hosting | Vercel Pro | Function timeout 60s; mitigate via Inngest fan-out |
| Image rendering | **`next/image` + Vercel Image Optimization** | Auto WebP/AVIF, lazy load, signed-URL `loader` for Supabase Storage |
| Web Vitals | **Vercel Speed Insights** | LCP/INP/CLS per page; especially important for LIFF widget |
| Page-view analytics | **Vercel Analytics** | Privacy-friendly, no cookies |
| Errors | Sentry | Replay OFF, traces 10%, errors 100% |
| Logs | Pino with PII scrubber → Vercel Logs | Mask `password`, `otp`, `nationalId`, `bankAccount`, `phone` |
| Tests | Vitest + Playwright | Supabase CLI local stack for integration |
| Lint / format | Biome 2 | Ignore `src/generated/`, `prisma/migrations/` |
| Date | date-fns + date-fns-tz + `th` locale | |
| i18n | next-intl from W1 | `th.json` only; `en.json` stub kept current |

**Dropped from v1:** ThaiBulkSMS, SMS OTP, 2FA, PDPA retention crons, **Resend** (Supabase Auth's SMTP is sufficient for the only V1 use case — admin password reset).

---

## 3. Data model

### 3.1 Identity & roles

```prisma
model User {
  id          String   @id @default(uuid())
  authUserId  String   @unique          // FK to Supabase auth.users (uuid)
  email       String?  @unique          // Admin / Owner only
  lineUserId  String?  @unique          // Employee only — set after LIFF link
  role        Role
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  archivedAt  DateTime?
  employee    Employee?
}

enum Role { Employee Admin Owner }
```

### 3.2 Organization

```prisma
model Department {                       // requirement.docx §1 "Department"
  id          String   @id @default(uuid())
  name        String   @unique           // "ติดฟิล์ม", "บัญชี", "บริหาร"
  description String?
  archivedAt  DateTime?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  employees   Employee[]
}

model AccountingGroup {                  // requirement.docx §2 "แยกพนักงาน 2 กลุ่ม"
  id          String   @id @default(uuid())
  name        String   @unique           // "ค่าใช้จ่ายบริษัท", "จ่ายแทน-รับคืน"
  peakCode    String?  @unique           // PEAK chart-of-accounts code for grouped export
  description String?
  archivedAt  DateTime?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  employees   Employee[]
}

model Branch {
  id            String  @id @default(uuid())
  name          String  @unique
  address       String?
  latitude      Decimal? @db.Decimal(10, 7)   // null = no geofence enforcement
  longitude     Decimal? @db.Decimal(10, 7)
  radiusMeters  Int     @default(150)        // 100–500m typical
  requireSelfie Boolean @default(false)
  attendanceSource AttSource @default(Liff)  // Liff | Excel | Both | Manual
  archivedAt    DateTime?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  employees     Employee[] @relation("HomeBranch")
}

enum AttSource { Liff Excel Both Manual }

model WorkSchedule {
  id               String   @id @default(uuid())
  name             String   // "Tue-Sun 9-18"
  startTime        String   // "09:00"
  endTime          String   // "18:00"
  workDays         Int[]    // [2,3,4,5,6,0]  ISO 0=Sun..6=Sat; Mon=1 closed for Koolman
  lateToleranceMin Int      @default(15)
  archivedAt       DateTime?
  employees        Employee[]
}
```

### 3.3 Employee

```prisma
model Employee {
  id                String   @id @default(uuid())
  userId            String   @unique
  user              User     @relation(fields: [userId], references: [id], onDelete: Restrict)

  firstName         String
  lastName          String
  nickname          String?

  branchId          String                              // home branch
  branch            Branch   @relation("HomeBranch", fields: [branchId], references: [id], onDelete: Restrict)
  assignedBranchIds String[] @default([])               // multi-branch (includes home)

  departmentId      String?
  department        Department? @relation(fields: [departmentId], references: [id], onDelete: Restrict)

  accountingGroupId String?
  accountingGroup   AccountingGroup? @relation(fields: [accountingGroupId], references: [id], onDelete: Restrict)

  workScheduleId    String?
  workSchedule      WorkSchedule? @relation(fields: [workScheduleId], references: [id], onDelete: Restrict)

  salaryType        SalaryType
  baseSalary        Decimal  @db.Decimal(12, 2)
  status            EmpStatus
  canCheckIn        Boolean  @default(true)
  hiredAt           DateTime
  archivedAt        DateTime?

  // LINE invite (single-use token, regeneratable)
  inviteToken       String?  @unique
  inviteExpiresAt   DateTime?

  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  attendances           Attendance[]
  leaveRequests         LeaveRequest[]
  cashAdvances          CashAdvance[]
  payrolls              Payroll[]
  recurringDeductions   RecurringDeduction[]
}

enum SalaryType { Monthly Daily Hourly }
enum EmpStatus  { Probation Active Archived }
```

### 3.4 Attendance

```prisma
model Attendance {
  id                String   @id @default(uuid())
  employeeId        String
  employee          Employee @relation(fields: [employeeId], references: [id], onDelete: Restrict)

  date              DateTime @db.Date
  type              AttType
  source            AttSource

  // Duration per requirement.docx (e.g. "30 minutes late" or "1 day leave")
  durationMinutes   Int?

  // LIFF check-in/out evidence
  clockInAt         DateTime?                  // timestamptz
  clockOutAt        DateTime?
  checkInLat        Decimal? @db.Decimal(10, 7)
  checkInLng        Decimal? @db.Decimal(10, 7)
  checkInBranchId   String?
  checkInBranch     Branch?  @relation("CheckInBranch", fields: [checkInBranchId], references: [id], onDelete: SetNull)
  checkInSelfieUrl  String?
  checkInStatus     CheckInStatus?
  disputeReason     String?

  // Linkage to leave (when type = OnLeave)
  leaveRequestId    String?
  leaveRequest      LeaveRequest? @relation(fields: [leaveRequestId], references: [id], onDelete: SetNull)

  deductAmount      Decimal? @db.Decimal(12, 2)
  isOverridden      Boolean  @default(false)
  overrideNote      String?

  createdAt         DateTime @default(now())
  createdById       String                     // who recorded it (employee for LIFF, admin for manual, system for cron)

  @@unique([employeeId, date, type])
  @@index([date])
  @@index([employeeId, date])
}

enum AttType       { CheckIn CheckOut Absent Late EarlyLeave OnLeave }
enum CheckInStatus { Confirmed Disputed Rejected }
```

### 3.5 Leave & Cash Advance

```prisma
model LeaveType {
  id           String  @id @default(uuid())
  name         String  @unique               // "ลาป่วย", "ลากิจ", "ลาพักร้อน"
  isPaid       Boolean @default(true)
  annualQuota  Int?                          // null = unlimited (e.g., unpaid)
  archivedAt   DateTime?
  requests     LeaveRequest[]
}

model LeaveRequest {
  id           String   @id @default(uuid())
  employeeId   String
  employee     Employee @relation(fields: [employeeId], references: [id], onDelete: Restrict)
  leaveTypeId  String
  leaveType    LeaveType @relation(fields: [leaveTypeId], references: [id], onDelete: Restrict)
  startDate    DateTime @db.Date
  endDate      DateTime @db.Date
  reason       String
  attachmentUrl String?                       // medical cert
  status       LeaveStatus                    // Pending | Approved | Rejected | Cancelled
  reviewedById String?
  reviewedAt   DateTime?
  reviewNote   String?
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  attendances  Attendance[]                  // auto-created OnLeave rows on approval
}

enum LeaveStatus { Pending Approved Rejected Cancelled }

model CashAdvance {                          // requirement.docx §2
  id            String   @id @default(uuid())
  employeeId    String
  employee      Employee @relation(fields: [employeeId], references: [id], onDelete: Restrict)
  amount        Decimal  @db.Decimal(12, 2)
  requestedAt   DateTime @default(now())     // RequestDate
  status        AdvanceStatus                // Pending | Approved | Rejected | Cancelled
  approvedById  String?                      // AdminID
  approvedAt    DateTime?                    // ApprovalDate
  receiptUrl    String?                      // ReceiptImageURL
  isDeducted    Boolean  @default(false)     // consumed by Phase 2 payroll
  deductedInPayrollId String?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
}

enum AdvanceStatus { Pending Approved Rejected Cancelled }
```

### 3.6 Payroll (Phase 2)

```prisma
model RecurringDeduction {                   // Source of Payroll.deductDebt
  id              String   @id @default(uuid())
  employeeId      String
  employee        Employee @relation(fields: [employeeId], references: [id], onDelete: Restrict)
  reason          String                     // "เงินกู้บริษัท", "ผ่อนอุปกรณ์"
  monthlyAmount   Decimal  @db.Decimal(12, 2)
  monthsRemaining Int                        // decrements after each payroll publish
  startedAt       DateTime @default(now())
  endedAt         DateTime?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
}

model Payroll {                              // requirement.docx §4
  id                  String   @id @default(uuid())
  employeeId          String
  employee            Employee @relation(fields: [employeeId], references: [id], onDelete: Restrict)
  month               String                 // "2026-04"  YYYY-MM

  incomeBase          Decimal  @db.Decimal(12, 2)
  incomeOther         Decimal  @db.Decimal(12, 2) @default(0)

  deductSso           Decimal  @db.Decimal(12, 2) @default(0)
  deductAdvance       Decimal  @db.Decimal(12, 2) @default(0)
  deductAttendance    Decimal  @db.Decimal(12, 2) @default(0)
  deductDebt          Decimal  @db.Decimal(12, 2) @default(0)   // requirement §4 Deduct_Debt

  netPay              Decimal  @db.Decimal(12, 2)

  status              PayrollStatus          // Draft | Published | Locked
  publishedAt         DateTime?
  pdfUrl              String?

  revisionOfId        String?                // for republish
  revisionOf          Payroll? @relation("Revision", fields: [revisionOfId], references: [id], onDelete: SetNull)
  revisions           Payroll[] @relation("Revision")

  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt

  @@unique([employeeId, month])
  @@index([month])
}

enum PayrollStatus { Draft Published Locked }
```

### 3.7 Cross-cutting

```prisma
model Holiday {
  id          String   @id @default(uuid())
  date        DateTime @db.Date
  name        String                          // "วันแรงงาน"
  isSubstitute Boolean @default(false)        // for Mon-closed shop holiday substitution
  archivedAt  DateTime?
  @@unique([date])
}

model Notification {
  id         String   @id @default(uuid())
  userId     String                           // User.id
  channel    NotifChannel                     // LineMessage | InAppBell
  event      String                           // "leave.approved", "advance.approved", ...
  payload    Json
  readAt     DateTime?
  sentAt     DateTime?
  createdAt  DateTime @default(now())
  @@index([userId, createdAt])
}

enum NotifChannel { LineMessage InAppBell }

model AuditLog {
  id          String   @id @default(uuid())
  actorId     String?                         // User.id, nullable if actor deleted
  action      String                          // "employee.create", "payroll.publish", ...
  entityType  String                          // "Employee", "Payroll", ...
  entityId    String
  beforeValue Json?
  afterValue  Json?
  metadata    Json?                           // IP, UA, etc.
  createdAt   DateTime @default(now())
  @@index([entityType, entityId, createdAt(sort: Desc)])
  @@index([actorId, createdAt(sort: Desc)])
}
```

### 3.8 FK cascade policy (mandatory)

| Source | Target | onDelete |
|---|---|---|
| All FKs to `Employee` | — | `Restrict` (archive only) |
| All FKs to `Branch`, `Department`, `AccountingGroup`, `LeaveType`, `WorkSchedule` | — | `Restrict` (archive only) |
| `Attendance.checkInBranchId` | `Branch.id` | `SetNull` (branch deletion shouldn't void attendance history) |
| `Attendance.leaveRequestId` | `LeaveRequest.id` | `SetNull` |
| `Payroll.revisionOfId` | `Payroll.id` | `SetNull` |
| `AuditLog.actorId` | `User.id` | `SetNull` (audit history persists even after user removal) |
| `Notification.userId` | `User.id` | `Cascade` (notifications die with the user) |

### 3.9 Delete policy

| Entity | Policy |
|---|---|
| Employee, Branch, Department, AccountingGroup, LeaveType, Holiday, WorkSchedule | **Soft delete** via `archivedAt` |
| LeaveRequest, CashAdvance | Cancellable (`status = Cancelled`); never deleted |
| Payroll | Never deleted; revisable (new row with `revisionOfId`) |
| Attendance | Hard-deletable by Admin within 7 days of creation (typo correction); after 7d, locked |
| AuditLog | **Never deleted** (RLS enforces append-only at DB layer as backstop) |
| Notification | Auto-purge after 90 days (Inngest cron) |

---

## 4. Auth

### 4.1 Employee — LINE → Supabase Auth (Custom OIDC Provider)

**Supabase Custom OIDC Provider setup (W0):**

| Field | Value |
|---|---|
| Identifier | `custom:line` |
| Issuer | `https://access.line.me` |
| Discovery URL | `https://access.line.me/.well-known/openid-configuration` (auto-resolved) |
| Client ID | LINE Login channel ID |
| Client Secret | LINE Login channel secret |
| `email_optional` | `true` (LINE accounts often lack email) |
| Scopes | `openid profile` |

Once configured, Supabase auto-fetches LINE's JWKS and verifies LINE-issued ID tokens against it on every `signInWithIdToken` call.

**Pairing (first-time link, replaces v1's invite flow):**

1. Admin creates Employee in `/admin/employees/new` — `User.role = Employee`, no `authUserId` yet, `lineUserId = null`.
2. Admin clicks "สร้าง pairing link" → server generates a single-use JWT (`scope=line-pair`, `sub=employeeId`, TTL 24h), stores on `Employee.inviteToken`. Returns shareable URL `https://hr.koolman.co/i/{token}` and a server-rendered QR PNG.
3. Admin shares URL / prints QR (LINE chat, paper, locker sticker).
4. Employee opens URL on phone:
   - UA detection: LINE in-app browser → 302 to `https://liff.line.me/{liffId}?pair={token}`
   - Else → "Install LINE" page
5. **LIFF page (`/liff/pair`):**
   ```ts
   await liff.init({ liffId });
   const idToken = liff.getIDToken();                                // OIDC ID token
   const nonce = crypto.randomUUID();
   await supabase.auth.signInWithIdToken({
     provider: 'custom:line',
     token: idToken,
     nonce,
   });
   // Supabase now has a session for this LINE user (creates auth.users on first sign-in)
   const { pair } = router.query;
   await linkLineToEmployee({ pairingToken: pair });
   liff.closeWindow();
   ```
6. **`linkLineToEmployee` Server Action:**
   - Read session via `supabase.auth.getUser()` → `authUserId`
   - Read `auth.users.app_metadata.sub` → `lineUserId` (Supabase populates this from the OIDC `sub` claim)
   - Validate pairing JWT (signature, expiry, not used)
   - Reject if `authUserId` already linked to another Employee, or if Employee already has a different `authUserId`
   - Set `User.authUserId`, `User.lineUserId`, expire `Employee.inviteToken`, audit-log
   - Return success

**Daily flow:** Employee taps OA rich menu (4 tiles: เช็คอินเข้างาน / ขอลา / เบิกเงิน / โปรไฟล์) → LIFF page →
```ts
await liff.init({ liffId });
const { data: { session } } = await supabase.auth.getSession();
if (!session) {
  // re-sign-in silently using fresh LIFF ID token
  const idToken = liff.getIDToken();
  await supabase.auth.signInWithIdToken({ provider: 'custom:line', token: idToken, nonce: crypto.randomUUID() });
}
// User is now authenticated for all subsequent Server Actions
```

**Server-side auth check:** every Server Action uses `requireRole(['Employee'])` which reads `supabase.auth.getUser()`. No more LIFF-token-verify-per-request. The Supabase JWT (HS256, signed with Supabase's secret) is verified locally by the SSR client — single-digit-microsecond cost.

**Realtime + RLS:** because the Employee now has a real Supabase JWT in the browser, Supabase Realtime channels enforce RLS. The live admin board subscription `attendance:{date}` correctly hides rows the subscribing user shouldn't see.

### 4.2 Admin / Owner — Email + Password

- Login at `/login`: email + password via `supabase.auth.signInWithPassword()`.
- No OTP, no MFA, no email verification on signup.
- Reset-password flow: `supabase.auth.resetPasswordForEmail(email, { redirectTo })` — **Supabase Auth's built-in SMTP delivers the magic link from `noreply@mail.app.supabase.io`**. No separate provider. Two clicks (link → set-new-password page). If branded sender domain is wanted later, plug in Resend via Supabase Auth SMTP settings — but V1 default is the built-in sender.
- Bootstrap: seed script creates the first Owner + Admin from `.env.local` credentials via `supabase.auth.admin.createUser({ email, password, email_confirm: true })`.
- Logout = `supabase.auth.signOut({ scope: 'local' })`.

### 4.3 Session policy

All three roles run on **Supabase Auth sessions** (Employee via `signInWithIdToken('custom:line')`, Admin/Owner via `signInWithPassword`). One session model, one set of refresh semantics.

| | All roles (Supabase session) |
|---|---|
| Access token TTL | 1 hr |
| Refresh token TTL | 7 days, rotating |
| Storage | HTTP-only cookies via `@supabase/ssr` (`createServerClient` / `createBrowserClient`) |
| Multi-device | Allowed (Supabase tracks sessions in `auth.sessions`) |
| Force logout on role change | `supabase.auth.admin.signOut(userId, { scope: 'global' })` |
| Force logout on archive | Same; `requireRole()` also re-checks `User.archivedAt` on each request |
| LIFF re-auth | If session expired when LIFF page opens, silently `signInWithIdToken` again using fresh `liff.getIDToken()` — invisible to user |

### 4.4 Authorization

All Server Actions wrap with `requireRole(...)`. **Single helper for all three roles** — the LIFF code path was eliminated when Employees moved onto real Supabase sessions.

```ts
// src/lib/auth/require-role.ts
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export async function requireRole(roles: Role[]): Promise<{ user: User; employee?: Employee }> {
  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, { cookies: cookies() });
  const { data: { user: authUser } } = await supabase.auth.getUser();
  if (!authUser) throw new UnauthenticatedError();

  const user = await prisma.user.findUnique({ where: { authUserId: authUser.id } });
  if (!user || user.archivedAt) throw new UnauthenticatedError();
  if (!roles.includes(user.role)) throw new ForbiddenError();

  const employee = user.role === 'Employee'
    ? await prisma.employee.findUnique({ where: { userId: user.id } }) ?? undefined
    : undefined;
  return { user, employee };
}
```

For check-in specifically, add `requireCheckInPermission()` that wraps `requireRole(['Employee'])` and also asserts `employee.status !== 'Archived'` and `employee.canCheckIn === true`.

### 4.5 Defensive RLS (backstop only)

Deployed in Supabase migrations but Prisma bypasses them. Purpose: protect against future client-side use of Supabase JS, and against direct DB inspection with the anon key.

```sql
-- Example for Employee table
alter table public."Employee" enable row level security;

create policy "Employee can read own row"
  on public."Employee" for select
  using ( (select "authUserId" from public."User" where id = "userId") = auth.uid() );

-- Admin / Owner can do anything (via service-role key when needed)
-- No public-policy needed because Prisma uses service-role.
```

---

## 5. Storage buckets

| Bucket | Visibility | Path template | Max size | Retention |
|---|---|---|---|---|
| `avatars` | Private (signed URL) | `{employeeId}.jpg` | 2 MB | While active |
| `branding` | Public | `logo.png`, `favicon.ico` | 1 MB | — |
| `slips` | Private (15-min signed URL) | `{employeeId}/{YYYY-MM}.pdf` | 200 KB | 10 years (payroll retention) |
| `receipts` | Private (15-min signed URL) | `advances/{advanceId}.{ext}` | 5 MB | While advance not purged |
| `leave-attachments` | Private (15-min signed URL) | `leave/{requestId}.{ext}` | 5 MB | While leave record exists |
| `attendance-selfies` | Private (15-min signed URL) | `{employeeId}/{yyyymmdd}/{in\|out}.jpg` | 250 KB after client compress | 30 days (cron purge) |
| `imports` | Private | `{adminId}/{timestamp}.xlsx` | 5 MB | 30 days (cron purge) |

All uploads go through Server Actions (service-role key). All downloads use Server-Action-generated signed URLs after auth check.

**Image rendering:** all bitmap downloads (`avatars`, `branding`, `attendance-selfies`, `receipts`, `leave-attachments`) render through `next/image` with a custom Supabase `loader` that takes the signed URL and lets Vercel Image Optimization auto-transcode to WebP/AVIF, resize to device pixel ratio, and lazy-load. Selfies in particular drop from ~200 KB original → ~40 KB rendered on retina / ~15 KB on thumbnails. Vercel Pro allows 5K image-opt transforms/month free; well under our envelope.

PDFs (`slips`) are downloaded raw via signed URL — no transform needed.

---

## 6. Server actions (inventory overview)

Grouped by domain. Each has: Zod input schema, `requireRole(...)`, audit log on mutation, and Inngest event emission where async work follows.

**Auth & onboarding:** `bootstrapOwner`, `createEmployeePairingLink`, `regeneratePairingToken`, `linkLineToEmployee` (LIFF, expects active Supabase session from `signInWithIdToken`), `unlinkLineFromEmployee` (admin or self).

**Employee CRUD:** `createEmployee`, `updateEmployee` (field-allowlisted — cannot mutate own `role`), `archiveEmployee`, `rehireEmployee`, `assignBranches`, `setCanCheckIn`.

**Organization:** `createBranch` (+ map-pinned lat/lng), `updateBranch`, `archiveBranch`, `createDepartment`, `updateDepartment`, `archiveDepartment`, `createAccountingGroup`, `updateAccountingGroup`, `archiveAccountingGroup`, `createWorkSchedule`, `updateWorkSchedule`, `createLeaveType`, `updateLeaveType`, `createHoliday`, `bulkSeedHolidays`.

**Attendance (LIFF):** `submitCheckIn` (LIFF token, GPS, optional selfie), `submitCheckOut`. **Server-side flow:** verify LIFF token → load Employee → haversine to assigned branches → pick best match → write Attendance row with `checkInStatus = Confirmed | Disputed` → emit `attendance.late-check` Inngest event.

**Attendance (Admin):** `recordManualAttendance`, `editAttendance` (within 7d window), `approveDisputedCheckIn`, `rejectDisputedCheckIn`, `forceCheckout`.

**Leave & Advance:** `submitLeaveRequest` (LIFF), `cancelLeaveRequest`, `approveLeaveRequest`, `rejectLeaveRequest`, `submitCashAdvance` (LIFF), `cancelCashAdvance`, `approveCashAdvance` (receipt required), `rejectCashAdvance`.

**Payroll (Phase 2):** `triggerPayrollRun(month)`, `overridePayrollField(payrollId, field, value, note)`, `publishPayroll(month)` (pre-flight checklist enforced), `unlockPayroll(month, reason)`, `republishPayroll`. Fan-out via Inngest.

**Recurring deductions:** `createRecurringDeduction`, `editRecurringDeduction`, `endRecurringDeduction`.

**Reports (Phase 3):** `exportPeakCsv(month, groupId?)`, `monthlyAttendanceSummary(month)`.

**Excel (Phase 3):** `uploadAttendanceExcel` (returns preview), `commitAttendanceExcel(uploadId)`.

**Notifications:** `markNotificationRead`, `markAllNotificationsRead`.

---

## 7. Background jobs (Inngest)

| Function | Trigger | Purpose |
|---|---|---|
| `attendance-late-check` | event `attendance.recorded` | Compare clockInAt to WorkSchedule.start + tolerance; create `Late` Attendance row if late |
| `attendance-force-checkout-eod` | cron `0 16 * * *` (= 23:00 BKK) | For each Employee with check-in but no check-out today, write force-checkout |
| `attendance-selfie-purge` | cron `0 19 * * *` (= 02:00 BKK) | Delete selfies older than 30 days from `attendance-selfies` bucket |
| `notification-purge` | cron `0 20 * * *` (= 03:00 BKK) | Delete Notifications older than 90 days |
| `line-push-notification` | event `notification.send` | Look up recipient's lineUserId → build Flex Message → POST LINE Messaging API → dedup via `notification.id` |
| `payroll-fanout-calc` (Phase 2) | event `payroll.run.requested` | Fan out one `payroll.calc.employee` per Employee |
| `payroll-calc-employee` (Phase 2) | event `payroll.calc.employee` | Calc one slip with `decimal.js` → upsert Payroll row |
| `payroll-render-pdf` (Phase 2) | event `payroll.publish.slip` | Render PDF → upload to `slips` bucket → enqueue LINE delivery |
| `payroll-send-line` (Phase 2) | event `payroll.publish.slip-pdf-ready` | Build Flex Message with signed-URL → push to Employee LINE |
| `recurring-deduction-decrement` (Phase 2) | event `payroll.published` | Decrement `monthsRemaining` for each active RecurringDeduction |
| `probation-reminder` | cron `0 1 * * *` (= 08:00 BKK) | Notify Admin 7d before any Employee's probation end |
| `health-check-daily` | cron `0 2 * * *` (= 09:00 BKK) | Ping LINE Messaging API quota, Supabase storage usage, Supabase Auth SMTP recent-failure rate → alert if abnormal |

Idempotency: every `inngest.send` uses a deterministic `id` (e.g., `payroll-publish-${month}`); dedup tables back this up for double-spend-sensitive operations (`notification_sent`, `payroll_email_sent`).

---

## 8. Observability

- **Sentry:** errors 100%, traces 10%, replay OFF. Alert: 5 errors in 5 min in prod.
- **Vercel Speed Insights:** Web Vitals (LCP/INP/CLS) per page. Critical for the LIFF widget (target <5s perceived check-in). Free tier on Pro.
- **Vercel Analytics:** privacy-friendly page views, no cookies. Free tier on Pro.
- **Pino → Vercel Logs:** structured JSON, custom serializer masks `password`, `otp`, `nationalId`, `bankAccount`, `phone`. Retention: 24h (Vercel Pro) — sufficient for V1.
- **Inngest dashboard:** function failure alerts via email.
- **Health check Inngest cron:** as above.
- **Backup:** Supabase Pro PITR (7d) + weekly `supabase db dump` to Cloudflare R2 via GitHub Action. **End-of-Phase-1 drill: restore staging from PITR; document time-to-restore.**

---

## 9. Open questions to nail before W1

These are the W0 decisions still pending customer / dev confirmation. Each is small but blocking:

1. ~~**LINE OIDC verification**~~ — ✅ PASS 2026-05-26. See [oidc-verification.md](./oidc-verification.md).
2. **Working schedule:** Tue–Sun 09:00–18:00 universal, or per-branch?
3. **Late deduction ladder:** exact tiered amounts.
4. **Force-checkout time:** schedule.end + 4h, or fixed 23:00 BKK?
5. **Holiday-on-Monday substitution:** automatic on next workday, or admin-manual?
6. **Selfie default:** required by default, or off?
7. **Disputed check-in SLA:** auto-approve if not reviewed in 48h, yes/no?
8. **Multi-branch employee count:** how many?
9. **LINE OA verification:** submitted? If not, submit today (2–4 wk wait blocks W3 Messaging API push).
