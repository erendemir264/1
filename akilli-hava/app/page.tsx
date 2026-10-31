'use client';

import { useCallback, useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import type { ForecastResponse } from '@/lib/types';
import LocationPicker, { type Place } from '@/components/LocationPicker';
import DayView from '@/components/DayView';
import Hourly from '@/components/Hourly';
import Planner from '@/components/Planner';
import InstallHint from '@/components/InstallHint';

const RainMap = dynamic(() => import('@/components/RainMap'), { ssr: false, loading: () => <div className="skeleton" /> });

const KEY = 'akilli-hava:place';

function loadPlace(): Place | null {
  try {
    const s = localStorage.getItem(KEY);
    return s ? (JSON.parse(s) as Place) : null;
  } catch {
    return null;
  }
}
function savePlace(p: Place) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {}
}

export default function Home() {
  const [place, setPlace] = useState<Place | null>(null);
  const [picking, setPicking] = useState(false);
  const [data, setData] = useState<ForecastResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [day, setDay] = useState(0);

  useEffect(() => {
    const p = loadPlace();
    if (p) setPlace(p);
    else setPicking(true);
  }, []);

  const load = useCallback(async (p: Place) => {
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch(`/api/forecast?lat=${p.lat.toFixed(3)}&lon=${p.lon.toFixed(3)}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Veri alınamadı');
      setData(j);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!place) return;
    load(place);
    const id = setInterval(() => document.visibilityState === 'visible' && load(place), 10 * 60 * 1000);
    return () => clearInterval(id);
  }, [place, load]);

  const choose = (p: Place) => {
    savePlace(p);
    setPlace(p);
    setPicking(false);
    setData(null);
    setDay(0);
  };

  const updated = data ? new Date(data.generatedAt * 1000).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }) : '';
  const d = data?.days[day];

  return (
    <main className="wrap">
      <div className="top">
        <button className="place" onClick={() => setPicking((v) => !v)} aria-label="Konumu değiştir">
          📍 {place?.name ?? 'Konum seç'}
          <small>{updated ? `Güncellendi ${updated} · değiştirmek için dokun` : 'Değiştirmek için dokun'}</small>
        </button>
        {place && (
          <button className="iconbtn" onClick={() => load(place)} disabled={loading} aria-label="Yenile">
            {loading ? '…' : '↻'}
          </button>
        )}
      </div>

      <InstallHint />

      {picking && <LocationPicker onPick={choose} onClose={place ? () => setPicking(false) : undefined} />}

      {err && (
        <div className="card err">
          {err} <button className="iconbtn" onClick={() => place && load(place)}>Tekrar dene</button>
        </div>
      )}

      {!data && place && !err && (
        <>
          <div className="skeleton" />
          <div className="skeleton" style={{ height: 260 }} />
        </>
      )}

      {data && (
        <>
          <section className="card">
            <div className="now">
              <div className="big">{data.now.icon}</div>
              <div>
                <div className="temp">{data.now.temp}°</div>
                <div className="sub">
                  {data.now.text} · hissedilen {data.now.feels}°
                </div>
              </div>
            </div>
            <div className={`nowcast ${data.nowcast.state === 'raining' || data.nowcast.state === 'approaching' ? 'rain' : ''}`}>
              {data.nowcast.state === 'raining' || data.nowcast.state === 'approaching' ? '☔ ' : '🛰️ '}
              {data.nowcast.message}
              {data.nowcast.detail && <div className="detail">{data.nowcast.detail}</div>}
            </div>
          </section>

          <div className="tabs" role="tablist">
            {data.days.map((x, i) => (
              <button key={x.dayIdx} className={i === day ? 'on' : ''} onClick={() => setDay(i)} role="tab" aria-selected={i === day}>
                {x.label}
              </button>
            ))}
          </div>

          {d && <DayView day={d} />}

          <section className="card">
            <h2 className="sec">Dışarıda olacağım</h2>
            <Planner data={data} />
          </section>

          <section className="card">
            <h2 className="sec">Saat saat</h2>
            <Hourly hours={data.hours} now={data.generatedAt} />
          </section>

          <section className="card">
            <details>
              <summary>Yağış ve rüzgar haritası</summary>
              <p className="muted" style={{ margin: '8px 0 0' }}>
                Mavi alanlar yağış. Ok, bulutları taşıyan rüzgarın yönünü gösteriyor.
              </p>
              <RainMap lat={data.location.lat} lon={data.location.lon} nowcast={data.nowcast} />
            </details>
          </section>

          <footer>
            Bu tahmin {data.pool.detModels.length} hava modeli ve {data.pool.ensembleMembers} olası senaryonun birleşimiyle hesaplandı.
            Güven oranı, senaryoların ne kadar aynı şeyi söylediğini gösterir.
            <br />
            Kaynaklar: {data.sources.join(' · ')}.
            <br />
            Veri: <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Open-Meteo</a> (CC BY 4.0)
            {data.nowcast.source === 'radar' && (
              <>
                {' '}· Radar: <a href="https://www.rainviewer.com/" target="_blank" rel="noreferrer">RainViewer</a>
              </>
            )}
          </footer>
        </>
      )}
    </main>
  );
}
