# Employee profile: photo · birthday · bank account

**Date:** 2026-06-08
**Status:** Design — approved, pending spec review
**Author:** brainstormed with Vivatchai Kaveeta

## Summary

Add three fields to the employee profile, fully wired through the admin
add / edit / delete flow (`/admin/employees`):

1. **Employee photo** — reuse the existing selfie pipeline (client-side
   compress → upload to the `attendance-photos` bucket → store the storage
   *key*, sign at view-time).
2. **Date of birth** — an optional date field, plus a daily Inngest cron that
   posts an in-app bell to admins **1 day before** and **on** each employee's
   birthday.
3. **Bank account** — a new seeded `Bank` reference table (FK like
   `departmentId`), plus account number and account-holder name, for receiving
   salary and cash advances.

All three are optional and clearable: blanking a field on the edit form clears
it (the "delete" half of add/edit/delete). The hard `deleteEmployee` path also
removes the employee's photo object from storage.

## Goals

- Photo, date of birth, and bank account managed in the admin employee
  create + edit forms; each value can be set, changed, and cleared.
- Admins receive an in-app bell 1 day before and on each employee's birthday.
- Bank choices come from a seeded, BOT-aligned `Bank` table; the employee row
  stores a stable FK plus account number + holder name.
- Reuse existing patterns end-to-end (selfie storage, signed-URL batch helper,
  `probation-reminder` cron, `notifyAdminsInApp`, the org-reference FK shape).
- Treat the bank account number as PII: mask it in audit-log payloads.

## Non-goals

- **Admin form only.** No LIFF (`/liff/profile`) self-service for these fields
  in this change (decided).
- No new storage bucket — reuse `attendance-photos` (decided).
- No birthday delivery over LINE push; in-app bell only (matches
  `probation-reminder`).
- No admin CRUD UI for the `Bank` table — it is seed-managed national data.
- No change to archive (soft-delete) semantics; archived employees keep all
  data.

## Key decisions

1. **Reuse the `attendance-photos` bucket** for employee photos. A new
   `uploadEmployeePhoto()` helper in `src/lib/storage/upload-selfie.ts` mirrors
   `uploadAdvanceReceipt`: the admin uploads to
   `{adminAuthUserId}/employee-photos/{employeeId}.jpg` with `upsert: true`,
   satisfying the existing `(storage.foldername(name))[1] = auth.uid()` RLS.
   No new bucket or RLS migration.
2. **Client-direct photo upload via a small island.** A `photo-field.tsx`
   client component inside the form compresses with the existing
   `compressToJpeg`, uploads via the admin's browser Supabase client
   (`@/lib/supabase/browser`, already used by `advance-inbox.tsx`), and writes
   the resulting key into a hidden `photoKey` input that the server action
   persists. Keeps the form a server-action form; no raw multi-MB file hits the
   action.
3. **Store the photo key, sign at view-time.** Consistent with selfies —
   `Employee.photoKey` holds the path within the bucket; pages render it via the
   batch `getSignedUrls()` helper (`src/lib/storage/signed-urls.ts`). Storing a
   URL would bake in a TTL.
4. **Birthday matched by month-day via raw SQL.** A birthday recurs every year,
   so the cron compares `EXTRACT(MONTH …)`/`EXTRACT(DAY …)` against today and
   tomorrow (Bangkok). Prisma's typed date API can't compare month-day ignoring
   the year, so this one query is `prisma.$queryRaw`.
5. **`Bank` as a seeded reference table** (not a code constant), matching
   `Department` / `AccountingGroup` / `Branch` / `WorkSchedule`. `Employee`
   gains `bankId String? @db.Uuid` with `onDelete: Restrict`. Seeded from the
   BOT-aligned list (below) via `prisma/seed-banks.ts` + a `db:seed:banks`
   script, idempotent by `code`.
6. **Mask the bank account number in audit logs.** The audit log records full
   before/after for employee edits; the account number is masked to its last 4
   digits (`••••••1234`) in those payloads. Bank FK and holder name log
   normally.
