'use client';

import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { type ChangeEvent, useCallback, useEffect, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { GeofenceSearch } from './geofence-search';
import { parseCoordInput } from './parse-coord';

/**
 * Leaflet + OpenStreetMap geofence picker.
 *
 * Lets admin set a branch's lat/lng three ways — click the map, drag the pin,
 * or type into the latitude/longitude fields — all kept in two-way sync. A
 * circle previews the geofence radius. The visible lat/lng inputs carry the
 * form's `latitude` / `longitude` names, so what the admin sees is exactly
 * what the Server Action receives (WYSIWYG; no hidden inputs).
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
  /** Names of the form inputs we submit (and keep in sync with the pin). */
  latInputName: string;
  lngInputName: string;
};

// Bangkok city center — sensible default when admin hasn't picked yet
const BANGKOK = { lat: 13.7563, lng: 100.5018 };

/** Format a numeric coordinate for the text fields (6 dp matches old display). */
function fmt(n: number): string {
  return n.toFixed(6);
}

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

  // Draft strings backing the two text inputs. Kept separate from the numeric
  // lat/lng so partial input ("13.", "-", "") doesn't corrupt the map state.
  const [latText, setLatText] = useState<string>(initialLat != null ? fmt(initialLat) : '');
  const [lngText, setLngText] = useState<string>(initialLng != null ? fmt(initialLng) : '');

  // Pin → fields: set numeric state AND the text drafts together. Stable
  // identity (state setters are stable) so the init-only effect can capture it.
  const syncFromMap = useCallback((la: number, lo: number) => {
    setLat(la);
    setLng(lo);
    setLatText(fmt(la));
    setLngText(fmt(lo));
  }, []);

  // Address search → same path as click/drag/typed coords: move the pin + fill
  // the fields, then recenter the map on the chosen place.
  const handleGeocodeSelect = useCallback(
    (la: number, lo: number) => {
      syncFromMap(la, lo);
      mapRef.current?.setView([la, lo], 16);
    },
    [syncFromMap],
  );

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
  // subsequent changes flow through the reflection effect below.
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
        syncFromMap(pos.lat, pos.lng);
      });
    }

    // Click anywhere to set / move the pin
    map.on('click', (e: L.LeafletMouseEvent) => {
      syncFromMap(e.latlng.lat, e.latlng.lng);
    });

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
      circleRef.current = null;
    };
  }, []);

  // Reflect lat/lng state onto the map. Removes the pin when either coordinate
  // is null (admin emptied a field or hit ล้างพิกัด); otherwise creates/moves
  // the marker + circle.
  useEffect(() => {
    if (!mapRef.current) return;

    if (lat == null || lng == null) {
      if (markerRef.current) {
        markerRef.current.remove();
        markerRef.current = null;
      }
      if (circleRef.current) {
        circleRef.current.remove();
        circleRef.current = null;
      }
      return;
    }

    if (!markerRef.current) {
      markerRef.current = L.marker([lat, lng], { draggable: true }).addTo(mapRef.current);
      markerRef.current.on('dragend', () => {
        const pos = markerRef.current!.getLatLng();
        syncFromMap(pos.lat, pos.lng);
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
  }, [lat, lng, radius, syncFromMap]);

  // Fields → map: update the draft, and commit to numeric state on a valid parse.
  const onLatChange = (e: ChangeEvent<HTMLInputElement>) => {
    const text = e.target.value;
    setLatText(text);
    const parsed = parseCoordInput(text, 'lat');
    if (parsed.ok) setLat(parsed.value);
  };
  const onLngChange = (e: ChangeEvent<HTMLInputElement>) => {
    const text = e.target.value;
    setLngText(text);
    const parsed = parseCoordInput(text, 'lng');
    if (parsed.ok) setLng(parsed.value);
  };

  const latInvalid = !parseCoordInput(latText, 'lat').ok;
  const lngInvalid = !parseCoordInput(lngText, 'lng').ok;
  const hasAnyValue = latText !== '' || lngText !== '';

  const clearAll = () => {
    setLat(null);
    setLng(null);
    setLatText('');
    setLngText('');
    // Marker/circle removal is handled by the reflection effect (lat/lng null).
    if (mapRef.current) {
      mapRef.current.setView([BANGKOK.lat, BANGKOK.lng], 11);
    }
  };

  return (
    <div className="space-y-3">
      {/* Address search — jumps the map + fills lat/long via syncFromMap. */}
      <GeofenceSearch onSelect={handleGeocodeSelect} />

      {/* role="application" is the conventional role for an interactive
          map container per ARIA APG. Pairs cleanly with aria-label so SR
          users hear "แผนที่สำหรับเลือกตำแหน่งสาขา" on focus. */}
      <div
        ref={containerRef}
        role="application"
        aria-label="แผนที่สำหรับเลือกตำแหน่งสาขา"
        className="h-72 w-full rounded-md border border-gray-200"
      />

      {/* Editable lat/long fields — two-way synced with the pin. These carry
          the form's latitude/longitude names (WYSIWYG submission). */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="geofence-lat" className="mb-1 block text-xs font-medium text-gray-600">
            ละติจูด (Latitude)
          </label>
          <Input
            id="geofence-lat"
            name={latInputName}
            type="text"
            inputMode="decimal"
            placeholder="13.756300"
            value={latText}
            onChange={onLatChange}
            aria-invalid={latInvalid || undefined}
            aria-describedby={latInvalid ? 'geofence-lat-error' : undefined}
          />
          {latInvalid && (
            <p id="geofence-lat-error" className="mt-1 text-xs text-red-600">
              ละติจูดต้องเป็นตัวเลขระหว่าง -90 ถึง 90
            </p>
          )}
        </div>

        <div>
          <label htmlFor="geofence-lng" className="mb-1 block text-xs font-medium text-gray-600">
            ลองติจูด (Longitude)
          </label>
          <Input
            id="geofence-lng"
            name={lngInputName}
            type="text"
            inputMode="decimal"
            placeholder="100.501800"
            value={lngText}
            onChange={onLngChange}
            aria-invalid={lngInvalid || undefined}
            aria-describedby={lngInvalid ? 'geofence-lng-error' : undefined}
          />
          {lngInvalid && (
            <p id="geofence-lng-error" className="mt-1 text-xs text-red-600">
              ลองติจูดต้องเป็นตัวเลขระหว่าง -180 ถึง 180
            </p>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between text-xs">
        <p className="text-gray-500">คลิกบนแผนที่เพื่อปักหมุด ลากหมุดเพื่อปรับ หรือกรอกพิกัดด้านบน</p>
        {hasAnyValue && (
          <button
            type="button"
            onClick={clearAll}
            className="text-primary-600 hover:text-primary-700"
          >
            ล้างพิกัด
          </button>
        )}
      </div>
    </div>
  );
}
