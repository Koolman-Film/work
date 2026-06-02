'use client';

/**
 * Accessible modal primitive (Sapphire Editorial).
 *
 * - Bottom-sheet on mobile (`<sm`), centered card on `≥sm` — matches the
 *   mockups and keeps the primary action thumb-reachable on phones.
 * - Esc to close, click-backdrop to close (both opt-out via `dismissable`),
 *   body-scroll lock, and focus moved into the panel on open.
 *
 * Controlled: render it always and drive with `open` / `onClose`. Composed by
 * ConfirmDialog and the mobile FilterBar sheet.
 */
import { type ReactNode, useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';

type Props = {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  /** When false, Esc and backdrop-click won't close (e.g. mutation pending). */
  dismissable?: boolean;
  className?: string;
};

export function Dialog({ open, onClose, title, children, dismissable = true, className }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // Move focus into the panel (first focusable, else the panel itself).
    panelRef.current
      ?.querySelector<HTMLElement>('[data-autofocus],button,textarea,input,select,a[href]')
      ?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && dismissable) onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [open, dismissable, onClose]);

  if (!open) return null;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: backdrop is a decorative click-to-close target; keyboard dismissal is handled via the Esc listener above.
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink-1/40 p-0 sm:items-center sm:p-4"
      onMouseDown={(e) => {
        if (dismissable && e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        className={cn(
          'w-full rounded-t-2xl bg-white p-5 shadow-hero sm:max-w-md sm:rounded-2xl',
          className,
        )}
      >
        {title && <h3 className="h-page text-lg text-ink-1">{title}</h3>}
        {children}
      </div>
    </div>
  );
}
