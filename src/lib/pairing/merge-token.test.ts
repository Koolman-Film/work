import { describe, expect, it } from 'vitest';
import { mintMergeToken, verifyMergeToken } from './token';

describe('merge token', () => {
  it('round-trips the admin user id', async () => {
    const { token, expiresAt } = await mintMergeToken('admin-123');
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
    const { adminUserId } = await verifyMergeToken(token);
    expect(adminUserId).toBe('admin-123');
  });

  it('rejects an admin-pair-scoped token', async () => {
    const { mintAdminPairingToken } = await import('./token');
    const { token } = await mintAdminPairingToken('admin-123');
    await expect(verifyMergeToken(token)).rejects.toThrow();
  });
});
