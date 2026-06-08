'use client';

import { type KeyboardEvent, useEffect, useRef, useState } from 'react';
import type { GeoResult } from '@/lib/geo/nominatim';

/**
 * Address/place search for the geofence picker.
 *
 * Type a query → Enter or click ค้นหา → fetch /api/geocode (server proxy to
 * Nominatim) → dropdown of matches → click one → onSelect(lat, lng). The
 * parent picker feeds onSelect into its existing syncFromMap + map.setView.
 *
 * IMPORTANT: this renders inside the branch <form>. Pressing Enter must NOT
 * submit that form, so the input intercepts Enter with preventDefault and the
 * trigger is a type="button" (never a submit).
 */

type Props = {
  /** Called when the admin picks a match — feeds the picker's syncFromMap. */
  onSelect: (lat: number, lng: number) => void;
};

type Status = 'idle' | 'loading' | 'error';

export function GeofenceSearch({ onSelect }: Props) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [results, setResults] = useState<GeoResult[]>([]);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Close the dropdown on outside-click / Escape.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  async function runSearch() {
    const q = query.trim();
    if (!q) return;
    setStatus('loading');
    setOpen(true);
    try {
      const res = await fetch(`/api/geocode?q=${encodeURIComponent(q)}`);
      if (!res.ok) {
        setResults([]);
        setStatus('error');
        return;
      }
      setResults((await res.json()) as GeoResult[]);
      setStatus('idle');
    } catch {
      setResults([]);
      setStatus('error');
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault(); // don't submit the surrounding branch <form>
      runSearch();
    }
  }

  function handlePick(r: GeoResult) {
    onSelect(r.lat, r.lng);
    setOpen(false);
  }

  return (
    <div ref={rootRef} className="relative">
      <div className="flex gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="ค้นหาสถานที่ / ที่อยู่ แล้วกด Enter"
          aria-label="ค้นหาสถานที่เพื่อปักหมุด"
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/30"
        />
        <button
          type="button"
          onClick={runSearch}
          disabled={status === 'loading'}
          className="shrink-0 rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          {status === 'loading' ? 'กำลังค้นหา…' : 'ค้นหา'}
        </button>
      </div>

      {open && (
        <div className="absolute z-[1000] mt-1 w-full overflow-hidden rounded-md border border-gray-200 bg-white shadow-lg">
          {status === 'error' ? (
            <p className="px-3 py-2 text-xs text-red-600">ค้นหาไม่สำเร็จ ลองอีกครั้ง</p>
          ) : status === 'loading' ? (
            <p className="px-3 py-2 text-xs text-gray-500">กำลังค้นหา…</p>
          ) : results.length === 0 ? (
            <p className="px-3 py-2 text-xs text-gray-500">ไม่พบสถานที่</p>
          ) : (
            <ul className="max-h-60 overflow-auto">
              {results.map((r) => (
                <li key={`${r.displayName}:${r.lat},${r.lng}`}>
                  <button
                    type="button"
                    onClick={() => handlePick(r)}
                    className="block w-full px-3 py-2 text-left text-xs text-gray-700 hover:bg-gray-50"
                  >
                    {r.displayName}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
