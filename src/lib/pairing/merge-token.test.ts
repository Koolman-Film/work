import { describe, expect, it } from 'vitest';
import { mintMergeToken, verifyMergeToken } from './token';

describe('merge token', () => {
  it('round-trips the admin and employee user ids', async () => {
    const { token, expiresAt } = await mintMergeToken('admin-123', 'emp-456');
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
    const { adminUserId, employeeUserId } = await verifyMergeToken(token);
    expect(adminUserId).toBe('admin-123');
    expect(employeeUserId).toBe('emp-456');
  });

  it('rejects an admin-pair-scoped token', async () => {
    const { mintAdminPairingToken } = await import('./token');
    const { token } = await mintAdminPairingToken('admin-123');
    await expect(verifyMergeToken(token)).rejects.toThrow();
  });
});
