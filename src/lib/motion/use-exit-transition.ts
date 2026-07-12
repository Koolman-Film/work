'use client';
import { useMemo, useSyncExternalStore } from 'react';
import { createExitController } from './exit-controller';

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

export function useExitTransition(opts?: { durationMs?: number; reducedMotion?: boolean }) {
  const controller = useMemo(
    () =>
      createExitController({
        durationMs: opts?.durationMs,
        reducedMotion: opts?.reducedMotion ?? prefersReducedMotion(),
      }),
    // stable per mount — options are read once
    [],
  );
  useSyncExternalStore(controller.subscribe, controller.version, controller.version);
  return {
    isExiting: controller.isExiting,
    beginExit: controller.beginExit,
    exitingKeys: controller.exitingKeys,
  };
}
