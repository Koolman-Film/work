export type ExitController = {
  beginExit(key: string, onDone: () => void): void;
  isExiting(key: string): boolean;
  exitingKeys(): ReadonlySet<string>;
  subscribe(cb: () => void): () => void;
  version(): number;
};

export function createExitController(opts?: {
  durationMs?: number;
  reducedMotion?: boolean;
}): ExitController {
  const durationMs = opts?.durationMs ?? 200;
  const reduced = opts?.reducedMotion ?? false;
  const exiting = new Set<string>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const subs = new Set<() => void>();
  let ver = 0;
  const emit = () => {
    ver += 1;
    for (const cb of subs) cb();
  };
  return {
    beginExit(key, onDone) {
      if (timers.has(key)) return;
      if (reduced) {
        onDone();
        return;
      }
      exiting.add(key);
      emit();
      const t = setTimeout(() => {
        timers.delete(key);
        exiting.delete(key);
        emit();
        onDone();
      }, durationMs);
      timers.set(key, t);
    },
    isExiting: (key) => exiting.has(key),
    exitingKeys: () => exiting,
    subscribe(cb) {
      subs.add(cb);
      return () => {
        subs.delete(cb);
      };
    },
    version: () => ver,
  };
}
