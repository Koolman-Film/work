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
import { type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { useExitTransition } from '@/lib/motion/use-exit-transition';
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
  const titleId = useId();

  // Mount-through-exit: keep the panel/backdrop rendered for one
  // `--duration-base` after `open` flips false so the close transition can
  // play, instead of unmounting instantly. `entered` drives the actual
  // enter/exit classes below (via `data-open`) and is deliberately out of
  // step with `open` by one paint on the way in: the panel first mounts in
  // its "not entered" state (opacity-0/scale-98), then flips a frame later —
  // giving the transition a real style change to animate from. On the way
  // out it flips immediately since the panel is already on-screen with a
  // real "from" state to transition away from.
  const [rendered, setRendered] = useState(open);
  const [entered, setEntered] = useState(open);
  const { beginExit } = useExitTransition();
  // Read inside the exit timer's completion callback (not as an effect dep)
  // so a close-then-reopen within one `--duration-base` window can't let a
  // stale timer unmount a panel that has since reopened.
  const openRef = useRef(open);

  useEffect(() => {
    openRef.current = open;
  }, [open]);

  // Enter: mount immediately, then flip to "entered" a frame later.
  useEffect(() => {
    if (!open) return;
    setRendered(true);
    const raf = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(raf);
  }, [open]);

  // Exit: flip out of "entered" right away (the panel is already visible, so
  // there's a real style to transition from), then unmount once the exit
  // transition has had time to play.
  useEffect(() => {
    if (open || !rendered) return;
    setEntered(false);
    beginExit('dialog', () => {
      if (!openRef.current) setRendered(false);
    });
  }, [open, rendered, beginExit]);

  // Body-scroll lock + initial focus. Keyed on `open` ONLY — these must run
  // when the modal opens, never on subsequent re-renders. (Earlier this shared
  // an effect with the Esc handler below, whose `onClose`/`dismissable` deps
  // change identity on every parent render — e.g. a controlled note <textarea>
  // calling setState per keystroke. That re-ran `.focus()` on each keystroke
  // and yanked focus out of the field after one character.)
  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // Honor an explicit [data-autofocus] target first; otherwise fall back to
    // the first focusable control. (A bare querySelector list returns the first
    // match in DOM order, which would prefer an attachment link over the note
    // field it's meant to land on.)
    const panel = panelRef.current;
    const target =
      panel?.querySelector<HTMLElement>('[data-autofocus]') ??
      panel?.querySelector<HTMLElement>('button,textarea,input,select,a[href]');
    target?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  // Esc-to-close. Depends on the live `dismissable`/`onClose`, but registering
  // a keydown listener has no focus side effects, so re-subscribing when those
  // identities change is harmless.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && dismissable) onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, dismissable, onClose]);

  if (!open && !rendered) return null;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: backdrop is a decorative click-to-close target; keyboard dismissal is handled via the Esc listener above.
    <div
      data-open={entered ? 'true' : 'false'}
      className={cn(
        'fixed inset-0 z-50 flex items-end justify-center bg-ink-1/40 p-0 sm:items-center sm:p-4',
        'opacity-0 transition-opacity duration-[var(--duration-base)] ease-[var(--ease-out-soft)]',
        'data-[open=true]:opacity-100',
      )}
      onMouseDown={(e) => {
        // `open` guard: the backdrop lingers during the exit transition, so a
        // click landing in that window shouldn't re-fire onClose (the parent
        // has already been told to close).
        if (dismissable && open && e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        data-open={entered ? 'true' : 'false'}
        className={cn(
          // text-left is load-bearing: the panel is position:fixed but text-align
          // still INHERITS from the DOM parent — a dialog triggered from a
          // right-aligned context (e.g. a table's actions cell) would otherwise
          // render fully right-aligned.
          'relative w-full rounded-t-2xl bg-white p-5 text-left shadow-hero sm:max-w-md sm:rounded-2xl',
          'opacity-0 scale-[0.98] transition-[opacity,transform] duration-[var(--duration-base)] ease-[var(--ease-out-soft)]',
          'data-[open=true]:scale-100 data-[open=true]:opacity-100',
          className,
        )}
      >
        {title && (
          <h3 id={titleId} className="h-page pr-8 text-lg text-ink-1">
            {title}
          </h3>
        )}
        {children}
        {/* Close button — rendered last so focus-on-open still lands on the
            first meaningful control, not the X. Hidden while non-dismissable
            (e.g. a mutation is pending), matching Esc/backdrop behavior. */}
        {dismissable && (
          <button
            type="button"
            onClick={() => {
              // Same double-fire guard as the backdrop: don't re-fire onClose
              // while the panel is only lingering to finish its exit.
              if (open) onClose();
            }}
            aria-label="ปิด"
            className="absolute right-3 top-3 inline-flex size-8 items-center justify-center rounded-lg text-ink-4 transition hover:bg-gray-100 hover:text-ink-2"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
