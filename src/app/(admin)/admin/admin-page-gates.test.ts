/**
 * Guardrail: every /admin page must declare a permission gate.
 *
 * Background
 * ----------
 * The route-group root layout (`src/app/(admin)/layout.tsx`) calls
 * `requireAdminArea()`, which ADMITS a user to the admin shell but does NOT
 * authorize individual pages. Each page — or a section `layout.tsx` that sits
 * **inside** `src/app/(admin)/admin/` — must call one of:
 *
 *   requirePermission(   requireRole(   requireAdminArea(   requireEmployee(
 *
 * A page that only inherits the route-group root layout is the "admitted but
 * not authorized" bug class (caused a Critical salary-data exposure). This
 * test locks that invariant permanently.
 *
 * Walk rules
 * ----------
 * For a page at `<dir>/page.tsx`, the test reads the page file, then walks
 * ancestor directories up to (and including) `admin/`, checking each one for a
 * `layout.tsx`. It does NOT count the route-group root
 * `src/app/(admin)/layout.tsx` — that layout is outside the `admin/` boundary
 * and only provides admission.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

// ─── constants ────────────────────────────────────────────────────────────────

/**
 * The `admin/` directory that is the root of all admin pages.
 * `__dirname` resolves to `src/app/(admin)/admin/` (where this file lives).
 */
const ADMIN_DIR = __dirname;

/** Gate-function signatures we scan for. */
const GATE_RE = /requirePermission\(|requireRole\(|requireAdminArea\(|requireEmployee\(/;

// ─── helpers ──────────────────────────────────────────────────────────────────

function hasGateCall(filePath: string): boolean {
  try {
    const text = fs.readFileSync(filePath, 'utf8');
    return GATE_RE.test(text);
  } catch {
    return false;
  }
}

/**
 * Collect every `page.tsx` under `adminDir` (recursive).
 */
function collectPages(dir: string): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectPages(full));
    } else if (entry.isFile() && entry.name === 'page.tsx') {
      results.push(full);
    }
  }
  return results;
}

/**
 * Walk ancestor directories from `pageDir` up to (and including) `ADMIN_DIR`,
 * checking each for a `layout.tsx` with a gate call.
 *
 * Stops at `ADMIN_DIR` — does NOT walk above it (which would reach the
 * route-group root layout that only admits, not authorizes).
 */
function hasEffectiveGate(pageFilePath: string): boolean {
  // 1. Check the page itself.
  if (hasGateCall(pageFilePath)) return true;

  // 2. Walk ancestor layouts inside admin/.
  let dir = path.dirname(pageFilePath);
  while (true) {
    const layout = path.join(dir, 'layout.tsx');
    if (fs.existsSync(layout) && hasGateCall(layout)) return true;

    // Stop after checking ADMIN_DIR itself — do not go higher.
    if (dir === ADMIN_DIR) break;

    const parent = path.dirname(dir);
    if (parent === dir) break; // filesystem root guard
    dir = parent;
  }

  return false;
}

// ─── test ─────────────────────────────────────────────────────────────────────

describe('Admin page permission-gate guardrail', () => {
  const allPages = collectPages(ADMIN_DIR);

  it('discovers at least one admin page (sanity check)', () => {
    expect(allPages.length).toBeGreaterThan(0);
  });

  it('every /admin page has an effective permission gate (page or ancestor layout inside admin/)', () => {
    const ungated = allPages.filter((p) => !hasEffectiveGate(p));

    // Build a readable relative path list for the failure message.
    const ungatedRel = ungated.map((p) => path.relative(ADMIN_DIR, p));

    expect(
      ungated,
      `Ungated admin pages (add requirePermission/requireRole/requireAdminArea/requireEmployee to the page or a section layout):\n${ungatedRel.map((r) => `  • ${r}`).join('\n')}`,
    ).toHaveLength(0);
  });

  it('discovers a non-trivial number of admin pages (guards against broken path resolution)', () => {
    // If discovery ever collapses (e.g. __dirname/path resolution breaks), the
    // guardrail above would pass vacuously — this floor makes that fail loudly.
    expect(allPages.length).toBeGreaterThan(20);
  });
});
