'use client';

import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { useEffect, useRef } from 'react';

/**
 * Read-only mini-map for a disputed check-in: the branch (primary dot) + its
 * geofence circle + the employee's check-in position (pin), auto-fit to show
 * both. Leaflet touches `window`, so this is imported via a dynamic({ssr:false})
 * wrapper (dispute-map-dynamic.tsx).
 */
const ICON = L.icon({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});

type Props = {
  branch: { name: string; lat: number; lng: number; radiusMeters: number };
  employee: { lat: number; lng: number };
};

export function DisputeMap({ branch, employee }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      zoomControl: true,
      attributionControl: false,
      scrollWheelZoom: false,
    });
    mapRef.current = map;
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);

    const b = L.latLng(branch.lat, branch.lng);
    const e = L.latLng(employee.lat, employee.lng);
    L.circle(b, {
      radius: branch.radiusMeters,
      color: '#3955e8',
      fillColor: '#3955e8',
      fillOpacity: 0.08,
      weight: 1.5,
    }).addTo(map);
    L.circleMarker(b, {
      radius: 7,
      color: '#3955e8',
      fillColor: '#3955e8',
      fillOpacity: 1,
      weight: 2,
    })
      .addTo(map)
      .bindTooltip(branch.name);
    L.marker(e, { icon: ICON }).addTo(map).bindTooltip('ตำแหน่งเช็คอิน');
    map.fitBounds(L.latLngBounds([b, e]).pad(0.5), { maxZoom: 17 });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [branch, employee]);

  return (
    <div
      ref={containerRef}
      className="h-56 w-full overflow-hidden rounded-lg border border-gray-200"
    />
  );
}
