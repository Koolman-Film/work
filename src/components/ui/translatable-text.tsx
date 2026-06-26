'use client';

/**
 * <TranslatableText> — renders a free-text value (a leave reason, a void
 * reason, a review note…) that staff may have written in their native
 * language, with a "แปลเป็นไทย" button that translates it to Thai on demand.
 *
 * Display = SHOW BOTH: the original text always stays visible; the Thai
 * translation is appended below with a "แปลโดย Google" caption so the admin
 * can cross-check (machine translation isn't perfect). The first translation
 * of a given text is cached server-side, so reopening is instant and free.
 *
 * Reusable across the app — it only needs `text`. The translateText action
 * it calls is gated to authenticated users.
 */

import { useState, useTransition } from 'react';
import { translateText } from '@/lib/translate/actions';
import { cn } from '@/lib/utils';
import { isAlreadyTarget, languageNameTh } from './translatable-text.helpers';

type State =
  | { kind: 'idle' }
  | { kind: 'done'; text: string; detectedSourceLang: string }
  | { kind: 'error' };

export function TranslatableText({
  text,
  targetLang = 'th',
  className,
}: {
  text: string;
  targetLang?: string;
  className?: string;
}) {
  const [state, setState] = useState<State>({ kind: 'idle' });
  const [pending, startTransition] = useTransition();

  // Nothing to translate — render the (empty) text as-is, no control.
  const hasText = text.trim().length > 0;

  function run() {
    setState({ kind: 'idle' });
    startTransition(async () => {
      try {
        const res = await translateText(text, targetLang);
        setState({
          kind: 'done',
          text: res.translatedText,
          detectedSourceLang: res.detectedSourceLang,
        });
      } catch {
        setState({ kind: 'error' });
      }
    });
  }

  return (
    <div className={className}>
      <p className="whitespace-pre-wrap text-sm text-ink-2">{text}</p>

      {hasText && state.kind !== 'done' && (
        <button
          type="button"
          onClick={run}
          disabled={pending}
          className={cn(
            'mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-primary-600',
            'hover:text-primary-700 hover:underline disabled:opacity-60 disabled:no-underline',
          )}
        >
          {pending ? (
            <>
              <Spinner /> กำลังแปล…
            </>
          ) : state.kind === 'error' ? (
            'แปลไม่สำเร็จ — ลองใหม่'
          ) : (
            '🌐 แปลเป็นไทย'
          )}
        </button>
      )}

      {state.kind === 'done' &&
        (isAlreadyTarget(state.detectedSourceLang, targetLang) ? (
          <p className="mt-1.5 text-xs text-ink-4">ข้อความเป็นภาษาไทยอยู่แล้ว</p>
        ) : (
          <div className="mt-2 rounded-md border border-primary-100 bg-primary-50/50 px-3 py-2">
            <p className="whitespace-pre-wrap text-sm text-ink-1">{state.text}</p>
            <p className="mt-1 text-[11px] text-ink-4">
              แปลโดย Google
              {state.detectedSourceLang && ` · จากภาษา${languageNameTh(state.detectedSourceLang)}`}
            </p>
          </div>
        ))}
    </div>
  );
}

function Spinner() {
  return (
    <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}
