'use client';

import { useRef } from 'react';
import { cn } from '@/lib/utils';

/**
 * Dashed upload affordance (receipt / medical cert). Presentational trigger
 * only — it surfaces the file via `onFile`; the actual upload pipeline (Supabase
 * Storage server action) stays where it already lives. Shows `fileName` once a
 * file is chosen.
 */
export function Dropzone({
  label,
  hint,
  accept,
  onFile,
  fileName,
  className,
}: {
  label: string;
  hint?: string;
  accept?: string;
  onFile?: (file: File) => void;
  fileName?: string;
  className?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <button
      type="button"
      onClick={() => inputRef.current?.click()}
      className={cn(
        'flex w-full flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-[var(--border-strong)] bg-gray-50/50 px-3 py-4 text-center transition hover:bg-gray-50',
        className,
      )}
    >
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        className="text-ink-4"
        aria-hidden="true"
      >
        <path d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
      </svg>
      <span className="font-display text-[11px] font-medium text-ink-2">{fileName ?? label}</span>
      {hint && <span className="text-[10px] text-ink-4">{hint}</span>}
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f && onFile) onFile(f);
        }}
      />
    </button>
  );
}