7. **Hard delete cleans up the photo.** `deleteEmployee` best-effort removes the
   photo object via the service-role client, mirroring the existing best-effort
   `auth.admin.deleteUser` cleanup. A failure logs but doesn't roll back.
8. **New bell kind wired both ends.** `birthday.upcoming` is added to the
   `AdminBellEvent` union in `in-app-bell.ts` *and* given a render case in
   `notification-bell.tsx` (so the bell shows readable text, not a fallback).

## Architecture

### Data model (`prisma/schema.prisma`, migration `0016_employee_profile_fields`)

New `Bank` reference model:

```prisma
model Bank {
  id         String    @id @default(uuid()) @db.Uuid
  /// BOT / national clearing code, e.g. "004" (KBANK). Unique, stable.
  code       String    @unique
  nameTh     String
  nameEn     String
  /// Short label shown in the dropdown, e.g. "KBANK".
  shortName  String?
  /// Display ordering — common payroll banks first.
  sortOrder  Int       @default(0)
  archivedAt DateTime?
  createdAt  DateTime  @default(now())
  updatedAt  DateTime  @updatedAt

  employees  Employee[]

  @@index([archivedAt])
}
```

New `Employee` columns (all nullable → settable + clearable):

```prisma
photoKey          String?            // key within attendance-photos bucket
dateOfBirth       DateTime? @db.Date

bankId            String?  @db.Uuid
bank              Bank?    @relation(fields: [bankId], references: [id], onDelete: Restrict)
bankAccountNumber String?
bankAccountName   String?            // account-holder name

@@index([bankId])
```

### Bank seed list (`prisma/seed-banks.ts`)

Sourced from the BOT-supervised bank list. `code` is the national clearing code;
`sortOrder` puts common payroll banks first. Idempotent `upsert` by `code`.

| code | shortName | nameEn | nameTh |
|------|-----------|--------|--------|
| 004 | KBANK | Kasikornbank | ธนาคารกสิกรไทย |
| 014 | SCB | Siam Commercial Bank | ธนาคารไทยพาณิชย์ |
| 002 | BBL | Bangkok Bank | ธนาคารกรุงเทพ |
| 006 | KTB | Krung Thai Bank | ธนาคารกรุงไทย |
| 025 | BAY | Bank of Ayudhya (Krungsri) | ธนาคารกรุงศรีอยุธยา |
| 011 | TTB | TMBThanachart Bank | ธนาคารทหารไทยธนชาต |
| 030 | GSB | Government Savings Bank | ธนาคารออมสิน |
| 033 | GHB | Government Housing Bank | ธนาคารอาคารสงเคราะห์ |
| 034 | BAAC | Bank for Agriculture & Agricultural Co-ops | ธนาคารเพื่อการเกษตรและสหกรณ์การเกษตร |
| 069 | KKP | Kiatnakin Phatra Bank | ธนาคารเกียรตินาคินภัทร |
| 067 | TISCO | Tisco Bank | ธนาคารทิสโก้ |
| 073 | LHB | Land and Houses Bank | ธนาคารแลนด์ แอนด์ เฮ้าส์ |
| 022 | CIMBT | CIMB Thai Bank | ธนาคารซีไอเอ็มบี ไทย |
| 024 | UOBT | United Overseas Bank (Thai) | ธนาคารยูโอบี |
| 020 | SCBT | Standard Chartered Bank (Thai) | ธนาคารสแตนดาร์ดชาร์เตอร์ด (ไทย) |
| 070 | ICBC | ICBC (Thai) | ธนาคารไอซีบีซี (ไทย) |
| 071 | TCRB | Thai Credit Retail Bank | ธนาคารไทยเครดิต เพื่อรายย่อย |
| 066 | ISBT | Islamic Bank of Thailand | ธนาคารอิสลามแห่งประเทศไทย |
| 017 | CITI | Citibank N.A. | ซิตี้แบงก์ |
| 031 | HSBC | HSBC | ธนาคารเอชเอสบีซี |

