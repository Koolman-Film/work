import { describe, expect, it, vi } from 'vitest';

// query.ts does `import 'server-only'`, which throws under the default
// vitest config (no react-server condition / alias). Mock it to a no-op so
// this stays a plain unit test. (The integration config aliases it instead.)
vi.mock('server-only', () => ({}));

import { buildAuditWhere, resolveActors } from './query';

describe('buildAuditWhere', () => {
  it('returns an empty where for no filters', () => {
    expect(buildAuditWhere({})).toEqual({});
  });
  it('filters by actor, action, entityType, entityId', () => {
    expect(
      buildAuditWhere({
        actor: '11111111-1111-4111-8111-111111111111',
        action: 'payroll.publish',
        entityType: 'Payroll',
        entityId: '22222222-2222-4222-8222-222222222222',
      }),
    ).toEqual({
      actorId: '11111111-1111-4111-8111-111111111111',
      action: 'payroll.publish',
      entityType: 'Payroll',
      entityId: '22222222-2222-4222-8222-222222222222',
    });
  });
  it('builds an inclusive Bangkok-day createdAt range', () => {
    const where = buildAuditWhere({ dateFrom: '2026-06-01', dateTo: '2026-06-30' });
    expect(where.createdAt).toEqual({
      gte: new Date('2026-06-01T00:00:00+07:00'),
      lte: new Date('2026-06-30T23:59:59.999+07:00'),
    });
  });
  it('supports an open-ended (from-only) range', () => {
    const where = buildAuditWhere({ dateFrom: '2026-06-01' });
    expect(where.createdAt).toEqual({ gte: new Date('2026-06-01T00:00:00+07:00') });
  });
  it('ignores blank strings', () => {
    expect(buildAuditWhere({ actor: '', action: '   ' })).toEqual({});
  });
  it('drops malformed actor and entityId (treated as unset)', () => {
    expect(buildAuditWhere({ actor: 'not-a-uuid', entityId: 'abc' })).toEqual({});
  });
  it('keeps a valid uuid actor', () => {
    expect(buildAuditWhere({ actor: '11111111-1111-4111-8111-111111111111' })).toEqual({
      actorId: '11111111-1111-4111-8111-111111111111',
    });
  });
  it('drops an invalid dateFrom (treated as unset, no createdAt)', () => {
    expect(buildAuditWhere({ dateFrom: 'garbage' })).toEqual({});
  });
});

describe('resolveActors', () => {
  it('returns an empty map for empty input without touching the DB', async () => {
    expect(await resolveActors([])).toEqual(new Map());
  });
});
