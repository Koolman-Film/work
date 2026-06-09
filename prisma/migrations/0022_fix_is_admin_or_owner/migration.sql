-- Fix public.is_admin_or_owner — it still referenced User."role", a column
-- dropped when the app moved to the RoleDefinition / UserRoleAssignment model.
-- Every Storage RLS policy on the `attendance-photos` bucket calls this
-- function, so admin photo reads/uploads/deletes were throwing
-- `42703: column "role" does not exist` ("...is_admin_or_owner during startup").
--
-- This function + those storage policies were originally created directly in
-- Supabase, OUTSIDE Prisma migrations — which is why the column drop didn't
-- surface here. Tracking the function in a migration now so it is
-- version-controlled and re-applied (idempotently) on every deploy.
--
-- Maps the old roles: Admin -> RoleDefinition key 'admin'; Owner -> superadmin.
CREATE OR REPLACE FUNCTION public.is_admin_or_owner(uid uuid)
  RETURNS boolean
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public."User" u
    JOIN public."UserRoleAssignment" ura ON ura."userId" = u."id"
    JOIN public."RoleDefinition"     rd  ON rd."id"       = ura."roleId"
    WHERE u."authUserId" = uid
      AND u."archivedAt" IS NULL
      AND rd."archivedAt" IS NULL
      AND (rd."isSuperadmin" = true OR rd."key" = 'admin')
  );
$function$;

-- Self-check: execute the function so a broken body fails THIS migration loud
-- (instead of silently breaking an admin at runtime). A no-match uuid is fine —
-- we only care that it plans + runs.
DO $$
BEGIN
  PERFORM public.is_admin_or_owner('00000000-0000-0000-0000-000000000000'::uuid);
END $$;
