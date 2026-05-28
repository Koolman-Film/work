-- ─── 0011 — Relax Admin role: same-branch team management ─────────────────
--
-- Phase 3.5 tightened team.* permissions to Superadmin-only, then 3.7
-- relaxed back to "Admin can manage other Admin in the same branch."
-- Two layers of enforcement combine to make this safe:
--
--   1. Permission gate (this migration):     Admin holds team.create /
--      team.update / team.delete / team.password-reset / role.assign.
--   2. canActOnRole (in team/actions.ts):    Admin can only act on
--      targets whose role is Admin (never Superadmin).
--   3. canActOnUserScope (in team/actions.ts): Branch-scoped Admin can
--      only act on targets sharing at least one branch.
--
-- Together: a branch-A Admin can password-reset another branch-A Admin
-- but NOT a branch-B Admin and NOT any Superadmin. A global Admin
-- (branchId=NULL) can manage any Admin at any branch but still not
-- Superadmins.
--
-- Idempotent: the DISTINCT unnest pattern means running twice yields
-- the same final state.

UPDATE "RoleDefinition"
SET "permissions" = ARRAY(
  SELECT DISTINCT unnest(
    "permissions" || ARRAY[
      'team.create',
      'team.update',
      'team.delete',
      'team.password-reset',
      'role.assign'
    ]::TEXT[]
  )
)
WHERE "key" = 'admin' AND "isSystem" = TRUE;
