/**
 * Inngest smoke test — verifies the event key + signing key are valid.
 *
 * Run:
 *   pnpm tsx --env-file=.env.local tools/inngest-smoke/probe.ts
 *
 * Steps:
 *   1. Format-check both keys (catches paste errors / wrong-env keys
 *      before we even hit the network).
 *   2. Send a real `smoke.probe.test` event to Inngest's ingestion
 *      endpoint via the REST API (`POST https://inn.gs/e/{key}`).
 *      A 200 means the event key is valid AND Inngest accepted the
 *      payload — it'll appear in the dashboard's Events tab.
 *   3. (Skip) Verifying the signing key requires a roundtrip from
 *      Inngest → our deployed handler. That happens during W4-late/C
 *      integration testing.
 *
 * Why REST instead of the @inngest/sdk: avoids adding a dependency
 * for a one-shot probe. The actual function-handler wiring (which
 * needs the SDK's Inngest client + Next.js route serve helper) will
 * `pnpm add inngest` later.
 *
 * Why "smoke.probe.test" specifically: events are namespaced; using
 * `.test` keeps probe traffic visually distinct from real app events
 * in the dashboard.
 */

// Make this file a module so its top-level consts don't collide with
// the identically-named ones in the sibling probe scripts (each tools/
// subfolder is its own throwaway script but tsc treats the whole repo
// as one project).
export {};

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
function warn(msg: string) {
  console.warn(`${RED}!${RESET} ${msg}`);
}

async function main() {
  const eventKey = process.env.INNGEST_EVENT_KEY;
  const signingKey = process.env.INNGEST_SIGNING_KEY;
  if (!eventKey) fail('Missing INNGEST_EVENT_KEY in env');
  if (!signingKey) fail('Missing INNGEST_SIGNING_KEY in env');

  console.log(`\n${DIM}Probing Inngest${RESET}\n`);

  // ── 1. Format checks ───────────────────────────────────────────────
  step('format check: event key');
  // Inngest event keys are ~86 chars of URL-safe base64. We just sanity-
  // check it's a non-trivial string; the network call below is the real test.
  if (eventKey.length < 40 || /\s/.test(eventKey)) {
    fail(`event key looks malformed (len=${eventKey.length}, has whitespace=${/\s/.test(eventKey)})`);
  }
  ok(`event key shape valid (${eventKey.length} chars, no whitespace)`);

  step('format check: signing key');
  // Signing keys are prefixed with the environment they belong to:
  //   signkey-prod-...   → production environment
  //   signkey-test-...   → test/branch environment
  //   signkey-dev-...    → some legacy local-dev format
  // Mismatched prefix is a common paste error — if we point a "test"
  // key at production traffic, signature verification fails opaquely.
  const m = signingKey.match(/^signkey-(prod|test|dev|branch)-/);
  if (!m) {
    fail(
      `signing key has unexpected prefix. Expected signkey-{prod|test|dev|branch}-..., got "${signingKey.slice(0, 16)}..."`,
    );
  }
  const env = m[1];
  ok(`signing key prefix '${env}' (env: ${env === 'prod' ? 'production' : env})`);
  if (env !== 'prod') {
    warn(
      `you've provided a NON-production signing key. If you intended production, double-check the dashboard env dropdown.`,
    );
  }

  // ── 2. Send a real event ───────────────────────────────────────────
  step('POST https://inn.gs/e/{event_key} — sending smoke.probe.test event');
  const payload = {
    name: 'smoke.probe.test',
    data: {
      probe: true,
      sentAt: new Date().toISOString(),
      source: 'tools/inngest-smoke/probe.ts',
    },
  };

  const res = await fetch(`https://inn.gs/e/${encodeURIComponent(eventKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const body = await res.text();
    fail(
      `Inngest ingestion returned HTTP ${res.status}.\n  Body: ${body.slice(0, 200)}\n  → most likely an invalid event key.`,
    );
  }

  const result = (await res.json()) as { ids?: string[]; status?: number };
  if (!result.ids || result.ids.length === 0) {
    fail(`Inngest accepted the request but returned no event ids. Body: ${JSON.stringify(result)}`);
  }
  ok(`event accepted by Inngest`);
  console.log(`   ${DIM}event id:${RESET} ${result.ids[0]}`);
  console.log(`   ${DIM}status:${RESET}   ${result.status}`);

  console.log(
    `\n${GREEN}All checks passed.${RESET} Inngest is ready for event-driven wiring.\n`,
  );
  console.log(
    `${DIM}Look for the 'smoke.probe.test' event in the Inngest dashboard → Events tab.${RESET}`,
  );
  console.log(
    `${DIM}Next: build /api/inngest route handler + send leave/advance approval events.${RESET}\n`,
  );
}

main().catch((err) => {
  console.error(`${RED}Probe crashed:${RESET}`, err);
  process.exit(1);
});