(Foreign-branch banks beyond CITI/HSBC are omitted from the initial seed as
unlikely payroll banks; adding more is a one-line seed edit since the table is
seed-managed.)

### Feature 1 — Photo

```
employee-form.tsx (server)            photo-field.tsx (client island, inside <form>)
  initialPhotoUrl (signed | null) ──▶   <img> preview + file input + "ลบรูป"
  employeeId (edit) | null (create)     compressToJpeg → uploadEmployeePhoto(browserClient, blob, adminUid, employeeId)
                                        sets hidden <input name="photoKey" value={key | ""}>
  server action reads formData.get('photoKey')
```

- **`src/lib/storage/upload-selfie.ts`** *(extend)* — add
  `uploadEmployeePhoto(supabase, blob, adminAuthUserId, employeeId)`:
  `key = {adminAuthUserId}/employee-photos/{employeeId}.jpg`, `upsert: true`
  (same shape as `uploadAdvanceReceipt`). For **create**, the employee id does
  not exist yet, so the island uses a random suffix
  (`employee-photos/new-{rand}.jpg`); the action persists whatever key it
  receives.
- **`photo-field.tsx`** *(new client island)* — preview, file input
  (`accept="image/*"`), compress + upload on change, busy/error states, and a
  remove control that sets the hidden `photoKey` to `""`. Reuses `compressToJpeg`
  and the `SelfieUploadError` shape for messages.
- **Display** — the edit page signs `photoKey` via `getSignedUrls([photoKey])`
  and passes `initialPhotoUrl`; the employees **list** page signs all visible
  keys in one `getSignedUrls(keys)` call and renders thumbnails (avatar +
  initials fallback when null).
- **Cleanup** — the server action best-effort removes the previously stored
  object whenever the incoming `photoKey` differs from the one on the row (this
  covers both a re-upload to a new path and the create→edit transition where the
  key changes from `new-{rand}.jpg` to `{employeeId}.jpg`). Re-uploading to the
  same `{employeeId}.jpg` path relies on `upsert: true` and needs no delete. On
  removal and on hard `deleteEmployee`, best-effort
  `supabase.storage.from('attendance-photos').remove([key])` via the
  service-role client.

### Feature 2 — Birthday + admin alert

- **Form** — optional `dateOfBirth` date input in the "ข้อมูลพนักงาน" identity
  card.
- **`src/lib/inngest/functions/birthday-reminder.ts`** *(new)* — cloned from
  `probation-reminder.ts`. Daily `TZ=Asia/Bangkok 0 9 * * *`. Computes today and
  tomorrow in Bangkok, then:

  ```ts
  // month/day match ignoring year; one row per (employee, daysUntil)
  const due = await prisma.$queryRaw<{ id, firstName, lastName, nickname, daysUntil }[]>`
    SELECT id, "firstName", "lastName", nickname,
           CASE
             WHEN EXTRACT(MONTH FROM "dateOfBirth") = ${todM} AND EXTRACT(DAY FROM "dateOfBirth") = ${todD} THEN 0
             ELSE 1
           END AS "daysUntil"
    FROM "Employee"
    WHERE "archivedAt" IS NULL AND status <> 'Archived' AND "dateOfBirth" IS NOT NULL
      AND (
        (EXTRACT(MONTH FROM "dateOfBirth") = ${todM} AND EXTRACT(DAY FROM "dateOfBirth") = ${todD})
        OR (EXTRACT(MONTH FROM "dateOfBirth") = ${tomM} AND EXTRACT(DAY FROM "dateOfBirth") = ${tomD})
      )`;
  ```

  For each row, `notifyAdminsInApp({ kind: 'birthday.upcoming', employeeId,
  employeeName, birthday: 'MM-DD', daysUntil })`. Returns `{ notified }`.
- **`src/app/api/inngest/route.ts`** *(extend)* — register `birthdayReminder` in
  the `functions` array.
- **`src/lib/notifications/in-app-bell.ts`** *(extend)* — add to
  `AdminBellEvent`:

  ```ts
  | { kind: 'birthday.upcoming'; employeeId: string; employeeName: string;
      birthday: string /* MM-DD */; daysUntil: 0 | 1 }
  ```
