'use client';

import dynamic from 'next/dynamic';

/** SSR-disabled wrapper around the Leaflet DisputeMap (window-touching). */
export const DisputeMap = dynamic(() => import('./dispute-map').then((m) => m.DisputeMap), {
  ssr: false,
  loading: () => (
    <div className="grid h-56 place-items-center rounded-lg border border-gray-200 bg-gray-50 text-xs text-ink-3">
      กำลังโหลดแผนที่…
    </div>
  ),
});
