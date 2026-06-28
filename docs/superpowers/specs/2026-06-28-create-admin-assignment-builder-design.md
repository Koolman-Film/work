# Spec A — Create-admin assignment builder + permission-only landing

**Status:** Approved design (2026-06-28)
**Part of program:** Branch-scoped administration (Spec A of A → B → C…N). This spec is the "write" side (create accounts with role+branch assignments) and the landing UX. Branch-scope *enforcement* (filtering what a scoped user sees) is Spec B onward and is explicitly NOT in this spec.

## Problem

Two gaps remain after the "custom roles confer admin access" change shipped:

1. **You can't assign a custom role at creation.** The เพิ่มผู้ดูแล (create-admin) form still offers only a hardcoded tier dropdown (`Admin` / `Superadmin`) — [team/new/page.tsx:18](src/app/(admin)/admin/settings/team/new/page.tsx). Custom roles like `Checker01` can only be attached afterward on the edit page. There is no way to create "an admin with only `attendance.live-board`, scoped to branch(es)" in the create flow.
2. **A permission-only admin lands on a 404.** The home router sends any admin-capable user to `/admin` ([page.tsx](src/app/page.tsx)), but `/admin` requires `dashboard.read` ([admin/page.tsx:85](src/app/(admin)/admin/page.tsx)). A custom-role user without `dashboard.read` is routed straight into a 404, and the live board has no standalone sidebar entry, so their sidebar is empty.

## Goal

- Replace the create form's tier dropdown with a **multi-row `(role @ branch)` assignment builder**, so an account can be created with one or more role assignments (system or custom, global or branch-scoped) in a single step.
- Fix the landing so a permission-only admin lands on their **first accessible page**, never a 404, and a live-board-only account has a usable nav entry.
- **Invariant:** zero visible change for system `Admin` / `Superadmin` users — same nav, same access, same create options.

## Non-goals (explicit)

- **Branch-scope enforcement** — a `Checker01 @ Branch A` user will still *see* all branches on the live board after this spec. That recorded-but-not-enforced behavior is consistent with how branch-scoped Admins already behave today and is the subject of Spec B. This spec only makes the *assignment* (with branch) creatable and the account usable.
- No change to the edit page's `AssignmentsSection` (it already does add/remove with the right guards).
- No change to the permission catalog.

## Architecture

Three independent units:

1. **Create form (client) + `createTeamMember` (server action)** — collect N `(roleId, branchId)` rows + email/password, create the auth user + `User` + N assignments transactionally, with per-assignment privilege guards reused from `addRoleAssignment`.
2. **`firstAccessibleAdminPath(permissions)`** — pure helper mapping a permission set to the first reachable admin path, in sidebar order. Consumed by the home router and the `/admin` dashboard.
3. **Sidebar "ลงเวลา" item visibility tweak** — show on `attendance.read` OR `attendance.live-board`; href falls back to the live board when the user lacks `attendance.read`.

### Unit 1 — Create form + action

**`team-form.tsx`** (becomes a client component, or a new `team-create-form.tsx`):
- Fields: `email`, `password` (unchanged), and a dynamic list of assignment rows. Each row: a role `<select>` (all non-archived roles, labeled `Name`, `(Superadmin)` if `isSuperadmin`, `[กำหนดเอง]` if `!isSystem` — same as [assignments-section.tsx:159](src/app/(admin)/admin/settings/team/[id]/edit/assignments-section.tsx)) and a branch `<select>` (`ทุกสาขา (Global)` = `'global'`, plus each branch).
- Controls: "＋ เพิ่มแถว" to add a row, "✕" to remove a row. Starts with one empty row. **At least one complete row required** (client-side guard + server re-validation).
- Submit serializes the rows into `FormData` as parallel arrays `roleId` (repeated) and `branchId` (repeated, `'global'` or a Branch UUID), aligned by index.

