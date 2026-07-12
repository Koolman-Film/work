import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createExitController } from './exit-controller';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('createExitController', () => {
  it('marks a key exiting, then fires onDone after durationMs and un-marks', () => {
    const ctl = createExitController({ durationMs: 200 });
    const done = vi.fn();
    ctl.beginExit('a', done);
    expect(ctl.isExiting('a')).toBe(true);
    expect(done).not.toHaveBeenCalled();
    vi.advanceTimersByTime(200);
    expect(done).toHaveBeenCalledOnce();
    expect(ctl.isExiting('a')).toBe(false);
  });
  it('ignores a repeat beginExit for an already-exiting key', () => {
    const ctl = createExitController({ durationMs: 200 });
    const d1 = vi.fn();
    const d2 = vi.fn();
    ctl.beginExit('a', d1);
    ctl.beginExit('a', d2);
    vi.advanceTimersByTime(200);
    expect(d1).toHaveBeenCalledOnce();
    expect(d2).not.toHaveBeenCalled();
  });
  it('fires onDone synchronously when reducedMotion is true', () => {
    const ctl = createExitController({ durationMs: 200, reducedMotion: true });
    const done = vi.fn();
    ctl.beginExit('a', done);
    expect(done).toHaveBeenCalledOnce();
    expect(ctl.isExiting('a')).toBe(false);
  });
  it('notifies subscribers and bumps version on state change', () => {
    const ctl = createExitController({ durationMs: 200 });
    const cb = vi.fn();
    ctl.subscribe(cb);
    const v0 = ctl.version();
    ctl.beginExit('a', () => {});
    expect(cb).toHaveBeenCalled();
    expect(ctl.version()).not.toBe(v0);
  });
});
