/**
 * Run an async worker over a list with a bounded number in flight.
 *
 * `Promise.all(items.map(worker))` starts everything at once, which for
 * Chromium page renders means N browser tabs and an out-of-memory kill. A
 * sequential `for` loop is safe but pays the full latency of every item in
 * series. This is the middle: `limit` workers pulling from a shared cursor,
 * so a slow item never blocks the others and memory stays bounded.
 *
 * Rejections propagate — the first failure rejects the returned promise and
 * remaining items are not started. Callers wanting best-effort semantics
 * should catch inside `worker`, which is what the payslip warm does so one
 * unrenderable slip cannot abandon the rest of the batch.
 */
export async function forEachWithConcurrency<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  if (items.length === 0) return;
  if (limit < 1) throw new RangeError(`concurrency limit must be >= 1, got ${limit}`);

  // Shared cursor: each worker takes the next index rather than owning a
  // fixed slice, so one slow item doesn't idle a lane while work remains.
  let cursor = 0;
  const lanes = Math.min(limit, items.length);

  async function lane(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor++;
      await worker(items[index]!, index);
    }
  }

  await Promise.all(Array.from({ length: lanes }, lane));
}
