/**
 * Client-side selfie upload helper.
 *
 * Flow:
 *   1. Read the user's File (from <input type=file capture=user>)
 *   2. Decode to ImageBitmap → draw on canvas at scaled dimensions
 *   3. Canvas.toBlob('image/jpeg', quality) — iterates quality down if
 *      the result is still larger than the target size
 *   4. Upload the compressed Blob via Supabase Storage to the path
 *      `{authUserId}/checkins/{timestamp}-{rand}.jpg`
 *   5. Return the storage *key* (path-within-bucket), NOT the URL.
 *      Admin disputed-review UI generates fresh signed URLs at view-
 *      time. Storing the URL would bake in a TTL.
 *
 * Why client-direct upload (no presigned-URL Server Action):
 *   The RLS policy on storage.objects already grants the authenticated
 *   employee write access to their own folder. The Supabase browser
 *   client (with the session created by signInWithIdToken in W3a) hits
 *   the RLS as that user. An intermediary Server Action would be
 *   redundant.
 *
 * Why target size 200 KB:
 *   Mobile camera output is ~5 MB raw. Without compression, a single
 *   selfie eats half a megabyte of Storage bandwidth on every check-in.
 *   200 KB is plenty for a 1600×1200 thumbnail that admins can read at
 *   a glance for fraud-review. The 5 MB bucket cap is a backstop, not
 *   the goal.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export type SelfieUploadResult = {
  /** Path within the `attendance-photos` bucket, e.g. `{authUserId}/checkins/xxxx.jpg` */
  key: string;
  /** Compressed file size in bytes (for logging / debugging) */
  sizeBytes: number;
};

export type SelfieUploadError =
  | { kind: 'no-file' }
  | { kind: 'decode-failed'; message: string }
  | { kind: 'upload-failed'; message: string }
  | { kind: 'too-large-after-compress'; sizeBytes: number };

const MAX_DIMENSION = 1600; // longest edge in pixels
const TARGET_BYTES = 200 * 1024; // 200 KB
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB — matches bucket-level cap
const QUALITY_STEPS = [0.85, 0.7, 0.55] as const;

/**
 * Read a File, downscale, encode as JPEG, iterating quality steps down
 * until the result fits TARGET_BYTES or we exhaust the quality list.
 *
 * Returns the smallest blob we could produce — even if it's still over
 * the target, the caller decides whether to accept it or reject.
 */
export async function compressToJpeg(file: File): Promise<Blob> {
  // ImageBitmap is the fastest decoder available in browsers; falls back
  // to <img> + drawImage if not supported (rare these days).
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) {
    throw { kind: 'decode-failed', message: 'Browser failed to decode the image' };
  }

  // Compute scaled dimensions while preserving aspect ratio.
  const longest = Math.max(bitmap.width, bitmap.height);
  const scale = longest > MAX_DIMENSION ? MAX_DIMENSION / longest : 1;
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);

  // OffscreenCanvas avoids touching the DOM; falls back to <canvas> if
  // not supported (Safari < 16.4).
  const canvas =
    typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(w, h)
      : Object.assign(document.createElement('canvas'), { width: w, height: h });
  const ctx = canvas.getContext('2d');
  if (!ctx) throw { kind: 'decode-failed', message: 'Canvas 2D context unavailable' };
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close(); // free the decoded bitmap

  // Try each quality step until we hit the target. We always return the
  // SMALLEST result we produced — even if all steps exceed target, the
  // smallest is still better than the original.
  let best: Blob | null = null;
  for (const quality of QUALITY_STEPS) {
    const blob = await canvasToBlob(canvas, 'image/jpeg', quality);
    if (!best || blob.size < best.size) best = blob;
    if (blob.size <= TARGET_BYTES) break;
  }
  if (!best) throw { kind: 'decode-failed', message: 'Canvas produced no output' };
  return best;
}

const LOGO_MAX_DIMENSION = 256; // logos are small; a 256px square is crisp at 48px

/**
 * Read a logo File, downscale to ≤256px (longest edge), encode as PNG so a
 * round/transparent mark stays crisp and keeps its alpha. Logos are tiny, so
 * unlike compressToJpeg there is no quality-step loop.
 */
