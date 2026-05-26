# Koolman HR v2 — Build Plan

**Status:** Active. Reads top-to-bottom; check off each line as you go.
**Companion:** [architecture.md](./architecture.md), [requirement-diff.md](./requirement-diff.md)

---

## Phase overview

| Phase | Calendar | Final output |
|---|---|---|
| **Phase 1** | W0–W5 (~5 wk) | LINE-auth employees check in/out, submit leave + advance, all flowing through LINE; Admin/Owner manage from web |
| **Phase 2** | W6–W9 (~4 wk) | Monthly payroll runs, locked Thai PDF slips delivered via LINE |
| **Phase 3** | W10–W12 (~3 wk) | Excel scanner fallback + Owner dashboard + Settings + Audit UI + PEAK export by AccountingGroup |
| **Phase 4** (opt.) | +2–3 wk | Anti-cheat upgrade: face match, branch QR, dispute appeal, Branch Manager role |

---

## Phase 1 — Foundation + Auth + LINE Check-in + Leave + Cash Advance

**Final output goal of Phase 1:**
A working multi-branch HR app where (a) Admin creates Employees, generates LINE invite links, prints branch QR codes; (b) Employees self-link via LINE and check in/out via LIFF with GPS geofence + optional selfie in under 5 seconds; (c) Employees submit leave + cash advance requests from inside LINE; (d) Admin reviews and approves everything from a web dashboard at `hr.koolman.co/admin`; (e) Notifications reach Employees as LINE Flex Messages and Admin/Owner as in-app bell. **No payroll yet, no PDF, no Excel upload.** The system is genuinely production-usable for ขาด/ลา/มาสาย + เบิกเงิน workflows from day 1.

### W0 — Pre-flight (1 week, mostly waiting + accounts)

