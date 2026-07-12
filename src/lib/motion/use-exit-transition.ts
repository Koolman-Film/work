'use client';
import { useState, useSyncExternalStore } from 'react';
import { createExitController } from './exit-controller';

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

export function useExitTransition(opts?: { durationMs?: number; reducedMotion?: boolean }) {
  // useState initializer → the controller is created exactly once per mount;
  // options are read at mount only (no re-creation on re-render, which would
  // drop in-flight exit timers). This is why it's not useMemo([...deps]).
  const [controller] = useState(() =>
    createExitController({
      durationMs: opts?.durationMs,
      reducedMotion: opts?.reducedMotion ?? prefersReducedMotion(),
    }),
  );
  useSyncExternalStore(controller.subscribe, controller.version, controller.version);
  return {
    isExiting: controller.isExiting,
    beginExit: controller.beginExit,
    exitingKeys: controller.exitingKeys,
  };
}
