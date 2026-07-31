import { describe, expect, it } from 'vitest';
import { forEachWithConcurrency } from './pool';

/**
 * Deterministic by construction: every worker blocks on a deferred this test
 * resolves by hand, so "how many ran at once" is observed rather than timed.
 * No sleeps, so no flakiness on a loaded CI box.
 */
function deferred() {
  let resolve!: () => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('forEachWithConcurrency', () => {
  it('never runs more than `limit` workers at once', async () => {
    const items = [0, 1, 2, 3, 4, 5, 6, 7];
    const gates = items.map(() => deferred());
    let inFlight = 0;
    let peak = 0;
    const started: number[] = [];

    const run = forEachWithConcurrency(items, 3, async (item) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      started.push(item);
      await gates[item]!.promise;
      inFlight--;
    });

    // Let the lanes start. Only `limit` may be running.
    await Promise.resolve();
    expect(started).toEqual([0, 1, 2]);
    expect(peak).toBe(3);

    // Release one; exactly one more should take its place.
    gates[0]?.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(started).toEqual([0, 1, 2, 3]);

    for (const g of gates) g.resolve();
    await run;

    expect(peak).toBe(3);
    expect(started.sort((a, b) => a - b)).toEqual(items);
  });

  it('processes every item exactly once', async () => {
    const items = Array.from({ length: 50 }, (_, i) => i);
    const seen: number[] = [];

    await forEachWithConcurrency(items, 4, async (item) => {
      seen.push(item);
    });

    expect(seen).toHaveLength(50);
    expect(new Set(seen).size).toBe(50);
  });

  it('a slow item does not idle the other lanes', async () => {
    // Item 0 blocks forever until released; the rest must still finish.
    const slow = deferred();
    const done: number[] = [];

    const run = forEachWithConcurrency([0, 1, 2, 3, 4], 2, async (item) => {
      if (item === 0) await slow.promise;
      done.push(item);
    });

    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // Lane 2 drained 1..4 while lane 1 sat on the slow item.
    expect(done).not.toContain(0);
    expect(done.length).toBeGreaterThan(1);

    slow.resolve();
    await run;
    expect(done.sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4]);
  });

  it('caps lanes at the item count rather than the limit', async () => {
    let peak = 0;
    let inFlight = 0;

    await forEachWithConcurrency([1, 2], 10, async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await Promise.resolve();
      inFlight--;
    });

    expect(peak).toBeLessThanOrEqual(2);
  });

  it('does nothing for an empty list', async () => {
    let calls = 0;
    await forEachWithConcurrency([], 4, async () => {
      calls++;
    });
    expect(calls).toBe(0);
  });

  it('rejects a limit below 1 rather than hanging', async () => {
    await expect(forEachWithConcurrency([1], 0, async () => {})).rejects.toThrow(RangeError);
  });

  it('propagates a worker rejection', async () => {
    await expect(
      forEachWithConcurrency([1, 2, 3], 2, async (item) => {
        if (item === 2) throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
  });
});
