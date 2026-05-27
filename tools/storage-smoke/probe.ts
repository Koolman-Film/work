/**
 * Storage smoke test — verifies the `attendance-photos` bucket + RLS
 * function are wired correctly.
 *
 * Run:
 *   pnpm tsx --env-file=.env.local tools/storage-smoke/probe.ts
 *
 * Steps:
 *   1. List buckets via service-role → 'attendance-photos' present
 *   2. Upload a tiny test file → succeeds
 *   3. Generate a signed URL → resolves to the file
 *   4. Confirm public.is_admin_or_owner() function exists by calling RPC
 *   5. Cleanup: delete the test file
 *
 * The per-user RLS policies (employee-owns-folder, admin-reads-all) are
 * deliberately NOT exercised here — they need a real Supabase Auth
 * session to test, which is W4-late integration-test territory.
 * Service-role bypasses RLS by design.
 */

import { createClient } from '@supabase/supabase-js';

const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

function ok(msg: string) {
  console.log(`${GREEN}✓${RESET} ${msg}`);
}
function fail(msg: string): never {
  console.error(`${RED}✗${RESET} ${msg}`);
  process.exit(1);
}
function step(msg: string) {
  console.log(`${DIM}→${RESET} ${msg}`);
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SECRET_KEY;
  if (!url || !serviceKey) {
    fail('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY in env');
  }

  console.log(`\n${DIM}Probing Supabase Storage at ${url}${RESET}\n`);

  const supabase = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // ── 1. Bucket exists ────────────────────────────────────────────────
  step('listing buckets');
  const { data: buckets, error: listErr } = await supabase.storage.listBuckets();
  if (listErr) fail(`listBuckets failed: ${listErr.message}`);
  const bucket = buckets?.find((b) => b.name === 'attendance-photos');
  if (!bucket) {
    fail(
      `bucket 'attendance-photos' not found. Got: ${buckets?.map((b) => b.name).join(', ') || '(empty)'}`,
    );
  }
  ok(`bucket 'attendance-photos' exists (public=${bucket.public}, id=${bucket.id})`);
  if (bucket.public) {
    console.warn(
      `${RED}!${RESET} bucket is PUBLIC — expected private. Selfies would be world-readable.`,
    );
  }

  // ── 2. Upload a test file ───────────────────────────────────────────
  // 1x1 transparent PNG (smallest valid image). The bucket has a MIME-type
  // allowlist that (correctly) rejects text/plain, so we must upload an
  // actual image to exercise the upload path.
  step('uploading 1×1 PNG');
  const testKey = `e2e-probe/${Date.now()}-probe.png`;
  const pngBytes = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
    'base64',
  );
  const testBody = new Blob([pngBytes], { type: 'image/png' });
  const { error: upErr } = await supabase.storage
    .from('attendance-photos')
    .upload(testKey, testBody, { upsert: false, contentType: 'image/png' });
  if (upErr) fail(`upload failed: ${upErr.message}`);
  ok(`uploaded ${testKey} (${pngBytes.length} bytes)`);

  // ── 3. Generate signed URL ──────────────────────────────────────────
  step('generating signed URL (60s)');
  const { data: signed, error: signErr } = await supabase.storage
    .from('attendance-photos')
    .createSignedUrl(testKey, 60);
  if (signErr) fail(`createSignedUrl failed: ${signErr.message}`);
  if (!signed?.signedUrl) fail('createSignedUrl returned empty url');
  ok(`signed URL issued (${signed.signedUrl.length} chars)`);

  // Try fetching the signed URL to prove it actually resolves.
  step('fetching signed URL');
  const resp = await fetch(signed.signedUrl);
  if (!resp.ok) fail(`signed URL fetch failed: HTTP ${resp.status}`);
  const bytes = new Uint8Array(await resp.arrayBuffer());
  // PNG magic number: 89 50 4E 47 0D 0A 1A 0A
  const looksLikePng =
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47;
  if (!looksLikePng) {
    fail(`signed URL returned non-PNG bytes (first 4: ${[...bytes.slice(0, 4)].join(',')})`);
  }
  ok(`signed URL resolves to the uploaded PNG (${bytes.byteLength} bytes)`);

  // ── 4. RLS helper function exists ───────────────────────────────────
  // Call the function with a random UUID — should return false (not error).
  step('calling public.is_admin_or_owner()');
  const randomUuid = '00000000-0000-0000-0000-000000000000';
  const { data: rpcData, error: rpcErr } = await supabase.rpc('is_admin_or_owner', {
    uid: randomUuid,
  });
  if (rpcErr) {
    fail(
      `is_admin_or_owner RPC failed: ${rpcErr.message}\n` +
        `  Hint: did the SQL with the SECURITY DEFINER function get run?`,
    );
  }
  if (rpcData !== false) {
    fail(`is_admin_or_owner returned ${rpcData} for nonexistent user; expected false`);
  }
  ok(`is_admin_or_owner(uid) returned false for nonexistent user (correct)`);

  // ── 5. Cleanup ──────────────────────────────────────────────────────
  step('cleanup: deleting test file');
  const { error: delErr } = await supabase.storage
    .from('attendance-photos')
    .remove([testKey]);
  if (delErr) fail(`delete failed: ${delErr.message}`);
  ok(`deleted ${testKey}`);

  console.log(`\n${GREEN}All checks passed.${RESET} Storage tier is ready for W4-late uploads.\n`);
}

main().catch((err) => {
  console.error(`${RED}Probe crashed:${RESET}`, err);
  process.exit(1);
});