**`new/page.tsx`** (Server Component):
- Keep `const { tier: actorTier } = await requirePermission('team.create')`.
- Fetch, in parallel: all non-archived roles (`id, name, isSuperadmin, isSystem`, ordered `isSystem desc, name asc`) and all non-archived branches (`id, name`, ordered `name asc`) — same queries as `AssignmentsSection`.
- Pass roles, branches, and `actorTier` to the form.

**`createTeamMember` action** — rewrite from the `z.enum(['Admin','Superadmin'])` shape to:
- Parse `email`, `password` (unchanged schemas), and `assignments: { roleId: string; branchId: string | null }[]` (map `'global'` → `null`). Reject if zero assignments (`'กรุณาเลือกบทบาทอย่างน้อยหนึ่งรายการ'`). Dedupe identical `(roleId, branchId)` pairs.
- Load each referenced role (`findMany where id in [...]`); reject if any is missing/archived (`'ไม่พบบทบาทที่เลือก'`).
- **Per-assignment guards — identical to `addRoleAssignment`** ([actions.ts:594](src/app/(admin)/admin/settings/team/actions.ts)):
  - `role.isSuperadmin && actorTier !== 'Superadmin'` → reject (`'ต้องเป็น Superadmin เพื่อมอบบทบาท Superadmin'`).
  - `!canManageSystemRole(actorTier, role)` → reject (`'ต้องมีสิทธิ์ระดับผู้ดูแลเพื่อมอบบทบาทระบบ'`).
  - `branchId === null` (global) requires `actorTier === 'Superadmin'`; else reject (`'ไม่มีสิทธิ์มอบบทบาทระดับทุกสาขา (Global)'`).
  - `branchId !== null` requires the branch exists/active AND `await canDo(actor, 'role.assign', { branchId })`; else reject.
- Create flow (transaction, preserving the existing rollback-the-auth-user-on-failure pattern):
  1. `supabase.auth.admin.createUser({ email, password, email_confirm: true })`.
  2. `prisma.$transaction`: create `User { authUserId, email }`, then `userRoleAssignment.createMany` for all validated `(userId, roleId, branchId)` rows.
  3. On DB failure: `sb.auth.admin.deleteUser(authUserId)` rollback.
- Audit log `user.create` with `{ email, assignments: [{roleKey, branchId}], authUserId }`.
- `revalidatePath('/admin/settings/team')` and **redirect to the new user's edit page** `/admin/settings/team/{id}/edit` (lets them refine immediately).

Errors redirect back to `/admin/settings/team/new?error=...&email=...` (existing pattern; the form re-displays the email).

> **Design decision — gate stays `team.create`, not `role.assign`.** Creating an account with initial role assignments is the `team.create` capability (today it implicitly assigns the `admin` role). The privilege *boundaries* that matter — superadmin-only, system-role tier requirement, branch-grant authority — are enforced per-assignment exactly as `addRoleAssignment` does. This neither widens nor narrows what an actor can grant versus doing it on the edit page.

### Unit 2 — `firstAccessibleAdminPath`

New module `src/lib/auth/admin-landing.ts`:

```ts
import type { Permission } from './permissions';

/** First admin path the user can actually open, in sidebar order.
 *  Returns '/admin' only when they hold dashboard.read. */
export function firstAccessibleAdminPath(permissions: ReadonlySet<Permission>): string;
```

Ordered table (first match wins), mirroring the sidebar:
`dashboard.read`→`/admin`; `attendance.read`→`/admin/attendance`; `attendance.live-board`→`/admin/attendance/live`; `leave.read`→`/admin/leave`; `advance.read`→`/admin/advance`; `employee.read`→`/admin/employees`; `report.read`→`/admin/reports`; `payroll.read`→`/admin/payroll`; `settings.branch.manage`→`/admin/settings/branches`; `settings.department.manage`→`/admin/settings/departments`; `settings.accounting-group.manage`→`/admin/settings/accounting-groups`; `settings.leave-type.manage`→`/admin/settings/leave-types`; `settings.leave-config.manage`→`/admin/settings/leave-config`; `settings.holiday.manage`→`/admin/settings/holidays`; `settings.work-schedule.manage`→`/admin/settings/work-schedules`; `settings.attendance.manage`→`/admin/settings/attendance`; `team.read`→`/admin/settings/team`; `role.read`→`/admin/settings/roles`. Fallback `/admin` (only reached if the set is empty, which `requireAdminArea` already prevents).

