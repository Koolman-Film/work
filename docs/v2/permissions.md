# Role + Permission System

**Status:** Phase 1 shipped (migration 0009, code as of 2026-05-28). Phase 2 + 3 documented below.

## Concepts

- **Permission** — a stable string key (`'employee.create'`, `'leave.approve'`). Canonical catalog in `src/lib/auth/permissions.ts`. Adding a new permission = append to the catalog; runtime never invents keys.
- **RoleDefinition** — a named bundle of permissions. Three system roles ship by default; admins can create custom roles later (Phase 2). Superadmin is special: `isSuperadmin=true` → `canDo()` grants all permissions automatically.
- **UserRoleAssignment** — a (user, role, branch) triple. `branchId=NULL` means "applies globally" (Superadmin's default). A user can have multiple assignments — same user can be Staff at Branch A AND Admin at Branch B.

## Default system roles

| Key | Name | Branch scope | Permissions |
|---|---|---|---|
| `superadmin` | Superadmin | Global (NULL) | Everything (via `isSuperadmin=true` flag) |
| `admin` | Admin | Per-branch (NULL = global) | 21 perms across employee/attendance/leave/advance/settings/audit |
| `staff` | Staff | Per-branch | LIFF actions: check-in, leave-submit, advance-submit, profile-edit |

System roles have `isSystem=true` — they can't be deleted via UI and their permission lists are managed via migration + seed.

## Resolution chain

For a given request:

1. `requireRole(roles)` (legacy) — still works, reads `User.role` enum (`Staff | Admin | Superadmin`).
2. `requirePermission(permission, ctx)` (new) — queries `UserRoleAssignment` → joined `RoleDefinition.permissions`. Returns true if any assignment grants the permission.
3. **Branch scope in Phase 1: recorded but not enforced.** `canDo(user, perm, { branchId })` ignores the branchId — returns true if the user has the perm anywhere. Phase 3 wires real scope checks; the caller's signature won't change.

## Migration history

### Migration 0009 (this commit)

1. Rename Role enum: `Employee → Staff`, `Owner → Superadmin` (Admin unchanged)
2. Create `RoleDefinition` + `UserRoleAssignment` tables
3. Seed three system roles
4. Backfill `UserRoleAssignment`:
   - Each Superadmin user → one assignment, branchId=NULL
   - Each Admin user → one assignment, branchId=NULL (preserves "global Admin" semantics from before this commit)
   - Each Staff user → one assignment per branch they touched (home `branchId` + each entry in `assignedBranchIds`)

### Phase 2 (future)

- Admin UI to create / edit / archive custom roles
- Permission-picker checkbox grid (data already grouped via `PERMISSION_GROUPS` in `permissions.ts`)
- Per-user "Manage role assignments" page (assign Role + Branch pairs)
- LIFF / admin nav rendered from `getPermissionsFor(user)` instead of hardcoded role checks

### Phase 3 (future)

- Wire `branchId` enforcement into `canDo()`. Every existing `requireRole(['Admin'])` callsite that mutates branch-scoped data gets audited and migrated to `requirePermission('employee.update', { branchId: targetEmployee.branchId })`.
- Drop the legacy `User.role` enum column once nothing reads it.

## When to add a new permission

1. Append the key + label to `PERMISSIONS` in `src/lib/auth/permissions.ts`
2. Add it to the relevant group in `PERMISSION_GROUPS`
3. If it belongs in the Admin or Staff system role, add it to `SYSTEM_ROLES[...].permissions` in `roles.ts`
4. Write a migration that updates the corresponding `RoleDefinition.permissions` array (or run the seed which is idempotent)
5. Superadmin doesn't need migration — `isSuperadmin=true` shortcut covers everything

## When to add a new system role

1. Add a key to `SystemRoleKey` and an entry to `SYSTEM_ROLES` in `roles.ts`
2. Write a migration that inserts the row + permissions
3. Update `seed.ts` so fresh-DB seeds also create it (the seed loops over `SYSTEM_ROLES`)

## Helper API

```ts
import { canDo, getPermissionsFor, requirePermission } from '@/lib/auth/check-permission';

// In a Server Component / Server Action:
const allowed = await canDo(user, 'employee.create', { branchId });
if (!allowed) notFound();

// Or just gate the whole action:
const { user } = await requirePermission('employee.create', { branchId });

// Render-time bulk check:
const perms = await getPermissionsFor(user);
{perms.has('attendance.dispute-resolve') && <DisputeReviewLink />}
```

## Why we kept the legacy `User.role` column

160+ call sites use `requireRole(['Admin', 'Superadmin'])`. Migrating them all in one commit would have been a high-risk sweep. The legacy column stays as the fast-path session check; the new permission system is layered on top. Phase 3 drops `User.role` once we've migrated every consumer to permission-based checks.
