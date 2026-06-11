# Admin LINE Experience — Design

Date: 2026-06-11
Status: Approved (pending final user review)

## Goal

Admins receive LINE push notifications for requests that need action (leave,
cash advance, attendance dispute) and can act on them from their phone —
including attaching the bank-transfer slip after paying an approved advance —
without opening the desktop admin panel.

## Scope

**v1 (this spec):** admin pairing, admin rich menu, admin LIFF pages for
acting on requests, admin LINE pushes, two-step advance payment with slip
attach and worker "paid" notification.

**Planned next (B, not in v1):** read-only extras in the admin LIFF area
(today's attendance overview, quick stats). The LIFF admin shell/nav must be
structured so these slot in without rework.

**Out of scope:** magic-link auto-login into the full admin web panel,
branch-scoped admin notification targeting, automatic "slip overdue"
reminders, LINE group broadcasts.

## 1. Admin ↔ LINE pairing

Reuse the existing invite-token pairing flow (`/liff/pair/[token]`),
generalized from Staff-only to any user.

- Admin generates a personal pairing link from the admin web panel
  ("เชื่อมต่อ LINE" in profile/settings) and opens it on their phone.
- On successful pairing of an Admin/Superadmin: store `lineUserId` on their
  `User` row (existing `@unique` column) and call `linkRichMenuIdToUser`
  with the admin rich menu ID.
- Unpair (web panel) clears `lineUserId` and unlinks the per-user rich menu.

Auth identities are NOT merged. The admin's email-based Supabase auth user
and the LIFF `custom:line` session stay separate; server code resolves a
LIFF session to the `User` row by `lineUserId` and reads roles from there.
The existing "scrub admin session in LIFF" logic in `src/lib/liff/init.ts`
changes to: scrub only when the LINE identity does not match a paired user.

## 2. Admin rich menu

- Created once via Messaging API (`createRichMenu` + image upload) by a
  one-off setup script; the rich menu ID is stored in an env var or
  `AppSetting`. Note: OA-Manager-created menus cannot be linked per-user —
  the menu object must be API-created. The user supplies the menu image
  (2500×1686 px or 2500×843 px, JPEG/PNG ≤ 1 MB).
- Tap areas (v1):
  1. กล่องงานรออนุมัติ → LIFF `/liff/admin/inbox`
  2. รอแนบสลิป → LIFF `/liff/admin/advance?filter=awaiting-slip`
  3. เปิดเว็บแอดมิน → plain URL to admin panel (normal email login)
- Workers keep the OA default menu; the per-user menu overrides it only for
  paired admins.

## 3. Admin LIFF pages (`/liff/admin/*`)

Mobile-first pages inside the existing single LIFF app, gated by a new
`requireLiffAdmin()` helper (LIFF session → `User` by `lineUserId` → must
hold a role with the new `liff.admin` permission).

- `/liff/admin/inbox` — pending leave + advance + dispute requests, newest
  first.
- `/liff/admin/leave/[id]` — detail + approve/reject. Calls the existing
  `approveLeaveRequest` / `rejectLeaveRequest` server actions in
  `src/lib/leave/admin.ts` (same validation, quota logic, attendance-row
  expansion, worker notifications).
- `/liff/admin/advance/[id]` — detail + approve/reject via existing
  `src/lib/advance/admin.ts` actions. After approval, shows
  "แนบสลิปโอนเงิน" upload: camera/gallery → existing image compression +
  Supabase Storage path (as `uploadAdvanceReceipt`) → sets `receiptUrl` and
  new `paidAt`.
- Dispute detail reuses the existing dispute review actions.
- Layout reuses the LIFF shell; nav is a stub-ready list for plan-B pages.

## 4. Notifications

**To admins (new):** on submission of a leave request, cash advance, or
attendance dispute — alongside the existing `notifyAdminsInApp` bell insert —
fan out `notification.send` Inngest events to every Admin/Superadmin with a
non-null `lineUserId`. Unpaired admins are skipped (bell still covers them).
All paired admins receive all pushes (no branch scoping, matching current
bell behavior). New Flex templates: orange "needs action" bubble with a
button deep-linking to the matching `/liff/admin/...` detail page, localized
per the admin's `User.locale`.

**To workers (new kind `advance.paid`):** fired when the slip is attached:
"โอนเงินค่าเบิกแล้ว ฿X" with a button to `/liff/advance/[id]`. The worker
advance detail page gains slip image display.

## 5. Data & permission changes (one migration)

- `CashAdvance.paidAt DateTime?` — set on first slip attach; slip attached
  means paid.
- New permission key `liff.admin`, granted to admin + superadmin
  `RoleDefinition`s via a backfill migration (editing `roles.ts` alone only
  affects fresh seeds — established pattern).

## 6. Advance lifecycle (two-step payment)

`Pending` → admin approves (`Approved`, worker gets existing "approved"
push) → admin transfers money in their bank app → admin attaches slip
(`receiptUrl` + `paidAt` set, worker gets `advance.paid` push with slip).

- Approved-but-unpaid advances stay visible in the "รอแนบสลิป" list
  indefinitely (visible nag; no auto-reminder in v1).
- Slip re-upload allowed: replaces the image; `paidAt` keeps its first value.
- Payroll deduction sweep is unchanged (keyed on `Approved` status /
  `deductedInPayrollId`).

## 7. Errors & edge cases

- Two admins act on the same request: existing server actions guard on
  status; the second gets an "already handled" error.
- Admin LINE push failure is non-fatal: Inngest retries; the bell remains
  the source of truth.
- Rich menu link failure during pairing must not fail the pairing — log and
  allow re-link.
- A paired admin who is deactivated or loses the admin role: `requireLiffAdmin`
  re-checks role on every request; deactivation should also unlink the rich
  menu (best-effort).

## 8. Testing

- Unit: `requireLiffAdmin` (paired admin passes, staff/unpaired rejected),
  admin fan-out (only paired admins targeted), `advance.paid` transition
  (paidAt set once, re-upload keeps it), new Flex templates render per kind.
- E2E: inbox → approve leave → approve advance → attach slip → worker
  notification event emitted. Respect suite gotchas (avoid port-3000 reuse;
  4 deferred skips expected).
