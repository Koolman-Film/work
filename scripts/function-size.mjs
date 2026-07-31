#!/usr/bin/env node
/**
 * Report the traced size of each server route, from the build output.
 *
 * Next writes a `.nft.json` beside every server entry listing every file that
 * gets bundled into that function. Summing those is how Vercel arrives at the
 * "uncompressed size" it enforces — so this is measurable locally, before a
 * deploy, instead of discovered by a failed one.
 *
 * Usage:
 *   node scripts/function-size.mjs                 # top 15 routes by size
 *   node scripts/function-size.mjs --route payroll # routes matching a substring
 *   node scripts/function-size.mjs --json          # machine-readable
 *   node scripts/function-size.mjs --check         # assert; non-zero on failure
 *
 * Requires a completed `pnpm build`.
 */

import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

const SERVER_DIR = resolve('.next/server');
const args = process.argv.slice(2);
const asJson = args.includes('--json');
const check = args.includes('--check');
const routeFilter = args.includes('--route') ? args[args.indexOf('--route') + 1] : null;
const limit = args.includes('--limit') ? Number(args[args.indexOf('--limit') + 1]) : 15;

/** Vercel's hard cap on an uncompressed function. */
const CAP_MB = 250;
/**
 * Our own ceiling — a slow-drift alarm, not the real limit.
 *
 * Measure on Linux, not your laptop: the same build is ~9% heavier there,
 * because `@next/swc` and `sharp` ship platform-specific binaries. The payroll
 * page measured 175.44 MB on macOS and 190.86 MB in CI, and the Linux figure
 * is the one that matches what Vercel enforces (it read 257.76 MB where macOS
 * said 241.86 MB — the same offset).
 *
 * 220 leaves ~29 MB of room above the real number and still fails well before
 * Vercel's 250 MB cap, while catching the 241.86 MB duplication regression
 * that prompted all this. It was briefly 200, which passed CI by 9 MB — close
 * enough that an ordinary `pnpm add` would have turned main red and blamed
 * whichever PR happened to cross the line.
 *
 * The duplication and missing-binary assertions below do the precise work;
 * this threshold only catches gradual growth nobody is watching.
 */
const BUDGET_MB = 220;

/**
 * The runtime-loaded binary payload, matched at either the symlinked or the
 * `.pnpm` location. Deliberately NOT a loose "chromium" match: the package's
 * JS is imported, so the tracer always finds it, and a loose match reports a
 * healthy route even when the binary that actually renders is missing.
 */
const CHROMIUM_BIN_RE =
  /@sparticuz[/+]chromium@?[^/]*\/(?:node_modules\/@sparticuz\/chromium\/)?bin\//;

/**
 * Routes that render PDFs and therefore MUST carry the chromium binary.
 *
 * Asserted in both directions on purpose. Too much chromium fails the deploy
 * loudly (250 MB cap); too little fails *silently* — the binary goes missing,
 * renders throw "input directory .../bin does not exist", and the payslip warm
 * swallows it. That is how the warm stayed broken for 53 occurrences without
 * anyone noticing, so the absence check matters more than the size one.
 */
const CHROMIUM_ROUTES = [
  'app/(admin)/admin/payroll/page.js',
  'app/(admin)/admin/payroll/payslip-pdf/route.js',
  'app/(admin)/admin/payroll/payslips-zip/route.js',
  'app/(liff)/liff/payslip/pdf/route.js',
  'app/(admin)/admin/reports/[report]/export/route.js',
];

/** Every *.nft.json under .next/server. */
async function findManifests(dir) {
  const out = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await findManifests(full)));
    else if (e.name.endsWith('.nft.json')) out.push(full);
  }
  return out;
}

/**
 * Sum the traced files.
 *
 * De-duplicated by *path* — because that is what ships. Two different paths
 * pointing at one physical file (pnpm's symlink and its `.pnpm` store entry)
 * are two copies in the function, which is exactly the bug that put
 * /admin/payroll 8 MB over the cap. `duplicateBytes` reports that overlap by
 * comparing realpaths, so it can be asserted on rather than rediscovered.
 */
