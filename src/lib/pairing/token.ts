/**
 * LINE-link pairing tokens.
 *
 * Flow (architecture.md §4.1, W3-bound):
 *   1. Admin clicks "ส่งลิงก์ LINE" on /admin/employees/[id]/edit (W2c — here)
 *   2. Server generates a short JWT (scope='employee-pair', sub=employeeId,
 *      24h TTL) using HS256 + PAIRING_JWT_SECRET. Stores token + expiry
 *      on Employee.inviteToken / inviteExpiresAt (single-use).
 *   3. Returns a shareable URL (https://hr.koolman.co/i/<token>) and a
 *      base64-PNG QR code. Admin shares via any channel.
 *   4. Employee opens the URL on a phone → /i/[token] redirects into
 *      LIFF with the token in the query string. (W3 builds /i/[token]
 *      and the LIFF pairing UI.)
 *   5. LIFF calls signInWithIdToken (LINE OIDC) → Supabase session created
 *      → linkLineToEmployee Server Action validates the JWT, looks up
 *      Employee by sub, binds User.authUserId to the session user.
 *
 * Why HS256 (symmetric) instead of RS256:
 *   - We're both issuer and verifier (single-secret world). No need for
 *     asymmetric keys with the operational overhead of keypair management.
 *   - HS256 sign+verify is ~10× faster than RS256 — non-trivial when
 *     admins batch-create employees.
 */

import { jwtVerify, SignJWT } from 'jose';

const SCOPE = 'employee-pair';
const ISSUER = 'koolman-work';
const AUDIENCE = 'pair';
const TTL_SECONDS = 24 * 60 * 60; // 24 hours

function getSecret(): Uint8Array {
  const raw = process.env.PAIRING_JWT_SECRET;
  if (!raw || raw.length < 32) {
    throw new Error('PAIRING_JWT_SECRET missing or too short (need ≥32 chars; rotate via env)');
  }
  return new TextEncoder().encode(raw);
}

export type PairingPayload = {
  /** Employee.id this token grants linking authority for */
  employeeId: string;
  /** ISO timestamp when token was issued */
  iat: number;
  /** ISO timestamp when token expires */
  exp: number;
};

/**
 * Mint a fresh pairing token for an Employee. Returns the JWT string and
 * the expiration Date (caller persists both onto Employee.inviteToken /
 * inviteExpiresAt).
 */
export async function mintPairingToken(employeeId: string): Promise<{
  token: string;
  expiresAt: Date;
}> {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + TTL_SECONDS;

  const token = await new SignJWT({ scope: SCOPE })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setSubject(employeeId)
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .sign(getSecret());

  return { token, expiresAt: new Date(exp * 1000) };
}

/**
 * Verify a pairing token. Throws on any failure (invalid signature, wrong
 * scope/issuer/aud, expired). Returns the parsed payload on success.
 *
 * This is the cryptographic check — it does NOT confirm single-use status.
 * The caller (linkLineToEmployee) must also check that
 * Employee.inviteToken === this token before binding, then null the field
 * to prevent replay.
 */
export async function verifyPairingToken(token: string): Promise<PairingPayload> {
  const { payload } = await jwtVerify(token, getSecret(), {
    issuer: ISSUER,
    audience: AUDIENCE,
    algorithms: ['HS256'],
  });

  if (payload.scope !== SCOPE) {
    throw new Error('Wrong token scope');
  }
  if (typeof payload.sub !== 'string') {
    throw new Error('Missing sub claim');
  }
  if (typeof payload.iat !== 'number' || typeof payload.exp !== 'number') {
    throw new Error('Missing iat/exp claims');
  }

  return {
    employeeId: payload.sub,
    iat: payload.iat,
    exp: payload.exp,
  };
}
