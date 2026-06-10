/**
 * Node resolve hook for Playwright runs (injected via NODE_OPTIONS --import
 * in the `test:e2e` script).
 *
 * Why: a few specs import server modules (e.g. @/lib/leave/void) directly,
 * which `import { headers } from 'next/headers'`. Next ships root stub files
 * (headers.js) but no `exports` map, so under raw Node ESM resolution —
 * which Playwright's loader defers to — extensionless subpaths like
 * 'next/headers' throw ERR_MODULE_NOT_FOUND. Bundlers (Next itself, Vitest)
 * resolve them fine, which is why only Playwright is affected.
 *
 * The hook retries failed extensionless `next/*` specifiers with `.js`
 * appended. Scoped to `next/` so it can't mask genuine missing-module bugs.
 */
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (err) {
      if (/^next\/[^.]+$/.test(specifier)) {
        return nextResolve(`${specifier}.js`, context);
      }
      throw err;
    }
  },
});
