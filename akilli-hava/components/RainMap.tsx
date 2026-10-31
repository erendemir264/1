'use client';

import { useEffect, useRef } from 'react';
import 'leaflet/dist/leaflet.css';
import type { Nowcast } from '@/lib/types';
import { destination } from '@/lib/geo';

export default function RainMap({ lat, lon, nowcast }: { lat: number; lon: number; nowcast: Nowcast }) {
  const el = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let map: import('leaflet').Map | undefined;
    let cancelled = false;
    (async () => {
      const L = (await import('leaflet')).default;
      if (cancelled || !el.current) return;
      map = L.map(el.current, { zoomControl: false, attributionControl: true }).setView([lat, lon], 7);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 11,
        attribution: '© OpenStreetMap',
      }).addTo(map);

      // Live radar (if RainViewer covers the area)
      try {
        const r = await fetch('https://api.rainviewer.com/public/weather-maps.json');
        const j = await r.json();
        const last = j?.radar?.past?.[j.radar.past.length - 1];
        if (last && map) {
          L.tileLayer(`${j.host}${last.path}/256/{z}/{x}/{y}/2/1_0.png`, {
            opacity: 0.7,
            maxNativeZoom: 7,
            maxZoom: 11,
            attribution: 'Radar © RainViewer',
          }).addTo(map);
        }
      } catch {}

      // Rain cells we tracked (radar or model)
      for (const c of nowcast.cells.slice(0, 300)) {
        L.circleMarker([c.lat, c.lon], {
          radius: nowcast.source === 'radar' ? 3 : 7,
          stroke: false,
          fillColor: '#2563eb',
          fillOpacity: Math.min(0.7, 0.25 + c.v * 0.4),
        }).addTo(map);
      }
      L.circleMarker([lat, lon], { radius: 7, color: '#fff', weight: 2, fillColor: '#ef4444', fillOpacity: 1 }).addTo(map);

      // Steering wind arrow: shows where clouds come from and go to
      if (nowcast.motion && nowcast.motion.speedKmh > 3) {
        const dirTo = nowcast.motion.dirTo;
        const len = Math.min(120, 30 + nowcast.motion.speedKmh * 1.5);
        const a = destination(lat, lon, dirTo + 180, len);
        const b = destination(lat, lon, dirTo, len * 0.4);
        L.polyline(
          [
            [a.lat, a.lon],
            [b.lat, b.lon],
          ],
          { color: '#111827', weight: 3, opacity: 0.8, dashArray: '6 6' },
        ).addTo(map);
        const h1 = destination(b.lat, b.lon, dirTo + 150, 15);
        const h2 = destination(b.lat, b.lon, dirTo - 150, 15);
        L.polyline(
          [
            [h1.lat, h1.lon],
            [b.lat, b.lon],
            [h2.lat, h2.lon],
          ],
          { color: '#111827', weight: 3, opacity: 0.8 },
        ).addTo(map);
      }
    })();
    return () => {
      cancelled = true;
      map?.remove();
    };
  }, [lat, lon, nowcast]);

  return <div ref={el} className="map" />;
}
