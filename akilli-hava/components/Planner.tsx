'use client';

import { useMemo, useState } from 'react';
import type { ForecastResponse } from '@/lib/types';
import { analyzeWindow } from '@/lib/window';
import { AdviceList, ConfidenceChip } from './DayView';

const hh = (h: number) => `${String(h % 24).padStart(2, '0')}:00`;

export default function Planner({ data }: { data: ForecastResponse }) {
  const tz = data.location.tzOffset;
  const now = data.generatedAt;
  const localHour = new Date((now + tz) * 1000).getUTCHours();
  const dayStart = Math.floor((now + tz) / 86400) * 86400 - tz;

  const [day, setDay] = useState(localHour >= 20 ? 1 : 0);
  const [from, setFrom] = useState(localHour >= 20 ? 9 : Math.max(localHour + 1, 18));
  const [to, setTo] = useState(localHour >= 20 ? 18 : Math.max(localHour + 4, 23));

  const startOpts = Array.from({ length: 24 }, (_, h) => h).filter((h) => day > 0 || h >= localHour);
  const endOpts = Array.from({ length: 30 }, (_, h) => h + 1).filter((h) => h > from);

  const res = useMemo(() => {
    const base = dayStart + day * 86400;
    return analyzeWindow(data.hours, data.pool, base + from * 3600, base + Math.max(to, from + 1) * 3600, 'Planın', {
      now,
      nowcast: data.nowcast,
    });
  }, [data, day, from, to, dayStart, now]);

  return (
    <>
      <div className="plan">
        <select value={day} onChange={(e) => {
            const v = Number(e.target.value);
            setDay(v);
            if (v === 0 && from < localHour) {
              setFrom(localHour);
              if (to <= localHour) setTo(Math.min(30, localHour + 3));
            }
          }} aria-label="Gün">
          {data.days.map((d, i) => (
            <option key={i} value={i}>
              {d.label}
            </option>
          ))}
        </select>
        <select value={from} onChange={(e) => {
            const v = Number(e.target.value);
            setFrom(v);
            if (to <= v) setTo(Math.min(30, v + 3));
          }} aria-label="Başlangıç">
          {startOpts.map((h) => (
            <option key={h} value={h}>
              {hh(h)}
            </option>
          ))}
        </select>
        <span>–</span>
        <select value={to} onChange={(e) => setTo(Number(e.target.value))} aria-label="Bitiş">
          {endOpts.map((h) => (
            <option key={h} value={h}>
              {hh(h)}
              {h > 24 ? ' (ertesi)' : ''}
            </option>
          ))}
        </select>
      </div>
      {res ? (
        <div className="result">
          <div className="headline" style={{ fontSize: 17 }}>
            {res.icon} {res.summary} {Math.round(res.tMin)}°
            {Math.round(res.tMax) !== Math.round(res.tMin) ? `–${Math.round(res.tMax)}°` : ''}.
          </div>
          <ConfidenceChip c={res.confidence} />
          <AdviceList w={res} />
        </div>
      ) : (
        <p className="muted">Bu saat aralığı geçti, başka bir saat seç.</p>
      )}
    </>
  );
}