export async function compressToPng(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) {
    throw { kind: 'decode-failed', message: 'Browser failed to decode the image' };
  }
  const longest = Math.max(bitmap.width, bitmap.height);
  const scale = longest > LOGO_MAX_DIMENSION ? LOGO_MAX_DIMENSION / longest : 1;
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas =
    typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(w, h)
      : Object.assign(document.createElement('canvas'), { width: w, height: h });
  const ctx = canvas.getContext('2d') as
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D;
  if (!ctx) throw { kind: 'decode-failed', message: 'Canvas 2D context unavailable' };
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  return canvasToBlob(canvas, 'image/png', 1);
}

/**
 * canvas.toBlob normalized across HTMLCanvasElement + OffscreenCanvas
 * (the two have completely different APIs for the same operation).
 */
function canvasToBlob(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  type: string,
  quality: number,
): Promise<Blob> {
  if ('convertToBlob' in canvas) {
    return canvas.convertToBlob({ type, quality });
  }
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('toBlob returned null'))),
      type,
      quality,
    );
  });
}

/**
 * Internal: actually push a Blob to the `attendance-photos` bucket at
 * a precomputed key. Used by the public helpers below; each one
 * constructs its own deterministic path so the RLS check on
 * `(storage.foldername(name))[1] = auth.uid()` is satisfied.
 */
async function uploadToBucket(
  supabase: SupabaseClient,
  blob: Blob,
  key: string,
): Promise<SelfieUploadResult> {
  if (blob.size > MAX_BYTES) {
    throw { kind: 'too-large-after-compress', sizeBytes: blob.size };
  }

  const { error } = await supabase.storage.from('attendance-photos').upload(key, blob, {
    contentType: 'image/jpeg',
    upsert: false, // unique path; refuse silent overwrites
  });

  if (error) {
    throw { kind: 'upload-failed', message: error.message };
  }

  return { key, sizeBytes: blob.size };
}

/**
 * Upload a compressed selfie blob to the `attendance-photos` bucket at
 * `{authUserId}/checkins/{timestamp}-{rand}.jpg`.
 *
 * Caller MUST have an authenticated Supabase session for the employee
 * (created by W3a's signInWithIdToken). The RLS policy enforces that
 * the path starts with auth.uid(); passing a wrong authUserId here
 * would be rejected by the server.
 */
export async function uploadSelfie(
  supabase: SupabaseClient,
  blob: Blob,
  authUserId: string,
): Promise<SelfieUploadResult> {
  // Path components:
  //   - {authUserId} — required by RLS (folder must equal auth.uid())
  //   - "checkins"   — sub-folder; lets us later add /leave-medical-cert/
  //                    etc. without conflict
  //   - timestamp-random.jpg — sortable + unique enough
  const random = Math.random().toString(36).slice(2, 8);
  return uploadToBucket(supabase, blob, `${authUserId}/checkins/${Date.now()}-${random}.jpg`);
}

/**
 * Upload a compressed leave-request medical certificate to
 * `{authUserId}/leave-medical-certs/{timestamp}-{rand}.jpg`.
 *
 * Path uses timestamp+random rather than leaveRequestId because at
 * upload time the LeaveRequest row doesn't exist yet (submitLeaveRequest
 * creates it AFTER the client uploads the attachment and passes the
 * resulting key in). The LeaveRequest.attachmentUrl column points
 * back to the storage key, so the 1:1 mapping is preserved on the DB
 * side even though the path doesn't carry the ID.
 *
 * upsert:false because each leave submission is a one-shot — if the
 * employee retakes the photo, they pick a different file and we end
 * up with two paths under the same folder (one orphaned). Acceptable
 * waste at ~5 KB per orphan; cleanup would be a future cron.
 */
export async function uploadLeaveMedicalCert(
  supabase: SupabaseClient,
  blob: Blob,
  authUserId: string,
): Promise<SelfieUploadResult> {
  const random = Math.random().toString(36).slice(2, 8);
  return uploadToBucket(
    supabase,
    blob,
    `${authUserId}/leave-medical-certs/${Date.now()}-${random}.jpg`,
  );
}

