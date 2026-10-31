'use client';

import { useEffect, useRef, useState } from 'react';

export interface Place {
  lat: number;
  lon: number;
  name: string;
}

interface GeoResult {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  admin1?: string;
  country?: string;
}

async function reverseName(lat: number, lon: number) {
  try {
    const r = await fetch(
      `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=tr`,
    );
    const j = await r.json();
    return [j.locality || j.city, j.principalSubdivision].filter(Boolean).join(', ') || 'Konumum';
  } catch {
    return 'Konumum';
  }
}

export default function LocationPicker({ onPick, onClose }: { onPick: (p: Place) => void; onClose?: () => void }) {
  const [q, setQ] = useState('');
  const [res, setRes] = useState<GeoResult[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (q.trim().length < 2) {
      setRes([]);
      return;
    }
    timer.current = setTimeout(async () => {
      try {
        const r = await fetch(
          `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q.trim())}&count=6&language=tr&format=json`,
        );
        const j = await r.json();
        setRes(j.results ?? []);
        setMsg(j.results?.length ? null : 'Sonuç bulunamadı');
      } catch {
        setMsg('Arama yapılamadı');
      }
    }, 300);
  }, [q]);

  const locate = () => {
    if (!navigator.geolocation) {
      setMsg('Tarayıcın konum desteklemiyor');
      return;
    }
    setMsg('Konum alınıyor…');
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        onPick({ lat: latitude, lon: longitude, name: await reverseName(latitude, longitude) });
      },
      () => setMsg('Konum izni verilmedi. Şehir adıyla arayabilirsin.'),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 10 * 60 * 1000 },
    );
  };

  return (
    <section className="card">
      <button className="primary" onClick={locate} style={{ width: '100%', marginBottom: 10 }}>
        📍 Bulunduğum yeri kullan
      </button>
      <div className="searchbox">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Şehir veya ilçe ara (ör. Kadıköy)" autoFocus />
        {onClose && (
          <button className="iconbtn" onClick={onClose} aria-label="Kapat">
            ✕
          </button>
        )}
      </div>
      {msg && <p className="muted">{msg}</p>}
      <div className="results">
        {res.map((r) => (
          <button
            key={r.id}
            onClick={() => onPick({ lat: r.latitude, lon: r.longitude, name: [r.name, r.admin1].filter(Boolean).join(', ') })}
          >
            {r.name} <small>{[r.admin1, r.country].filter(Boolean).join(', ')}</small>
          </button>
        ))}
      </div>
    </section>
  );
}