- **`src/components/admin/notification-bell.tsx`** *(extend)* — render case:
  `daysUntil === 0` → "วันนี้วันเกิด {name} 🎂"; `=== 1` → "พรุ่งนี้วันเกิด
  {name} 🎂".

### Feature 3 — Bank account

- **Form** — a new "บัญชีธนาคาร (รับเงินเดือน / เบิกล่วงหน้า)" card: bank
  dropdown (from the seeded list) + account number + account-holder name. All
  optional, `— ไม่ระบุ —` empty option like `departmentId`.
- **`_load-options.ts`** *(extend)* — `loadEmployeeFormOptions` also returns
  `banks: { id, shortName, nameTh }[]` (active only, by `sortOrder`).
  `EmployeeFormOptions` gains `banks`.
- **Validation** — `bankId` optional uuid → nullable (same transform as
  `departmentId`). `bankAccountNumber` trimmed; if present, digits/`-`/spaces
  only, normalized to digits, length 8–15 (loose — Thai formats vary).
  `bankAccountName` trimmed `max(120)`, nullable.

### Cross-cutting CRUD (`src/app/(admin)/admin/employees/actions.ts`)

- **`EmployeeSchema` + `readForm()`** — add `photoKey`, `dateOfBirth`, `bankId`,
  `bankAccountNumber`, `bankAccountName`, all optional/nullable.
- **`createEmployee` / `updateEmployee`** — persist the new fields; include them
  in the audit `after` (and `before` for update via `serializableEmployee`).
  Account number masked in those payloads through a `maskAccount()` helper.
- **`deleteEmployee`** — after the Prisma + auth-user cleanup, best-effort remove
  the photo object when `photoKey` is set.
- **Edit page** *(extend)* — add the new fields to the `select` and to the form
  `initial`; sign `photoKey`.

## Error handling & edge cases

- **Photo upload fails / wrong type** — the island surfaces the
  `SelfieUploadError` message and leaves the prior `photoKey` untouched; the
  form still submits the rest.
- **Cancel after upload (create)** — the `new-{rand}.jpg` object is orphaned;
  accepted (matches the existing leave-cert orphan tolerance) — a future cron
  can sweep.
- **Clearing a field** — empty string from the form → `null` in the schema
  transform → column nulled. Removing a photo nulls `photoKey` and best-effort
  deletes the object.
- **Feb 29 birthdays** — fire only in leap years (no Feb-28 fallback in V1).
  Accepted limitation; noted for a future tweak.
- **Closed-day birthday** — the cron still fires (it's an admin heads-up, not an
  attendance expectation); intentional.
- **Bank FK** — `onDelete: Restrict`; the FK-violation path already redirects
  with a Thai error (extend the message to mention ธนาคาร). Since the table is
  seed-managed and not deletable via UI, this is defensive only.
- **Account-number PII** — never logged in full; `maskAccount()` keeps the last 4.

## Testing

- **Unit (vitest):**
  - `EmployeeSchema` — dob/bank/photoKey optional and clearable (empty → null);
    `bankAccountNumber` normalization + 8–15 length bound; `bankId` uuid-or-null.
  - `maskAccount()` — last-4 masking; short/empty inputs.
  - Birthday cron date logic — the today/tomorrow Bangkok month-day computation
    (extract to a pure helper and test around month/year boundaries, e.g.
    Dec 31 → Jan 1).
- **E2e (playwright):** create an employee with photo + date of birth + bank
  account → assert persisted on the edit page (photo thumbnail, dob value, bank
  selected, masked-free account in the input); edit to change the bank +
  account; edit to clear all three and assert they are blank.

## Out of scope / future

- LIFF self-service for photo / bank account.
- LINE-push birthday greeting to the employee.
- Sweeping orphaned `new-*.jpg` photo uploads.
- Feb-28 fallback for Feb-29 birthdays.
- Admin CRUD for the `Bank` table (seed-managed for now).