/**
 * Upload a compressed cash-advance receipt to
 * `{authUserId}/advance-receipts/{cashAdvanceId}.jpg`.
 *
 * The auth user here is the ADMIN approving the advance, not the
 * employee who requested it. The RLS lets any authenticated user write
 * to their own folder, so admin uploads to admin's folder cleanly.
 *
 * Path uses cashAdvanceId (not a timestamp) so re-uploading replaces
 * the previous receipt for the same advance — `upsert: true` so the
 * second upload doesn't 409 on the unique path. This is fine because
 * each CashAdvance row has a 1:1 receipt; admin re-attaching is a
 * legitimate fix workflow.
 */
export async function uploadAdvanceReceipt(
  supabase: SupabaseClient,
  blob: Blob,
  adminAuthUserId: string,
  cashAdvanceId: string,
): Promise<SelfieUploadResult> {
  const key = `${adminAuthUserId}/advance-receipts/${cashAdvanceId}.jpg`;
  if (blob.size > MAX_BYTES) {
    throw { kind: 'too-large-after-compress', sizeBytes: blob.size };
  }
  // Direct call instead of `uploadToBucket` because we need upsert:true
  // here. (Selfies are append-only — each check-in is unique by path —
  // so they use upsert:false. Receipts are mutable per advance.)
  const { error } = await supabase.storage.from('attendance-photos').upload(key, blob, {
    contentType: 'image/jpeg',
    upsert: true,
  });
  if (error) {
    throw { kind: 'upload-failed', message: error.message };
  }
  return { key, sizeBytes: blob.size };
}

/**
 * Upload a compressed employee profile photo to
 * `{adminAuthUserId}/employee-photos/{employeeId|new-rand}.jpg`.
 *
 * The uploader is the ADMIN editing the employee (their browser Supabase
 * session satisfies the `path[1] = auth.uid()` RLS — same as
 * uploadAdvanceReceipt). For an existing employee we key by employeeId
 * with upsert:true so re-uploads replace in place; on the create form the
 * id doesn't exist yet, so we use a random suffix and let the server
 * action persist whatever key it receives.
 */
export async function uploadEmployeePhoto(
  supabase: SupabaseClient,
  blob: Blob,
  adminAuthUserId: string,
  employeeId: string | null,
): Promise<SelfieUploadResult> {
  const suffix = employeeId ?? `new-${Math.random().toString(36).slice(2, 10)}`;
  const key = `${adminAuthUserId}/employee-photos/${suffix}.jpg`;
  if (blob.size > MAX_BYTES) {
    throw { kind: 'too-large-after-compress', sizeBytes: blob.size };
  }
  const { error } = await supabase.storage.from('attendance-photos').upload(key, blob, {
    contentType: 'image/jpeg',
    upsert: true,
  });
  if (error) {
    throw { kind: 'upload-failed', message: error.message };
  }
  return { key, sizeBytes: blob.size };
}

/**
 * Upload a compressed branch logo to
 * `{adminAuthUserId}/branch-logos/{branchId|new-rand}.png`.
 *
 * Same admin-uploads-to-own-folder RLS as uploadEmployeePhoto. Keyed by
 * branchId with upsert:true so re-uploads replace in place; the create form
 * has no id yet, so it uses a random suffix and the server action persists
 * whatever key it receives.
 */
export async function uploadBranchLogo(
  supabase: SupabaseClient,
  blob: Blob,
  adminAuthUserId: string,
  branchId: string | null,
): Promise<SelfieUploadResult> {
  const suffix = branchId ?? `new-${Math.random().toString(36).slice(2, 10)}`;
  const key = `${adminAuthUserId}/branch-logos/${suffix}.png`;
  if (blob.size > MAX_BYTES) {
    throw { kind: 'too-large-after-compress', sizeBytes: blob.size };
  }
  const { error } = await supabase.storage.from('attendance-photos').upload(key, blob, {
    contentType: 'image/png',
    upsert: true,
  });
  if (error) {
    throw { kind: 'upload-failed', message: error.message };
  }
  return { key, sizeBytes: blob.size };
}
