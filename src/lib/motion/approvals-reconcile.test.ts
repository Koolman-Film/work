import { describe, expect, it } from 'vitest';
import { reconcileApprovals } from './approvals-reconcile';

type Card = { type: string; id: string };
const c = (id: string): Card => ({ type: 't', id });
const keyOf = (x: Card) => `${x.type}:${x.id}`;
const keys = (xs: Card[]) => xs.map(keyOf);
const NONE = new Set<string>();

describe('reconcileApprovals', () => {
  it('passes through incoming when nothing removed/exiting', () => {
    expect(keys(reconcileApprovals([c('a'), c('b')], [c('a'), c('b')], NONE, NONE, keyOf))).toEqual(
      ['t:a', 't:b'],
    );
  });
  it('drops a removed key even if the server prop still includes it (stale)', () => {
    expect(
      keys(reconcileApprovals([c('a'), c('b')], [c('a'), c('b')], new Set(['t:b']), NONE, keyOf)),
    ).toEqual(['t:a']);
  });
  it('adds a genuinely-new incoming key', () => {
    expect(keys(reconcileApprovals([c('a')], [c('a'), c('d')], NONE, NONE, keyOf))).toEqual([
      't:a',
      't:d',
    ]);
  });
  it('never resurrects a removed key that reappears in incoming', () => {
    expect(keys(reconcileApprovals([], [c('b')], new Set(['t:b']), NONE, keyOf))).toEqual([]);
  });
  it('preserves a mid-exit row the server prop already dropped', () => {
    // b is exiting (not yet removed); server refresh no longer lists it → keep it until its collapse finishes.
    expect(
      keys(reconcileApprovals([c('a'), c('b')], [c('a')], NONE, new Set(['t:b']), keyOf)),
    ).toEqual(['t:a', 't:b']);
  });
});
