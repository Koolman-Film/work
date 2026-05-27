'use client';

import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { useEffect, useRef, useState } from 'react';

/**
 * Leaflet + OpenStreetMap geofence picker.
 *
 * Lets admin click on a map to set lat/lng for a branch + see a circle
 * showing the geofence radius. The form's hidden `latitude` / `longitude`
 * inputs are updated whenever the pin moves.
 *
 * Why Client Component:
 *   - Leaflet touches `window` at module top; can't render on the server.
 *   - The parent form uses dynamic({ssr: false}) to import this so the
 *     bundle stays out of SSR entirely.
 *
 * Why we set up the marker icon URLs manually:
 *   - Leaflet ships PNG icons that resolve via relative paths in
 *     /node_modules/leaflet/dist/images. Webpack/Turbopack don't preserve
 *     those URLs by default. Workaround: explicit CDN URLs (smallest blast
 *     radius — no asset-copying step in the build).
 */

type Props = {
  /** Initial pin position. If null, the map starts centered on Bangkok zoomed out. */
  initialLat: number | null;
  initialLng: number | null;
  /** Geofence radius in meters — used for the preview circle (re-read from input on change). */
  initialRadiusMeters: number;
  /** Names of the hidden inputs in the parent <form> that we keep in sync. */
  latInputName: string;
  lngInputName: string;
};

// Bangkok city center — sensible default when admin hasn't picked yet
const BANGKOK = { lat: 13.7563, lng: 100.5018 };

export function GeofencePicker({
  initialLat,
  initialLng,
  initialRadiusMeters,
  latInputName,
  lngInputName,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const circleRef = useRef<L.Circle | null>(null);

  const [lat, setLat] = useState<number | null>(initialLat);
  const [lng, setLng] = useState<number | null>(initialLng);
  const [radius, setRadius] = useState<number>(initialRadiusMeters);

  // Watch the radiusMeters input in the parent form so the preview
  // circle resizes as admin tweaks the number.
  useEffect(() => {
    const radiusInput = document.querySelector<HTMLInputElement>('input[name="radiusMeters"]');
    if (!radiusInput) return;
    const onInput = () => {
      const n = Number(radiusInput.value);
      if (Number.isFinite(n) && n > 0) setRadius(n);
    };
    radiusInput.addEventListener('input', onInput);
    return () => radiusInput.removeEventListener('input', onInput);
  }, []);

  // Initialize the map exactly once — initial lat/lng/radius read on mount;
  // subsequent changes flow through the separate effect at L126.
  // biome-ignore lint/correctness/useExhaustiveDependencies: init-only effect by design
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    // Fix marker icon paths (see comment above)
    L.Icon.Default.mergeOptions({
      iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
      iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
      shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
    });

    const start = lat != null && lng != null ? { lat, lng } : BANGKOK;
    const zoom = lat != null && lng != null ? 16 : 11;

    const map = L.map(containerRef.current).setView([start.lat, start.lng], zoom);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap',
      maxZoom: 19,
    }).addTo(map);

    // Initial marker + circle (only if we have a position)
    if (lat != null && lng != null) {
      markerRef.current = L.marker([lat, lng], { draggable: true }).addTo(map);
      circleRef.current = L.circle([lat, lng], {
        radius,
        color: '#2563eb',
        fillColor: '#2563eb',
        fillOpacity: 0.12,
        weight: 2,
      }).addTo(map);

      markerRef.current.on('dragend', () => {
        const pos = markerRef.current!.getLatLng();
        setLat(pos.lat);
        setLng(pos.lng);
      });
    }

    // Click anywhere to set / move the pin
    map.on('click', (e: L.LeafletMouseEvent) => {
      const { lat: clickedLat, lng: clickedLng } = e.latlng;
      setLat(clickedLat);
      setLng(clickedLng);
    });

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
      circleRef.current = null;
    };
  }, []);

  // Reflect lat/lng state changes onto the map (marker + circle + recenter)
  useEffect(() => {
    if (!mapRef.current) return;
    if (lat == null || lng == null) return;

    if (!markerRef.current) {
      markerRef.current = L.marker([lat, lng], { draggable: true }).addTo(mapRef.current);
      markerRef.current.on('dragend', () => {
        const pos = markerRef.current!.getLatLng();
        setLat(pos.lat);
        setLng(pos.lng);
      });
    } else {
      markerRef.current.setLatLng([lat, lng]);
    }

    if (!circleRef.current) {
      circleRef.current = L.circle([lat, lng], {
        radius,
        color: '#2563eb',
        fillColor: '#2563eb',
        fillOpacity: 0.12,
        weight: 2,
      }).addTo(mapRef.current);
    } else {
      circleRef.current.setLatLng([lat, lng]);
      circleRef.current.setRadius(radius);
    }
  }, [lat, lng, radius]);

  return (
    <div className="space-y-2">
      {/* Hidden inputs — Server Action reads these */}
      <input type="hidden" name={latInputName} value={lat ?? ''} readOnly />
      <input type="hidden" name={lngInputName} value={lng ?? ''} readOnly />

      {/* role="application" is the conventional role for an interactive
          map container per ARIA APG. Pairs cleanly with aria-label so SR
          users hear "แผนที่สำหรับเลือกตำแหน่งสาขา" on focus. */}
      <div
        ref={containerRef}
        role="application"
        aria-label="แผนที่สำหรับเลือกตำแหน่งสาขา"
        className="h-72 w-full rounded-md border border-gray-200"
      />

      <div className="flex items-center justify-between text-xs">
        {lat != null && lng != null ? (
          <p className="text-gray-600">
            พิกัด:{' '}
            <span className="font-mono">
              {lat.toFixed(6)}, {lng.toFixed(6)}
            </span>
            <span className="ml-2 text-gray-400">รัศมี: {radius}m</span>
          </p>
        ) : (
          <p className="text-gray-500">คลิกบนแผนที่เพื่อปักหมุดตำแหน่งสาขา (หรือลากหมุดเพื่อปรับ)</p>
        )}
        {lat != null && lng != null && (
          <button
            type="button"
            onClick={() => {
              setLat(null);
              setLng(null);
              if (markerRef.current) {
                markerRef.current.remove();
                markerRef.current = null;
              }
              if (circleRef.current) {
                circleRef.current.remove();
                circleRef.current = null;
              }
              if (mapRef.current) {
                mapRef.current.setView([BANGKOK.lat, BANGKOK.lng], 11);
              }
            }}
            className="text-primary-600 hover:text-primary-700"
          >
            ล้างพิกัด
          </button>
        )}
      </div>
    </div>
  );
}
