/**
 * Stand-in for the `server-only` package under vitest.
 *
 * `server-only` exists to make a build fail loudly when a server module is
 * pulled into a client bundle — it throws on import, unconditionally. That is
 * exactly right in the app and exactly wrong in a test runner, where importing
 * the module IS the point. Without this alias, anything marked `server-only`
 * is untestable, which had quietly excluded the statutory export builders —
 * the files where a silent mistake is most expensive.
 *
 * Aliased in vitest.config.ts. Deliberately empty: the real package's only
 * export is the throw.
 */
export {};
