import 'server-only';

/**
 * LINE monthly message-quota headroom.
 *
 * The free plan allows 300 pushes/month and simply rejects everything after
 * that — silently, from the app's point of view. In July 2026 the account hit
 * the cap and every notification stopped for days before anyone noticed. This
 * module exists so we notice.
 *
 * Both endpoints used here are metadata calls and do NOT themselves consume
 * quota, so polling them is free.
 *
 * FAIL-OPEN BY DESIGN: every failure path returns null / true. A guard that
 * blocks delivery when it cannot read the quota would turn a LINE API blip
 * into a total notification outage — strictly worse than the problem it
 * guards against.
 *
 * Verified API shape (2026-07-19): queried the production channel directly
 * and `GET /v2/bot/message/quota` returned `{"type":"limited","value":300}`,
 * confirming the `.value` read below is correct for this plan. A channel
 * configured differently (e.g. unlimited/developer trial) can return
 * `{"type":"none"}` with no `value` field — `limit` (and therefore
 * `remaining`) goes null in that case, and the guard fails open, same as any
 * other unreadable-quota path.
 */

/** Messages held back as a buffer against the count going slightly stale
 *  between the cached read (see CACHE_MS below) and the actual send — NOT an
 *  urgent-send bypass; every caller goes through `hasQuotaHeadroom()`, so
 *  there is no path that would ever spend this reserve. */
export const QUOTA_RESERVE = 5;

/**
 * Consumption fraction at which admins get an early warning on the in-app bell.
 *
 * Distinct from QUOTA_RESERVE, and deliberately far from it. The reserve is
 * where sending STOPS (295/300) — by then nothing can be done but wait for the
 * month to roll over. This is where someone is TOLD (225/300), while ~70
 * messages of runway remain: enough to unlink an admin, postpone a payslip
 * resend, or move to a paid plan before the system goes quiet.
 *
 * A guard that only speaks once it has already failed is not a warning.
 */
export const QUOTA_WARN_RATIO = 0.75;

export type QuotaSnapshot = {
  /** Monthly message allowance for the plan. */
  limit: number;
  /** Messages consumed so far this month. */
  used: number;
  /** limit − used. */
  remaining: number;
};

const CACHE_MS = 5 * 60 * 1000;
let cache: { at: number; snapshot: QuotaSnapshot | null } | null = null;

/** Test-only: clear the module-level cache between cases. */
export function __resetQuotaCache(): void {
  cache = null;
}

async function fetchJson(path: string, token: string): Promise<unknown | null> {
  try {
    const res = await fetch(`https://api.line.me/v2/bot/message/${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Full quota reading — limit, used and remaining — or null when any part of it
 * is unreadable. Cached for CACHE_MS; every other export in this file reads
 * through here, so one LINE round-trip serves the send guard and the warning.
 */
export async function quotaSnapshot(): Promise<QuotaSnapshot | null> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.snapshot;

  const snapshot = await readQuota();
  cache = { at: Date.now(), snapshot };
  return snapshot;
}

async function readQuota(): Promise<QuotaSnapshot | null> {
  const token = process.env.LINE_MESSAGING_CHANNEL_ACCESS_TOKEN;
  if (!token) {
    // Fail-open, but audibly: an unreadable quota must not look identical to
    // a healthy one in the logs — that silence is exactly how the July 2026
    // cap-out went unnoticed for days.
    console.warn(
      '[line/quota] LINE_MESSAGING_CHANNEL_ACCESS_TOKEN is not set — quota unreadable, failing open',
    );
    return null;
  }

  const [quota, consumption] = await Promise.all([
    fetchJson('quota', token),
    fetchJson('quota/consumption', token),
  ]);

  const limit =
    quota && typeof quota === 'object' && typeof (quota as { value?: unknown }).value === 'number'
      ? (quota as { value: number }).value
      : null;
  const used =
    consumption &&
    typeof consumption === 'object' &&
    typeof (consumption as { totalUsage?: unknown }).totalUsage === 'number'
      ? (consumption as { totalUsage: number }).totalUsage
      : null;

  if (limit == null) {
    console.warn(
      quota == null
        ? '[line/quota] GET /v2/bot/message/quota failed (network error or non-2xx) — quota unreadable, failing open'
        : '[line/quota] GET /v2/bot/message/quota returned an unexpected shape (no numeric "value" — plan may report {"type":"none"}) — quota unreadable, failing open',
    );
  }
  if (used == null) {
    console.warn(
      consumption == null
        ? '[line/quota] GET /v2/bot/message/quota/consumption failed (network error or non-2xx) — quota unreadable, failing open'
        : '[line/quota] GET /v2/bot/message/quota/consumption returned an unexpected shape (no numeric "totalUsage") — quota unreadable, failing open',
    );
  }

  if (limit == null || used == null) return null;
  return { limit, used, remaining: limit - used };
}

/** Remaining sends this month, or null when it cannot be determined. */
export async function remainingQuota(): Promise<number | null> {
  return (await quotaSnapshot())?.remaining ?? null;
}

/** True when there is room to send. Unknown quota → true (fail open). */
export async function hasQuotaHeadroom(): Promise<boolean> {
  const remaining = await remainingQuota();
  if (remaining == null) return true;
  return remaining > QUOTA_RESERVE;
}

/**
 * True once consumption has reached QUOTA_WARN_RATIO of the plan's allowance.
 *
 * Pure so the threshold is testable without a LINE round-trip. A limit of 0
 * (or a nonsense negative) has no meaningful ratio — treat it as "no warning"
 * rather than dividing by zero and warning forever on NaN.
 */
export function isAtWarnThreshold(snapshot: QuotaSnapshot): boolean {
  if (snapshot.limit <= 0) return false;
  return snapshot.used / snapshot.limit >= QUOTA_WARN_RATIO;
}