async function measure(manifestPath) {
  const { files } = JSON.parse(await readFile(manifestPath, 'utf8'));
  const base = dirname(manifestPath);
  const seen = new Set();
  const byReal = new Map();
  let bytes = 0;
  let binaryBytes = 0;
  let duplicateBytes = 0;

  for (const rel of files) {
    const abs = resolve(base, rel);
    if (seen.has(abs)) continue;
    seen.add(abs);
    try {
      const s = await stat(abs);
      if (!s.isFile()) continue;
      bytes += s.size;
      // Specifically the runtime-loaded payload under `bin/`, NOT any path
      // containing "chromium". The package's JS is imported, so the tracer
      // always finds it — matching loosely reports a healthy route even when
      // the binary is absent, which is the exact failure this guards against.
      if (CHROMIUM_BIN_RE.test(abs)) binaryBytes += s.size;

      const real = await realpath(abs);
      if (byReal.has(real)) duplicateBytes += s.size;
      else byReal.set(real, s.size);
    } catch {
      // Traced entries can point at files pruned from the output; Vercel skips
      // them too, so skipping keeps this aligned with the real measurement.
    }
  }
  return { bytes, binaryBytes, duplicateBytes, fileCount: seen.size };
}

const mb = (n) => (n / 1024 / 1024).toFixed(2);

const manifests = await findManifests(SERVER_DIR);
if (manifests.length === 0) {
  console.error('No .nft.json found under .next/server — run `pnpm build` first.');
  process.exit(1);
}

const rows = [];
for (const m of manifests) {
  const route = m.slice(SERVER_DIR.length + 1).replace(/\.nft\.json$/, '');
  if (routeFilter && !route.includes(routeFilter)) continue;
  rows.push({ route, ...(await measure(m)) });
}
rows.sort((a, b) => b.bytes - a.bytes);

if (check) {
  const failures = [];

  for (const r of rows) {
    if (r.duplicateBytes > 0) {
      failures.push(
        `${r.route}: ships ${mb(r.duplicateBytes)} MB of DUPLICATE content — two traced ` +
          `paths resolving to the same file. Check outputFileTracingIncludes for a glob ` +
          `listed under both a symlink and its .pnpm target.`,
      );
    }
    if (r.bytes / 1024 / 1024 > BUDGET_MB) {
      failures.push(
        `${r.route}: ${mb(r.bytes)} MB exceeds our ${BUDGET_MB} MB budget ` +
          `(Vercel's hard cap is ${CAP_MB} MB — the deploy fails there).`,
      );
    }
  }

  for (const route of CHROMIUM_ROUTES) {
    const row = rows.find((r) => r.route === route);
    if (!row) {
      failures.push(`${route}: expected in the build output but no manifest was found.`);
    } else if (row.binaryBytes === 0) {
      failures.push(
        `${route}: renders PDFs but traces NO chromium binary. This fails silently at ` +
          `runtime — renders throw "input directory .../bin does not exist" and the warm ` +
          `swallows it. Check CHROMIUM_BIN in next.config.ts still matches the installed path.`,
      );
    }
  }

  const worst = rows[0];
  if (failures.length === 0) {
    console.log(
      `✓ ${rows.length} routes checked. Largest: ${worst.route} at ${mb(worst.bytes)} MB ` +
        `(budget ${BUDGET_MB} MB, cap ${CAP_MB} MB). No duplicate content. ` +
        `All ${CHROMIUM_ROUTES.length} PDF routes carry chromium.`,
    );
  } else {
    console.error(`✗ ${failures.length} problem(s) in the build output:\n`);
    for (const f of failures) console.error(`  • ${f}\n`);
    process.exit(1);
  }
} else if (asJson) {
  console.log(JSON.stringify(rows, null, 2));
} else {
  console.log(`${'ROUTE'.padEnd(58)} ${'SIZE'.padStart(9)} ${'CHROMIUM'.padStart(9)}  FILES`);
  for (const r of rows.slice(0, limit)) {
    console.log(
      `${r.route.padEnd(58)} ${`${mb(r.bytes)} MB`.padStart(9)} ${
        r.binaryBytes ? `${mb(r.binaryBytes)} MB`.padStart(9) : '—'.padStart(9)
      }  ${r.fileCount}`,
    );
  }
  console.log(`\n${rows.length} routes measured. Vercel's uncompressed cap is 250 MB.`);
}
