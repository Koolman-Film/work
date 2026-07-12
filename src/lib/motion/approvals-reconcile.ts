/**
 * Reconcile the client-owned approvals list against a fresh server `incoming`
 * prop. `removed` = keys already fully removed (their exit finished); `exiting`
 * = keys mid-collapse. Removals are authoritative (never resurrected), and a
 * mid-exit row is preserved even if the server already dropped it so a
 * background refresh can't cancel its animation.
 */
export function reconcileApprovals<T>(
  prev: readonly T[],
  incoming: readonly T[],
  removed: ReadonlySet<string>,
  exiting: ReadonlySet<string>,
  keyOf: (item: T) => string,
): T[] {
  const kept = incoming.filter((i) => !removed.has(keyOf(i)));
  const keptKeys = new Set(kept.map(keyOf));
  const stillExiting = prev.filter((p) => {
    const k = keyOf(p);
    return exiting.has(k) && !removed.has(k) && !keptKeys.has(k);
  });
  return [...kept, ...stillExiting];
}
