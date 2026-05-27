'use client';

import dynamic from 'next/dynamic';

/**
 * Dynamic, SSR-disabled wrapper around the Leaflet picker.
 *
 * Why a separate file: `dynamic({ ssr: false })` only works from a Client
 * Component. The Server-Component BranchForm imports THIS file (which is
 * 'use client') and gets the SSR-skip behavior automatically. Without
 * this indirection, Next.js bundles Leaflet's window-touching code into
 * the server build and crashes at module load.
 */
export const GeofencePicker = dynamic(
  () => import('./geofence-picker').then((m) => m.GeofencePicker),
  {
    ssr: false,
    loading: () => (
      <div className="grid h-72 place-items-center rounded-md border border-gray-200 bg-gray-50 text-sm text-gray-500">
        กำลังโหลดแผนที่…
      </div>
    ),
  },
);
