'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Toast, type ToastVariant } from '@/components/ui/toast';
import { useExitTransition } from '@/lib/motion/use-exit-transition';

type ToastItem = {
  id: string;
  message: string;
  variant: ToastVariant;
};

type ToastContextValue = {
  toast(message: string, variant?: ToastVariant): void;
};

const AUTO_DISMISS_MS = 3000;

const ToastContext = createContext<ToastContextValue | null>(null);

/**
 * Renders `children` plus a fixed toast stack. Any client component under
 * this provider can call `useToast().toast(message, variant)` to enqueue a
 * toast; it auto-dismisses after 3s, running its exit through Task 2's
 * `useExitTransition` (instant under reduced motion, animated otherwise).
 *
 * IDs come from a monotonic `useRef(0)` counter — not `Math.random()` /
 * `Date.now()` — so server/client renders never diverge (hydration-safe).
 */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [queue, setQueue] = useState<ToastItem[]>([]);
  const nextId = useRef(0);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const { isExiting, beginExit } = useExitTransition();

  const removeFromQueue = useCallback((id: string) => {
    setQueue((q) => q.filter((t) => t.id !== id));
  }, []);

  const dismiss = useCallback(
    (id: string) => {
      timers.current.delete(id);
      beginExit(id, () => removeFromQueue(id));
    },
    [beginExit, removeFromQueue],
  );

  const toast = useCallback(
    (message: string, variant: ToastVariant = 'neutral') => {
      nextId.current += 1;
      const id = `toast-${nextId.current}`;
      setQueue((q) => [...q, { id, message, variant }]);
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), AUTO_DISMISS_MS),
      );
    },
    [dismiss],
  );

  // Clear any pending auto-dismiss timers if the provider unmounts mid-flight.
  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const t of pending.values()) clearTimeout(t);
      pending.clear();
    };
  }, []);

  const value = useMemo<ToastContextValue>(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="fixed inset-x-4 bottom-4 z-[60] flex flex-col gap-2 sm:inset-x-auto sm:right-4 sm:w-96">
        {queue.map((item) => (
          <Toast key={item.id} variant={item.variant} exiting={isExiting(item.id)}>
            {item.message}
          </Toast>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return ctx;
}
