import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import { mintPairingToken, verifyPairingToken } from './token';

const TEST_EMPLOYEE_ID = '00000000-0000-4000-8000-000000000001';

const secret = new TextEncoder().encode(
  process.env.PAIRING_JWT_SECRET ?? 'test-only-deterministic-secret-32chars+',
);

describe('mintPairingToken', () => {
  it('round-trips: mint → verify produces the original employeeId', async () => {
    const { token } = await mintPairingToken(TEST_EMPLOYEE_ID);
    const payload = await verifyPairingToken(token);
    expect(payload.employeeId).toBe(TEST_EMPLOYEE_ID);
  });

  it('returns an expiresAt 24h from now', async () => {
    const before = Date.now();
    const { expiresAt } = await mintPairingToken(TEST_EMPLOYEE_ID);
    const after = Date.now();

    const expectedMin = before + 24 * 60 * 60 * 1000 - 1000; // -1s slack
    const expectedMax = after + 24 * 60 * 60 * 1000 + 1000; //  +1s slack
    expect(expiresAt.getTime()).toBeGreaterThanOrEqual(expectedMin);
    expect(expiresAt.getTime()).toBeLessThanOrEqual(expectedMax);
  });

  it('issues distinct tokens for distinct employees', async () => {
    const a = await mintPairingToken(TEST_EMPLOYEE_ID);
    const b = await mintPairingToken('00000000-0000-4000-8000-000000000002');
    expect(a.token).not.toBe(b.token);
  });
});

describe('verifyPairingToken — rejects malformed tokens', () => {
  it('rejects an obviously bogus string', async () => {
    await expect(verifyPairingToken('not-a-jwt')).rejects.toThrow();
  });

  it('rejects an empty string', async () => {
    await expect(verifyPairingToken('')).rejects.toThrow();
  });

  it('rejects a token signed with a different secret (tamper-resistance)', async () => {
    const wrongSecret = new TextEncoder().encode('wrong-secret-also-32-chars-long-xxx-yz');
    const evilToken = await new SignJWT({ scope: 'employee-pair' })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuer('koolman-hr')
      .setAudience('pair')
      .setSubject(TEST_EMPLOYEE_ID)
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(wrongSecret);

    await expect(verifyPairingToken(evilToken)).rejects.toThrow();
  });
});

describe('verifyPairingToken — rejects misused tokens', () => {
  it('rejects a token with the wrong scope', async () => {
    // E.g. attacker tries to reuse a Supabase session token as a pairing token
    const wrongScope = await new SignJWT({ scope: 'session' })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuer('koolman-hr')
      .setAudience('pair')
      .setSubject(TEST_EMPLOYEE_ID)
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(secret);

    await expect(verifyPairingToken(wrongScope)).rejects.toThrow();
  });

  it('rejects a token with the wrong issuer', async () => {
    const wrongIssuer = await new SignJWT({ scope: 'employee-pair' })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuer('attacker.example.com')
      .setAudience('pair')
      .setSubject(TEST_EMPLOYEE_ID)
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(secret);

    await expect(verifyPairingToken(wrongIssuer)).rejects.toThrow();
  });

  it('rejects a token with the wrong audience', async () => {
    const wrongAud = await new SignJWT({ scope: 'employee-pair' })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuer('koolman-hr')
      .setAudience('not-pair')
      .setSubject(TEST_EMPLOYEE_ID)
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(secret);

    await expect(verifyPairingToken(wrongAud)).rejects.toThrow();
  });

  it('rejects an expired token', async () => {
    const expired = await new SignJWT({ scope: 'employee-pair' })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuer('koolman-hr')
      .setAudience('pair')
      .setSubject(TEST_EMPLOYEE_ID)
      .setIssuedAt(Math.floor(Date.now() / 1000) - 7200) // 2h ago
      .setExpirationTime(Math.floor(Date.now() / 1000) - 3600) // expired 1h ago
      .sign(secret);

    await expect(verifyPairingToken(expired)).rejects.toThrow();
  });

  it('rejects a token without sub claim', async () => {
    const noSub = await new SignJWT({ scope: 'employee-pair' })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuer('koolman-hr')
      .setAudience('pair')
      // no setSubject()
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(secret);

    await expect(verifyPairingToken(noSub)).rejects.toThrow();
  });
});

describe('verifyPairingToken — algorithm pinning', () => {
  it('rejects a token signed with HS512 (algorithm confusion defense)', async () => {
    // jose's verify pins HS256 in our config; a HS512-signed token must fail
    // even if the secret is correct, preventing alg=none style attacks.
    const hs512 = await new SignJWT({ scope: 'employee-pair' })
      .setProtectedHeader({ alg: 'HS512', typ: 'JWT' })
      .setIssuer('koolman-hr')
      .setAudience('pair')
      .setSubject(TEST_EMPLOYEE_ID)
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(secret);

    await expect(verifyPairingToken(hs512)).rejects.toThrow();
  });
});