Consumers:
- **`src/app/page.tsx`**: replace `if (isAdminCapable) redirect('/admin')` with `redirect(firstAccessibleAdminPath(permissions))` (it already computes `permissions` via `permissionsFromAssignments`).
- **`src/app/(admin)/admin/page.tsx`**: change the gate from `requirePermission('dashboard.read')` (404 on miss) to `const { user, permissions } = await requireAdminArea(); if (!permissions.has('dashboard.read')) redirect(firstAccessibleAdminPath(permissions));` then render the dashboard as today. (Keeps `canViewLiveBoard` etc. working for those with `dashboard.read`.)

### Unit 3 — Sidebar "ลงเวลา" visibility

In `src/components/admin/sidebar.tsx`, the attendance item currently `{ href: '/admin/attendance', permission: 'attendance.read' }`. Replace its single-permission gate with "visible on `attendance.read` OR `attendance.live-board`", and compute its href: `allowed.has('attendance.read') ? '/admin/attendance' : '/admin/attendance/live'`. Implementation: give the item an optional `anyOf: ['attendance.read','attendance.live-board']` (the existing filter already supports `anyOf`) plus a small href-resolver for this item. Admin/Superadmin hold `attendance.read` → unchanged label, href, and behavior.

## Testing

- **`admin-landing.test.ts`** (pure): live-board-only set → `/admin/attendance/live`; no-dashboard set with `leave.read` → `/admin/leave`; full Admin set → `/admin`; settings-only set → first settings section.
- **`createTeamMember`** (action test, mirroring existing mock setup): creates N assignments from a multi-row payload; rejects non-Superadmin granting `superadmin`; rejects global grant by non-Superadmin; rejects a zero-assignment payload; rolls back the auth user when the DB write throws.
- **persona-access.test.ts** (extend): a live-board-only fixture → `firstAccessibleAdminPath` returns the live board and the sidebar "ลงเวลา" item is visible; Admin/Superadmin nav + landing unchanged.
- Full suite + `tsc --noEmit` clean; `next build` green.

## Files touched

| File | Change |
|------|--------|
| `src/app/(admin)/admin/settings/team/team-form.tsx` | Client multi-row `(role @ branch)` builder |
| `src/app/(admin)/admin/settings/team/new/page.tsx` | Fetch roles + branches; pass to form |
| `src/app/(admin)/admin/settings/team/actions.ts` | Rewrite `createTeamMember` for N assignments + per-assignment guards |
| `src/lib/auth/admin-landing.ts` (new) | `firstAccessibleAdminPath` |
| `src/lib/auth/admin-landing.test.ts` (new) | Pure tests |
| `src/app/page.tsx` | Home router → `firstAccessibleAdminPath` |
| `src/app/(admin)/admin/page.tsx` | Graceful redirect instead of 404 when no `dashboard.read` |
| `src/components/admin/sidebar.tsx` | "ลงเวลา" visible on `attendance.read` OR `attendance.live-board`, href fallback |
| `src/lib/auth/persona-access.test.ts` | Extend with live-board-only landing/nav assertions |

## Open risks

- The create form moves from a server-rendered `<select>` to a client component managing dynamic rows + server-action submission with array fields. The action must robustly parse aligned `roleId[]`/`branchId[]` arrays (length match, index alignment); covered by an action test.
- `createTeamMember`'s audit-log shape changes (`role` → `assignments[]`); any downstream audit reader must tolerate the new shape (audit is JSON metadata, no schema migration).
