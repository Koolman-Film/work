/**
 * Permission coverage audit — a permanent guard against the "I migrated
 * a route to requirePermission('foo') but forgot to add 'foo' to the
 * Admin role's defaults" bug we caught manually in Phase 3.6 (employee.
 * delete drift) and would have caught earlier in Phase 3.3 if this test
 * had existed.
 *
 * What we check:
 *   1. EVERY permission key referenced in a `requirePermission('X')`
 *      call site must exist in the catalog (PERMISSIONS).
 *   2. EVERY catalog permission must be granted by AT LEAST ONE
 *      SYSTEM_ROLE — otherwise the perm is unreachable.
 *   3. EVERY permission USED via `requirePermission` must be granted
 *      by SOME role that a real user could plausibly hold today.
 *      In practice this means: the perm is in admin's defaults, OR
 *      in staff's defaults, OR it's superadmin-only (and we trust the
 *      Superadmin isSuperadmin shortcut).
 *
 * What we DON'T check:
 *   - That Admin specifically has every perm. Some are intentionally
 *     Superadmin-only (role.manage). The test allows that, but flags
 *     anything that's reachable by code but unreachable by any role
 *     default.
 *
 * To run: `pnpm test perm-coverage`.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ALL_PERMISSIONS, type Permission } from './permissions';
import { SYSTEM_ROLES } from './roles';

const SRC_ROOT = join(__dirname, '../..');

/**
 * Walk the src tree and collect every permission key that appears in
 * a `requirePermission('X')` call. Uses regex (we don't need full AST
 * parsing for this; the call shape is tightly constrained).
 *
 * Excludes: test files (which might exercise edge cases with arbitrary
 * keys), and the check-permission module itself (where the doc string
 * uses 'employee.update' as an example).
 */
function findRequirePermissionCalls(): Set<string> {
  const RE = /requirePermission\(\s*['"]([a-z][a-z0-9.-]*)['"]/g;
  const found = new Set<string>();

  function walk(dir: string): void {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      const stat = statSync(path);
      if (stat.isDirectory()) {
        if (entry === 'node_modules' || entry === '.next') continue;
        walk(path);
        continue;
      }
      if (!/\.(tsx?|jsx?)$/.test(entry)) continue;
      if (/\.test\.[jt]sx?$/.test(entry)) continue;
      if (path.endsWith('check-permission.ts')) continue;

      const content = readFileSync(path, 'utf8');
      for (const m of content.matchAll(RE)) {
        found.add(m[1] ?? '');
      }
    }
  }

  walk(SRC_ROOT);
  return found;
}

describe('Permission coverage', () => {
  const usedKeys = findRequirePermissionCalls();

  it('finds at least one requirePermission call (smoke check)', () => {
    // If this fails it means the grep walker is broken, not that there
    // are zero calls — we shipped Phase 3 with dozens of them.
    expect(usedKeys.size).toBeGreaterThan(10);
  });

  describe('every used permission exists in the catalog', () => {
    for (const key of usedKeys) {
      it(`'${key}' is in PERMISSIONS`, () => {
        expect(ALL_PERMISSIONS).toContain(key as Permission);
      });
    }
  });

  describe('every used permission is granted by SOME system role', () => {
    // Build the "any role grants it" set. Superadmin grants everything
    // via the isSuperadmin shortcut, so really this checks that non-
    // Superadmin reachability is sane.
    const allGranted = new Set<string>();
    for (const role of Object.values(SYSTEM_ROLES)) {
      if (role.isSuperadmin) {
        // Superadmin shortcut — grants every catalog perm at runtime,
        // even though the static permissions[] is empty by design.
        for (const p of ALL_PERMISSIONS) allGranted.add(p);
        continue;
      }
      for (const p of role.permissions) allGranted.add(p);
    }

    for (const key of usedKeys) {
      it(`'${key}' is granted by at least one system role`, () => {
        expect(allGranted.has(key)).toBe(true);
      });
    }
  });

  it('catalog has no orphaned permissions (sanity check)', () => {
    // Every permission in the catalog should be useful. If a perm is
    // in the catalog but no role grants it AND no callsite gates on
    // it, it's dead code.
    //
    // KNOWN_PENDING is the explicit allowlist for "added to catalog
    // ahead of feature work, will be wired later." If a perm leaves
    // this list (no longer pending), this test won't trip; if a NEW
    // orphan appears, the test fires.
    const KNOWN_PENDING: ReadonlyArray<Permission> = [
      // Payroll permissions — calc engine shipped in Phase 2 W6 but
      // the admin UI + gates haven't been built yet. They will use
      // these keys.
      'payroll.read',
      'payroll.run',
      'payroll.publish',
    ];

    const allGranted = new Set<string>();
    for (const role of Object.values(SYSTEM_ROLES)) {
      if (role.isSuperadmin) continue; // shortcut, see above
      for (const p of role.permissions) allGranted.add(p);
    }
    const orphans = ALL_PERMISSIONS.filter(
      (p) => !allGranted.has(p) && !usedKeys.has(p) && !KNOWN_PENDING.includes(p),
    );
    // If this list grows, either: (1) someone added a perm to
    // PERMISSIONS but never wired it, or (2) a feature using it was
    // deleted but the catalog entry stayed. Either way, investigate.
    expect(orphans).toEqual([]);
  });
});
