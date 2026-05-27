/**
 * Open-redirect defense.
 *
 * Returns `target` only if it's a same-origin relative path (e.g. "/admin").
 * Anything else — absolute URLs (`https://evil.com`), protocol-relative URLs
 * (`//evil.com`), empty strings, non-strings — returns `fallback`.
 *
 * Used wherever we accept a `redirectTo` / `next` query param and bounce the
 * user there after auth: login, magic-link callback, pairing landing.
 *
 * Why this matters: an attacker crafts a phishing link like
 *   https://hr.koolman.co/login?redirectTo=https://evil.com/steal-tokens
 * Without this check, a successful login would bounce the user to evil.com.
 * The startsWith('/') + !startsWith('//') guard rejects both.
 */
export function safeRedirect(target: unknown, fallback = '/'): string {
  if (typeof target !== 'string') return fallback;
  if (!target.startsWith('/') || target.startsWith('//')) return fallback;
  return target;
}
