-- Storage tier setup for Koolman Work (Phase 2.7-B in production runbook).
--
-- What this creates:
--   1. `attendance-photos` bucket — private, image-only, 5MB cap
--   2. `public.is_admin_or_owner(uid)` — SECURITY DEFINER helper for RLS
--   3. RLS policies on storage.objects:
--      - Employee uploads to / reads their own folder
--      - Admin/Owner reads / updates / deletes anything
--
-- Idempotent: safe to re-run. Buckets use ON CONFLICT; policies use
-- DROP IF EXISTS + CREATE.
--
-- Run in: Supabase Dashboard → SQL Editor → New query → paste → Run.
-- After running, verify with `pnpm tsx --env-file=.env.local tools/storage-smoke/probe.ts`.

-- ─── 1. Bucket ──────────────────────────────────────────────────────────────

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'attendance-photos',
  'attendance-photos',
  false,                                            -- private; access via signed URLs
  5242880,                                          -- 5 MB
  ARRAY['image/jpeg', 'image/png']                  -- selfies/receipts are always JPEG/PNG
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ─── 2. SECURITY DEFINER helper ─────────────────────────────────────────────
-- Why SECURITY DEFINER: the function runs with the *owner's* privileges
-- (typically postgres), letting it read the public."User" table even when
-- the calling user has no direct grants on it. SET search_path locks down
-- search-path-injection attacks (CVE-2018-1058 class).

CREATE OR REPLACE FUNCTION public.is_admin_or_owner(uid uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public."User"
    WHERE "authUserId" = uid
      AND "archivedAt" IS NULL
      AND "role" IN ('Admin', 'Owner')
  );
$$;

-- Grant execute to the auth.uid()-bearing role used by Storage policies.
GRANT EXECUTE ON FUNCTION public.is_admin_or_owner(uuid) TO authenticated, anon, service_role;

-- ─── 3. RLS policies on storage.objects ─────────────────────────────────────
-- Folder convention: `{authUserId}/{purpose}/{filename}`
--   - selfies → `{empAuthUid}/checkins/...`
--   - receipts → `{adminAuthUid}/advance-receipts/...`
--   - medical certs → `{empAuthUid}/leave-medical-certs/...`
-- `storage.foldername(name)[1]` returns the first path segment = the owner UUID.

-- Drop existing (idempotent re-run)
DROP POLICY IF EXISTS "attendance_photos: users insert own folder"  ON storage.objects;
DROP POLICY IF EXISTS "attendance_photos: users read own folder"    ON storage.objects;
DROP POLICY IF EXISTS "attendance_photos: admins read all"          ON storage.objects;
DROP POLICY IF EXISTS "attendance_photos: admins update all"        ON storage.objects;
DROP POLICY IF EXISTS "attendance_photos: admins delete all"        ON storage.objects;

-- (a) Anyone authenticated can insert IFF the target path starts with their own auth.uid().
CREATE POLICY "attendance_photos: users insert own folder"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'attendance-photos'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- (b) Anyone authenticated can read their own files (own-folder).
--     The app generates signed URLs server-side for cross-user reads
--     (admin viewing employee selfies), so the cross-cutting "admins read
--     all" policy below kicks in only when a real admin session is used.
CREATE POLICY "attendance_photos: users read own folder"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'attendance-photos'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- (c) Admin/Owner can read every file in the bucket.
CREATE POLICY "attendance_photos: admins read all"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'attendance-photos'
  AND public.is_admin_or_owner(auth.uid())
);

-- (d) Admin/Owner can overwrite (used by receipt upserts).
CREATE POLICY "attendance_photos: admins update all"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'attendance-photos'
  AND public.is_admin_or_owner(auth.uid())
)
WITH CHECK (
  bucket_id = 'attendance-photos'
  AND public.is_admin_or_owner(auth.uid())
);

-- (e) Admin/Owner can delete (cleanup, employee offboarding).
CREATE POLICY "attendance_photos: admins delete all"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'attendance-photos'
  AND public.is_admin_or_owner(auth.uid())
);

-- ─── Done ───────────────────────────────────────────────────────────────────
-- Sanity check (run separately):
--   SELECT name FROM storage.buckets WHERE id = 'attendance-photos';
--   SELECT proname FROM pg_proc WHERE proname = 'is_admin_or_owner';
--   SELECT policyname FROM pg_policies WHERE schemaname = 'storage'
--     AND tablename = 'objects' AND policyname LIKE 'attendance_photos:%';
