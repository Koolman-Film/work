import { type ReplayEntitlement, type ReplayResult, replayOverQuota } from './over-quota';

export type RippleRequest = {
  id: string;
  /** Frozen at approval; a type change does not alter it. */
  chargedMinutes: number;
  /** reviewedAt ?? createdAt, in ms — the replay ordering key. */
  reviewedAtMs: number;
  /** Swept into a published payroll → frozen, never rewritten. */
  swept: boolean;
  curOverQuotaMinutes: number;
  curDeductAmount: number | null;
};

export type RippleInput = {
  movedRequestId: string;
  /** All current requests of (employee, OLD type, year), INCLUDING the moved one. */
  oldGroup: RippleRequest[];
  /** All current requests of (employee, NEW type, year), EXCLUDING the moved one. */
  newGroup: RippleRequest[];
  oldEnt: ReplayEntitlement;
  newEnt: ReplayEntitlement;
  ratePerMin: number;
};

export type RippleRow = {
  leaveRequestId: string;
  group: 'moved' | 'old' | 'new';
  oldOverQuotaMinutes: number;
  newOverQuotaMinutes: number;
  oldDeduct: number | null;
  newDeduct: number | null;
};

export type CorrectionRipple = {
  /** The corrected request's new values — ALWAYS applied (its type changes even if money doesn't). */
  moved: { leaveRequestId: string; overQuotaMinutes: number; deductAmount: number | null };
  /** Unswept siblings in either group whose value changed — to persist. */
  siblingWrites: Array<{ id: string; overQuotaMinutes: number; deductAmount: number | null }>;
  /** Moved + every changed sibling, for the admin preview. */
  displayRows: RippleRow[];
  /** Sum of (newDeduct − oldDeduct) over the moved request and all rewritten siblings. */
  netDeductDelta: number;
};

/** Replay a group, then override swept rows back to their frozen value (they
 *  still consumed quota in the walk, but their stored value must not move). */
function replayKeepingSwept(
  ent: ReplayEntitlement,
  group: RippleRequest[],
  ratePerMin: number,
): Map<string, { over: number; deduct: number | null }> {
  const ordered = [...group].sort((a, b) => a.reviewedAtMs - b.reviewedAtMs);
  const replayed: ReplayResult[] = replayOverQuota(
    ent,
    ordered.map((r) => ({ id: r.id, chargedMinutes: r.chargedMinutes })),
    ratePerMin,
  );
  const out = new Map<string, { over: number; deduct: number | null }>();
  const sweptById = new Map(group.map((r) => [r.id, r]));
  for (const r of replayed) {
    const src = sweptById.get(r.id);
    if (src?.swept) {
      out.set(r.id, { over: src.curOverQuotaMinutes, deduct: src.curDeductAmount });
    } else {
      out.set(r.id, { over: r.overQuotaMinutes, deduct: r.deductAmount });
    }
  }
  return out;
}

export function computeCorrectionRipple(input: RippleInput): CorrectionRipple {
  const { movedRequestId, oldGroup, newGroup, oldEnt, newEnt, ratePerMin } = input;
  const moved = oldGroup.find((r) => r.id === movedRequestId);
  if (!moved) throw new Error(`moved request ${movedRequestId} not in oldGroup`);

  const oldAfter = replayKeepingSwept(
    oldEnt,
    oldGroup.filter((r) => r.id !== movedRequestId),
    ratePerMin,
  );
  const newAfter = replayKeepingSwept(newEnt, [...newGroup, moved], ratePerMin);

  const movedNew = newAfter.get(movedRequestId)!;
  const displayRows: RippleRow[] = [];
  const siblingWrites: CorrectionRipple['siblingWrites'] = [];
  let netDeductDelta = 0;

  // Moved row — always in the write set (its type changes regardless of money).
  displayRows.push({
    leaveRequestId: movedRequestId,
    group: 'moved',
    oldOverQuotaMinutes: moved.curOverQuotaMinutes,
    newOverQuotaMinutes: movedNew.over,
    oldDeduct: moved.curDeductAmount,
    newDeduct: movedNew.deduct,
  });
  netDeductDelta += (movedNew.deduct ?? 0) - (moved.curDeductAmount ?? 0);

  const collect = (
    group: RippleRequest[],
    after: Map<string, { over: number; deduct: number | null }>,
    tag: 'old' | 'new',
  ) => {
    for (const r of group) {
      if (r.id === movedRequestId) continue;
      const a = after.get(r.id)!;
      const changed = a.over !== r.curOverQuotaMinutes || a.deduct !== r.curDeductAmount;
      displayRows.push({
        leaveRequestId: r.id,
        group: tag,
        oldOverQuotaMinutes: r.curOverQuotaMinutes,
        newOverQuotaMinutes: a.over,
        oldDeduct: r.curDeductAmount,
        newDeduct: a.deduct,
      });
      if (!changed) continue;
      if (!r.swept) {
        siblingWrites.push({ id: r.id, overQuotaMinutes: a.over, deductAmount: a.deduct });
        netDeductDelta += (a.deduct ?? 0) - (r.curDeductAmount ?? 0);
      }
    }
  };
  collect(oldGroup, oldAfter, 'old');
  collect(newGroup, newAfter, 'new');

  return {
    moved: {
      leaveRequestId: movedRequestId,
      overQuotaMinutes: movedNew.over,
      deductAmount: movedNew.deduct,
    },
    siblingWrites,
    displayRows,
    netDeductDelta,
  };
}
