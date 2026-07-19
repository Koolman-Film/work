import { describe, expect, it, vi } from 'vitest';

// admin-daily-digest.ts pulls in pending-counts.ts, which does
// `import 'server-only'` — that throws under the default vitest config (no
// react-server condition / alias). Mock it to a no-op so this stays a plain
// unit test (same fix as smoke.test.ts / no-schedule.test.ts).
vi.mock('server-only', () => ({}));

import { shouldSendDigest } from './admin-daily-digest';

describe('shouldSendDigest', () => {
  it('skips when nothing is pending — silent days must cost nothing', () => {
    expect(shouldSendDigest({ leave: 0, advance: 0, attendance: 0 })).toBe(false);
  });

  it.each([
    ['leave only', { leave: 1, advance: 0, attendance: 0 }],
    ['advance only', { leave: 0, advance: 2, attendance: 0 }],
    ['disputes only', { leave: 0, advance: 0, attendance: 3 }],
  ])('sends when %s is pending', (_label, counts) => {
    expect(shouldSendDigest(counts)).toBe(true);
  });
});