**Build:**
- [ ] LINE Business ID verification submitted (this is the 2–4 week critical-path blocker — do **first**)
- [ ] LINE Developer Console: Provider + **LINE Login channel** (note channel ID + secret) + LIFF app (note LIFF ID) + Messaging API channel (note channel access token)
- [ ] Supabase project created (Singapore region), DB password saved, anon + service-role keys captured
- [ ] **Supabase Custom OIDC Provider configured:** dashboard → Auth → Providers → Add custom → identifier `custom:line`, issuer `https://access.line.me`, client ID + secret from LINE Login channel, `email_optional: true`, **`skip_nonce_check: true`**, scopes `openid profile`. Full config block in [credentials.local.md](./credentials.local.md) (gitignored).
- [ ] **Stage 2 OIDC smoke test executed** — `cd tools/oidc-smoke && npx vercel --yes` → wire LIFF Endpoint URL → open `https://liff.line.me/2010206636-7ktXQqFN` on phone → confirm all 6 green ✅. Procedure in [tools/oidc-smoke/README.md](../../tools/oidc-smoke/README.md), pass criteria in [oidc-verification.md §6](./oidc-verification.md#pass-criteria).
- [ ] Vercel team + project created, env vars prepped
- [ ] Sentry project (free tier), Inngest project (free tier)
- [ ] **(skip Resend)** — Supabase Auth's built-in SMTP handles admin password reset
- [ ] Domain `hr.koolman.co` (or chosen) DNS prepped — Cloudflare or customer registrar
- [ ] GitHub private repo created
- [ ] `docs/v2/architecture.md §1 Locked decisions` committed to repo
- [ ] **Bleeding-edge smoke test** (1 day spike): scaffold a throwaway Next.js 16 + React 19 + Tailwind 4 + Prisma 6 + `@supabase/ssr` + `@line/liff` v2.27 + `@react-pdf/renderer` v4 + `@vercel/speed-insights` + `@vercel/analytics` project. Verify:
  - (a) Thai text renders via IBM Plex Sans Thai
  - (b) 1-page PDF with Thai chars + tone marks renders correctly
  - (c) LIFF SDK initializes against dev LIFF app from real iPhone + Android phones in LINE app
  - (d) Prisma reads/writes a row via Supabase
  - (e) **`supabase.auth.signInWithIdToken({ provider: 'custom:line', token: <liff id token>, nonce })`** returns a Supabase session in browser — `supabase.auth.getUser()` then resolves to a real `auth.users` row with `user_metadata.sub === <LIFF userId>`
  - (f) `next/image` renders a Supabase Storage signed URL through Vercel Image Optimization (auto WebP)

**Test:**
- [ ] Smoke project deploys to Vercel preview successfully
- [ ] LIFF + LINE OIDC sign-in returns a Supabase session on both iPhone and Android (real devices, in LINE app)
- [ ] PDF renders Thai correctly in 3 readers (Adobe Reader, Chrome, LINE in-app preview)
- [ ] LINE OA verification confirmed by LINE (or queued for the wait)
- [ ] Vercel Speed Insights dashboard shows first page-view data
- [ ] `next/image` request returns `content-type: image/webp` in Network tab

**Done when:** Smoke test green + LINE OA submitted + Supabase Custom OIDC Provider verified working + all accounts provisioned.

---

### W1 — Foundation + Admin/Owner Auth + Schema + i18n

**Build:**
- [ ] Initialize real repo: Next.js 16 + App Router + Tailwind 4 + Biome 2 + Vitest + Playwright + Husky pre-commit
- [ ] Route group structure: `(auth)/`, `(admin)/`, `(owner)/`, `(liff)/`, `api/`
- [ ] Prisma schema for ALL models from [architecture.md §3](./architecture.md#3-data-model) — including Department, AccountingGroup, RecurringDeduction
- [ ] First migration `0001_init` applied to staging Supabase
- [ ] Supabase Auth configured: email+password ON, email confirmation OFF, MFA OFF, phone OFF; **Custom OIDC Provider `custom:line` already configured in W0**
- [ ] **`@supabase/ssr` set up correctly** for App Router: `src/lib/supabase/server.ts` exports `createServerClient` per-request (uses `cookies()` from `next/headers`); `src/lib/supabase/browser.ts` exports `createBrowserClient`; `middleware.ts` refreshes session on each request via `updateSession` helper from official Supabase example. This is fragile — copy from Supabase official Next.js example, do not invent.
- [ ] **`requireRole()` helper** from [architecture.md §4.4](./architecture.md#44-authorization) — single entry point for all role checks; reads session via `createServerClient`
- [ ] `withAudit()` Server Action wrapper + `src/lib/audit/log.ts` helper
- [ ] Seed script: 1 Owner, 1 Admin, 2 Branches (HQ + one satellite), 3 Departments, 2 AccountingGroups ("ค่าใช้จ่ายบริษัท", "จ่ายแทน-รับคืน"), 3 LeaveTypes (ลาป่วย/ลากิจ/ลาพักร้อน), 1 WorkSchedule ("Tue-Sun 9-18"), Thai 2026 holidays. Admin/Owner created via `supabase.auth.admin.createUser({ email, password, email_confirm: true })`.
- [ ] Login page `/login` (email + password) → `supabase.auth.signInWithPassword` → routes to `/admin` or `/owner` by `User.role`
- [ ] Password reset page `/reset-password` → `supabase.auth.resetPasswordForEmail` → Supabase delivers reset link via built-in SMTP
- [ ] next-intl scaffold; `messages/th.json` for first-50 strings; `messages/en.json` empty stub kept in sync
- [ ] Sentry SDK wired (replay off, 10% traces); Pino logger with PII scrubber
- [ ] **`@vercel/speed-insights` + `@vercel/analytics`** installed; `<SpeedInsights />` + `<Analytics />` placed in root layout
- [ ] CI on GitHub Actions: `pnpm install --frozen-lockfile`, `pnpm prisma migrate deploy`, `biome check`, `vitest run`
- [ ] Vercel auto-deploys `main`; preview deploys for each PR

**Test:**
- [ ] **Unit:** `requireRole()` accepts/rejects per role; `withAudit()` writes to AuditLog; PII scrubber strips sensitive fields
- [ ] **Integration:** Login as Admin → reaches `/admin`. Login as Owner → reaches `/owner`. Wrong password → error toast. Archived user → blocked. Session refreshes correctly across navigation (middleware works).
- [ ] **Manual:** Sentry receives a deliberately-thrown error in staging
- [ ] **Manual:** Password reset → email arrives from `noreply@mail.app.supabase.io` → reset link works
- [ ] **Manual:** Reset DB via `supabase db reset` → re-run seed → super-admin login still works
- [ ] **Manual:** Vercel Speed Insights + Analytics dashboards populating

**Done when:** All four CI jobs green. Admin + Owner login + password reset flows verified manually on staging.

---

### W2 — Branch CRUD + Department + AccountingGroup + Employee CRUD + Invite Token

**Build:**
- [ ] `/admin/branches` — list + create + edit. Form: name, address, lat (number), lng (number), radiusMeters (default 150), requireSelfie (toggle), attendanceSource (Liff/Excel/Both/Manual). Embed Leaflet + OpenStreetMap tile (no API key) for map pin.
- [ ] `/admin/departments` — list + create + edit (just name + description)
- [ ] `/admin/accounting-groups` — list + create + edit (name + peakCode + description). Pre-seeded with the two requirement.docx groups.
- [ ] `/admin/employees` — list with filters (branch, department, status), pagination
- [ ] `/admin/employees/new` and `/admin/employees/[id]` — form: firstName, lastName, nickname, branch, assignedBranches (multi-select), department, accountingGroup, workSchedule, salaryType, baseSalary, hiredAt, status
- [ ] Server Action `createEmployee` → creates `User` row (`role=Employee`, `authUserId=null`, `lineUserId=null`) + Employee row. Supabase `auth.users` row is **not** created here — it's auto-created by Supabase the first time the employee signs in via `signInWithIdToken`.
- [ ] Server Action `createEmployeePairingLink(employeeId)` → generates short JWT (`scope=line-pair`, `sub=employeeId`, 24h TTL), saves to `Employee.inviteToken` + `inviteExpiresAt`, returns shareable URL + base64-PNG QR code
- [ ] `/i/[token]` page (public): validates token signature + expiry + not-yet-used → server-side UA detection: if LINE in-app → 302 to `https://liff.line.me/{liffId}?pair={token}`; else show "Install LINE" with App Store / Play Store buttons
- [ ] Employee detail page shows: LINE link status (Pending/Linked/Expired), QR code download, "Regenerate Link" button

**Why no eager `auth.users` row:** With Supabase Custom OIDC, calling `signInWithIdToken({ provider: 'custom:line', token })` on first sign-in automatically creates an `auth.users` row with the LINE userId in `app_metadata.sub`. Our `User.authUserId` field stays `null` until `linkLineToEmployee` (W3) binds the two. No orphan auth rows, no duplicate identity creation.

**Test:**
- [ ] **Unit:** Invite token generates with correct TTL; validation rejects expired / tampered / used tokens
- [ ] **Integration:** Admin creates Department → appears in Employee form dropdown. Admin creates Branch with lat/lng → preview map renders pin. Admin creates Employee → User row + Employee row both exist.
- [ ] **Integration:** `inviteEmployeeLineLink` returns valid URL + QR; opening URL on staging redirects to LIFF dev URL.
- [ ] **Manual on phone:** Open `/i/{token}` in LINE in-app browser → redirects to LIFF page (empty stub for now; W3 builds the link page).

**Done when:** Admin can fully CRUD employees, branches, departments, accounting groups. QR codes print and resolve. Employee detail page shows invite status.

---

### W3 — LIFF Link Page + LIFF Check-in / Check-out

**Build:**
- [ ] `src/lib/liff/init.ts` — shared bootstrap that every LIFF page calls first:
  ```ts
  export async function liffBootstrap(liffId: string) {
    await liff.init({ liffId });
    const supabase = createBrowserClient(...);
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      const idToken = liff.getIDToken();
      if (!idToken) throw new Error('Open this page inside LINE');
      await supabase.auth.signInWithIdToken({
        provider: 'custom:line',
        token: idToken,
        nonce: crypto.randomUUID(),
      });
    }
    return supabase;
  }
  ```
- [ ] `/liff/pair` page (one-time pairing after admin shares QR/link):
  - Call `liffBootstrap` → Supabase session now exists for the LINE user
  - Read `pair` query param → call `linkLineToEmployee({ pairingToken })` Server Action
  - Server validates pairing JWT, reads session via `requireRole(['Employee'])` (which works because session exists), sets `User.authUserId = session.user.id`, `User.lineUserId = session.user.user_metadata.sub`, expires pairing token, audit-logs
  - Success animation → `liff.closeWindow()`
  - Error cases: token expired → "ขอลิงก์ใหม่"; lineUserId already linked elsewhere → "บัญชี LINE นี้ผูกกับพนักงานอื่นแล้ว"
- [ ] `/liff/check-in` (the daily widget):
  - `liffBootstrap` (session re-uses if cached; silent re-auth otherwise)
  - Top: name, today's date, branch detected, distance from geofence
  - Big primary button: "เช็คอินเข้างาน" (or "เช็คเอาท์" if already checked in)
  - On tap:
    1. `navigator.geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 8000 })`
    2. If `Branch.requireSelfie`: open camera via `<input type=file capture=user accept=image/*>`, preview, confirm
    3. Client-side compress selfie to ~200 KB via Canvas
    4. Upload selfie to Supabase Storage (presigned URL fetched from Server Action) — only if selfie required
    5. Submit `{lat, lng, accuracy, selfieKey?}` to `submitCheckIn` / `submitCheckOut` Server Action
- [ ] Server `submitCheckIn` logic:
  - `requireRole(['Employee'])` → standard Supabase session check (no LIFF-token verify needed)
  - Reject if Employee `status=Archived` or `canCheckIn=false`
  - Iterate `assignedBranchIds`, compute haversine, find best-fit branch within `radiusMeters`
  - Determine `checkInStatus`:
    - `Confirmed` if within geofence AND `accuracy < 100m` AND not impossible-travel
    - `Disputed` otherwise; populate `disputeReason`
  - Insert Attendance row with `source=Liff`, `type=CheckIn`, `clockInAt=now()`, `checkInLat`, `checkInLng`, `checkInBranchId`, `checkInSelfieUrl?`, `checkInStatus`
  - Emit `attendance.recorded` Inngest event (idempotency key `att-${employeeId}-${date}-CheckIn`)
- [ ] `submitCheckOut` mirror of above; updates same-day Attendance row by setting `clockOutAt`
- [ ] Inngest function `attendance-late-check` (event `attendance.recorded`):
  - Load WorkSchedule for employee → if `clockInAt > schedule.start + toleranceMin` → insert a separate Attendance row of `type=Late` with computed `durationMinutes` and `deductAmount`
- [ ] Inngest function `attendance-force-checkout-eod` (cron `0 16 * * *` = 23:00 BKK):
  - For each Employee with same-day check-in but no check-out, write force-checkout `clockOutAt = schedule.end + 4h` with `overrideNote='auto-forced'`
- [ ] `/admin/attendance/live` — realtime board via Supabase Realtime channel `attendance:{YYYY-MM-DD}`; columns: name, branch, check-in time, check-out time, status. Refreshes every 30s as fallback.
- [ ] `/admin/attendance/disputed` — inbox of disputed check-ins; click row → drawer with selfie preview + map → approve / reject with note
- [ ] `/admin/attendance/[date]` — manual entry form (admin can add Absent/Late/EarlyLeave directly without LIFF source)

**Test:**
- [ ] **Unit:** haversine math; impossible-travel detection (>50km in <30min flags); force-checkout cron computes correct timestamp from schedule + 4h
- [ ] **Integration:** pairing flow — fresh LIFF ID token → `signInWithIdToken` → `linkLineToEmployee(validToken)` → User row updated. Replay token → rejected. Token bound to different `lineUserId` than current session → rejected.
- [ ] **Integration:** `submitCheckIn` with mock GPS inside fence → Confirmed; outside fence → Disputed; archived employee → 403; canCheckIn=false → 403; no Supabase session → 401
- [ ] **Playwright (mobile emulation):** stub `@line/liff` to return a synthetic ID token signed with a test key registered on a local Supabase project → open `/liff/check-in` → tap button → assert Attendance row appears in DB. (This proves the full `signInWithIdToken` → session → server action chain end-to-end in CI.)
- [ ] **Manual on physical phones (cannot skip):** iPhone in LINE + Android in LINE. Full pairing → check-in flow including selfie capture. Verify Supabase session persists across LIFF page navigations. Verify geofence detection in 2 real branches.
- [ ] **Manual:** mock GPS via developer options on Android → server flags as Disputed
- [ ] **Manual:** open `/admin/attendance/live` on web → Realtime updates within 2s of a phone check-in (this also verifies RLS lets admin sessions subscribe to all-employee channel)

**Done when:** Three pilot employees (you + customer admin + one real employee) pair their LINE accounts and check in/out reliably for one week in one branch. Supabase session refresh works silently across multi-hour gaps. Admin sees live board updating in real-time. Disputed inbox works. Force-checkout cron has run successfully overnight at least once.

---

### W4 — Leave Requests + Cash Advance + LINE Notifications

**Build:**
- [ ] `/liff/leave/new` — LIFF page: LeaveType select, startDate + endDate (with calendar UI; show real days excluding holidays + Mondays), reason textarea, optional medical-cert photo upload. Submit → `submitLeaveRequest` Server Action
- [ ] `/liff/leave` — list own requests (active filter chips: All / Pending / Approved / Rejected / Cancelled)
- [ ] `/liff/leave/[id]` — detail view with status; cancel button if status=Pending
- [ ] **Team leave calendar** at `/liff/calendar` — month view of who in same branch (or assigned branches) is on leave; status chips for pending/approved. Per [requirement.docx §1 "ดูปฏิทินคนลาในทีม"](./requirement-diff.md)
- [ ] `/liff/advance/new` — similar shape: amount (number with ฿ prefix), reason
- [ ] `/liff/advance` and `/liff/advance/[id]` — same pattern as leave
- [ ] `/admin/leave` — inbox: pending requests grouped by employee; click row → drawer with full detail + employee profile snippet + Approve / Reject with note. On Approve: auto-create `Attendance` rows of `type=OnLeave` for each working day in range (skip holidays + Mondays); set `LeaveRequest.status=Approved`; emit `notification.send` event.
- [ ] `/admin/advance` — inbox: pending requests; click row → drawer with detail + **mandatory receipt-image upload field** before Approve; on Approve: set `status=Approved`, `receiptUrl`, `approvedById`, `approvedAt`, `isDeducted=false`; emit notification.
- [ ] Inngest function `line-push-notification` (event `notification.send`):
  - Load recipient User → Employee → lineUserId
  - If `channel=LineMessage`: build LINE Flex Message via `@line/bot-sdk`, POST `/v2/bot/message/push`
  - If `channel=InAppBell`: insert Notification row (Supabase Realtime channel auto-pushes to admin/owner browser)
  - Dedup via `Notification.id` (insert before push; on push failure, mark `sentAt=null` and retry via Inngest retry policy)
- [ ] In-app bell component for admin/owner: header dropdown, unread badge, click → Notification list, "mark all read"
- [ ] LINE OA rich menu: 4 tiles linking to `/liff/check-in`, `/liff/leave`, `/liff/advance`, `/liff/profile`

**Test:**
- [ ] **Unit:** leave date-range → Attendance row expansion correctly skips holidays + Mondays; receipt upload validation rejects > 5 MB / wrong mime
- [ ] **Integration:** Submit leave → admin approves → Attendance rows created (count matches working days); LINE push payload formatted correctly (use mock `@line/bot-sdk` in CI)
- [ ] **Playwright:** Full leave round-trip (employee submit → admin approve → employee sees Approved)
- [ ] **Manual on phone:** Submit leave from LIFF → push notification arrives in LINE within ~5s with correct Flex Message format
- [ ] **Manual:** Same for cash advance with receipt upload
- [ ] **Manual:** Team calendar shows other employees' leave correctly

**Done when:** Full leave + advance round-trips work on real devices. LINE push reliably reaches employees. Admin inbox handles zero-state, loading, error. Team calendar functional.

---

### W5 — Polish + UAT + Production Deploy

**Build:**
- [ ] All edge states wired: empty list, loading skeleton, error retry, no-permission 404
- [ ] Holiday-substitution logic: if Thai public holiday falls on Monday (closed day), auto-substitute next Tuesday (admin can override per case via Holidays settings)
- [ ] `probation-reminder` Inngest cron: notify Admin 7d before each Employee's probation period ends (assume probation = 4 months; configurable in v2.1)
- [ ] Admin dashboard `/admin` with KPI cards: pending leave count, pending advance count, today check-in count, "ยังไม่เช็คอินวันนี้" count; quick links to inboxes
- [ ] Owner dashboard `/owner` stub: read-only counts + recent activity feed (full owner pages are Phase 3)
- [ ] Production domain DNS configured; HTTPS via Vercel; LINE OA confirmed verified; LIFF endpoint URLs updated to production
- [ ] Production Inngest signing keys swapped; Sentry environment tagged
- [ ] **Backup/restore drill**: take a Supabase PITR snapshot, restore to a separate test project, verify employee data intact; document time-to-restore in maintenance log
- [ ] Thai user manual (1-page Markdown per role) committed to `docs/user-guide/`

**Test:**
- [ ] Full Playwright suite green
- [ ] **Manual UAT script (20 steps):** Admin creates employee → pairing link → employee signs in via LINE (Supabase session created) → checks in for a week → submits 1 leave + 1 advance → admin approves both → admin reviews live + disputed boards → owner sees stub dashboard
- [ ] **Load smoke:** seed 100 fake employees + 100 check-ins/day × 7 days → dashboard p95 < 2s, admin inbox < 1s
- [ ] **Sentry:** zero unresolved errors after smoke + UAT
- [ ] **Vercel Speed Insights:** LIFF check-in page LCP < 2.5s on real devices; Admin dashboard LCP < 2.5s
- [ ] **Production OIDC verification:** sign in from a fresh LINE account (not used in dev) → `signInWithIdToken` creates real `auth.users` row in prod Supabase

### Phase 1 Definition of Done

- [ ] All W1–W5 features built, styled, and Playwright-covered
- [ ] All Server Actions wrapped with Zod + `requireRole` + audit log
- [ ] RLS defensive policies deployed
- [ ] Real customer admin operates the system unaided for 3 consecutive days using the Thai user manual
- [ ] LINE OA verified, rich menu published, push delivery rate ≥ 99%
- [ ] Backup-restore drill passed; time-to-restore documented
- [ ] Sentry / Inngest / Vercel monitoring + alerts active
- [ ] Zero P0 issues; ≤ 3 P1 issues open

---

## Phase 2 — Payroll Engine + PDF + LINE Delivery

**Final output goal of Phase 2:**
Monthly payroll runs reading from Phase 1 data (Attendance.deductAmount, CashAdvance where isDeducted=false, RecurringDeduction monthlyAmount, base salary, SSO 5% capped at ฿750), produces a per-employee Thai-language PDF slip with Buddhist Era date + IBM Plex Sans Thai, locks rows on Publish, and delivers via LINE Flex Message with a 15-minute signed-URL to the PDF. Admin can override line-items pre-publish with mandatory note + audit. Pre-publish checklist enforces 4-point review before lock.

### W6 — PayrollConfig + Calc Service

- [ ] **PayrollConfig** singleton settings page: `ssoRate` (0.05), `ssoSalaryCap` (15000), `ssoAmountCap` (750), `otMultiplier` (1.5), `cutoffDay` (default 25 of month), `lateToleranceMin` (already on WorkSchedule)
- [ ] `src/lib/payroll/calc.ts` — **pure function** taking `{employee, attendances, advances, recurringDeductions, config, month}` → `PayrollDraft`
  - All math in `decimal.js`; return all amounts as Decimal
  - Pro-rate for mid-month start, termination, probation (configurable rule)
  - Handle multi-rate OT (weekday 1.5x, weekend 2x, holiday 3x — flag if customer wants this; otherwise flat 1.5x)
- [ ] Unit tests: 15 fixture cases (full month / probation half / mid-month start / mid-month end / all-leave / all-absent / OT crossing midnight / holiday on weekend / etc.)
- [ ] `/admin/payroll` — month picker → preview table with all 100 employees in Draft state

### W7 — Payroll Run + Overrides + Publish

- [ ] Server Action `triggerPayrollRun(month)`: emits `payroll.run.requested` Inngest event with id `payroll-run-${month}` (idempotent)
- [ ] Inngest `payroll-fanout-calc`: fan out 1 `payroll.calc.employee` event per Employee
- [ ] Inngest `payroll-calc-employee`: load deps, call `calc()`, upsert Payroll row by `(employeeId, month)` unique
- [ ] Override modals: per-field override (Income_Other, Deduct_Attendance, Deduct_Debt, etc.) with mandatory `overrideNote`; audit-log every override with before/after
- [ ] **Pre-publish checklist modal** (4 enforced confirmations): "Reviewed all overrides?", "Cash advances reconciled?", "Attendance verified?", "Owner briefed?". All four must be ticked before Publish button enables.
- [ ] `publishPayroll(month)`: lock all rows (`status=Locked`), set `publishedAt`, emit fan-out for PDF render + LINE delivery
- [ ] Realtime "X/100 published" progress via Supabase channel

### W8 — PDF + LINE Delivery

- [ ] `src/components/payroll/SlipPdf.tsx` using `@react-pdf/renderer`; bundled IBM Plex Sans Thai (.ttf in `public/fonts/`); registered via `Font.register({ family, src })`
- [ ] **W8 D0 spike:** render 3 edge-case Thai-name slips (long compound surname, name with multiple tone marks, all-English nickname) and open in Adobe Reader + Mac Preview + Chrome + LINE in-app preview + Android Drive viewer. Fix any glyph issues **before** committing the template.
- [ ] Inngest `payroll-render-pdf`: per Payroll, render PDF buffer → upload to `slips/{employeeId}/{YYYY-MM}.pdf` → set `Payroll.pdfUrl` → emit `payroll.publish.slip-pdf-ready`
- [ ] Inngest `payroll-send-line`: generate 15-min signed URL via `supabase.storage.createSignedUrl`; build Flex Message with name + month + netPay + "ดูสลิป" button (linking to signed URL); push via LINE Messaging API
- [ ] Dedup table `payroll_email_sent (payrollId, employeeId) UNIQUE` so double-send is impossible on Inngest retry

### W9 — Revisions + Employee Slip Viewer + UAT

- [ ] `unlockPayroll(month, reason)`: sets all rows back to Draft, requires reason (audit-logged)
- [ ] Republish creates new Payroll rows with `revisionOfId` pointing to the previous, sends a fresh LINE message
- [ ] `/liff/payslip` — employee sees list of own published slips (descending months)
- [ ] `/liff/payslip/[month]` — slip detail with download button (server generates fresh signed URL)
- [ ] **Shadow run UAT:** run customer's actual previous month payroll in the system; compare line-by-line to their existing Excel. Must match to ฿0.01 per employee before going live.

### Phase 2 Definition of Done

- [ ] Shadow run for ≥ 1 real prior month matches customer's existing Excel exactly
- [ ] 100% of slips deliver as LINE messages OR fall back to admin-visible "delivery failed" list
- [ ] PDF renders correctly in 5 readers including LINE in-app
- [ ] Override audit captures actor + before + after for every change

---

## Phase 3 — Excel + Owner + Settings + Audit UI + PEAK Export

**Final output goal of Phase 3:**
Operational completeness — Excel attendance import from fingerprint scanner (per-branch fallback), full Owner dashboard with read-only KPIs + company calendar + payroll review + audit log, Settings sub-pages for Departments / LeaveTypes / Holidays / AccountingGroups / PayrollConfig, audit log viewer with before/after diff, and PEAK CSV export **grouped by AccountingGroup** so the customer's accountant can journal-entry directly.

### W10 — Excel Upload + Audit UI

- [ ] `/admin/attendance/import` — file dropzone (xlsx ≤ 5 MB), upload to `imports/` bucket
- [ ] Server `uploadAttendanceExcel(uploadId)`: parse with `exceljs`, detect encoding (UTF-8 / TIS-620), map columns from customer's scanner format (require customer's sample files in W0 of Phase 3), produce preview table with row-by-row validation
- [ ] Preview UI: green / yellow / red row colors, per-row error reasons
- [ ] `commitAttendanceExcel(uploadId)`: idempotent insert on `(employeeId, date, type)` unique; for re-uploaded conflicting rows, show diff and let admin choose keep-existing vs overwrite
- [ ] `/admin/audit` — log viewer with filters (actor, action, entity type, entity id, date range)
- [ ] Click an audit entry → side panel with before/after JSON diff (use `react-diff-viewer-continued`)

### W11 — Owner Dashboard + Settings

- [ ] `/owner` — KPI cards (pending leave/advance counts, this-month payroll totals by AccountingGroup, on-leave today, attendance flags this week)
- [ ] `/owner/calendar` — company-wide month view with branch/department filter chips
- [ ] `/owner/payroll/[month]` — read-only payroll review (same component as admin's S-N13 but with `readOnly` prop forcing no edit buttons; route is a separate file under `(owner)/` for hard separation)
- [ ] `/owner/audit` — same audit viewer as admin (read-only)
- [ ] `/admin/settings` sub-pages:
  - `/admin/settings/departments` (CRUD)
  - `/admin/settings/leave-types` (CRUD)
  - `/admin/settings/holidays` (CRUD + bulk import Thai holidays)
  - `/admin/settings/accounting-groups` (CRUD)
  - `/admin/settings/payroll-config` (form for the singleton)
  - `/admin/settings/work-schedules` (CRUD)
- [ ] Sidebar nav for both Admin + Owner

### W12 — PEAK Export + Final Polish

- [ ] Server Action `exportPeakCsv(month, groupId?)`:
  - If `groupId` provided → one CSV scoped to that group
  - If not → one CSV per AccountingGroup in a single zip
  - CSV columns match PEAK Account import format (require customer to deliver sample PEAK CSV before W12)
  - Group total row at bottom of each section
- [ ] Owner / Admin "Reports" page `/admin/reports` with month picker + download buttons
- [ ] Final polish: i18n string sweep, lighthouse perf audit, Sentry quiet (no unresolved), Playwright suite still green
- [ ] Customer training session (1 hr); Thai admin guide finalized

### Phase 3 Definition of Done

- [ ] Excel upload commits 1000+ rows in < 30s; re-upload dedup works
- [ ] Owner can navigate the whole app without seeing a single edit button (DOM-verified)
- [ ] PEAK CSV imports cleanly into customer's PEAK with no manual fix-up
- [ ] Audit viewer can filter to a specific override on a specific payroll month
- [ ] All settings CRUDs work and have audit entries

---

## Phase 4 (optional) — Anti-cheat & Branch Manager Role

**Goal:** Close the remaining ~20% trust gap on LIFF check-in, add per-branch admin role.

- [ ] Face match: `face-api.js` client-side comparing selfie to a stored "reference photo" on Employee profile; flag mismatch as Disputed
- [ ] Branch QR: each Branch gets a printed QR with `BRANCH:{id}:{secret}`; LIFF scans via `liff.scanCodeV2`; cross-checks with GPS
- [ ] Liveness check (simple blink-detection)
- [ ] Employee dispute appeal flow ("ฉันโต้แย้ง" button on own rejected check-in → flags for admin re-review)
- [ ] Branch Manager role: scoped Admin who only sees + acts on their branch's employees, leave, advance, attendance (RLS-aware via `requireBranchScope()` helper)

---

## Cross-phase testing strategy

| Layer | Tool | What it covers | When |
|---|---|---|---|
| **Unit** | Vitest + `vitest-mock-extended` | Pure functions: payroll calc, geofence haversine, late detect, excel parser, decimal math | Each PR |
| **Integration** | Vitest + Supabase CLI local | Server Actions end-to-end against real DB; `supabase db reset` before suite | Each PR |
| **E2E** | Playwright (mobile + desktop viewports) | Critical flows: login, employee link, check-in, leave round-trip, advance round-trip, payroll publish | Each PR |
| **LIFF on real device** | Manual on iPhone + Android in LINE app | Geolocation, camera, LIFF SDK behavior — cannot be mocked | End of each W with LIFF changes (W3, W4, W5, W9) |
| **PDF rendering** | Manual + 5 readers (Adobe, Preview, Chrome, LINE preview, Android Drive) | Thai font glyphs, tone-mark stacking, word wrap | W8 D0 spike + end of W9 |
| **Load** | k6 (or homegrown seeder) | 100 emp × 7 days check-ins; dashboard p95 < 2s | End of W5 + W9 + W12 |
| **Backup/restore drill** | Manual | Restore staging from Supabase PITR; document time-to-restore | End of Phase 1 + annual |

**Fake time:** `vi.useFakeTimers({ now: new Date('2026-04-30T00:00:00+07:00') })` in any test exercising cutoff date, probation reminder, force-checkout cron, or recurring-deduction decrement.

---

## Open questions to resolve before W1 (carried from architecture.md §9)

1. **LINE OIDC verification** — confirm `signInWithIdToken({ provider: 'custom:line', ... })` returns a Supabase session in W0 smoke test
2. Working schedule universal or per-branch?
3. Late deduction ladder exact tiers
4. Force-checkout time: schedule.end + 4h, or fixed 23:00 BKK?
5. Holiday-on-Monday substitution: auto or manual?
6. Selfie default: required by default, or off?
7. Disputed check-in SLA: auto-approve in 48h yes/no?
8. Multi-branch employee count
9. LINE OA verification submitted? **DO THIS FIRST DAY** (2–4 wk wait blocks W3)

Answers update [architecture.md §9](./architecture.md#9-open-questions-to-nail-before-w1) and remove from this list.
