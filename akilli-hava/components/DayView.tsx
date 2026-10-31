'use client';

import { useState } from 'react';
import type { DayOut, WindowResult } from '@/lib/types';

export function ConfidenceChip({ c }: { c: WindowResult['confidence'] }) {
  const [open, setOpen] = useState(false);
  const color = c.label === 'Yüksek' ? 'var(--good)' : c.label === 'Orta' ? 'var(--mid)' : 'var(--low)';
  return (
    <div>
      <button className="conf" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="dot" style={{ background: color }} />
        Güven: {c.label} · %{c.pct}
      </button>
      {open && <div className="conf-why">{c.reason}</div>}
    </div>
  );
}

export function AdviceList({ w }: { w: WindowResult }) {
  return (
    <>
      <div className="advice">
        {w.advice.map((a, i) => (
          <div className="adv" key={i}>
            <div className="i">{a.icon}</div>
            <div>
              <b>{a.text}</b>
              {a.why && <span>{a.why}</span>}
            </div>
          </div>
        ))}
      </div>
      {w.warnings.length > 0 && (
        <div className="warns">
          {w.warnings.map((x, i) => (
            <div key={i}>⚠️ {x}</div>
          ))}
        </div>
      )}
    </>
  );
}

export default function DayView({ day }: { day: DayOut }) {
  return (
    <>
      <section className="card">
        <div className="muted" style={{ marginBottom: 4 }}>
          {day.label} · {day.date}
        </div>
        <div className="headline">
          {day.main.icon} {day.headline}
        </div>
        <ConfidenceChip c={day.main.confidence} />
        <AdviceList w={day.main} />
      </section>

      <section className="card periods">
        {day.periods.map((p) => (
          <div className="prow" key={p.name}>
            <div className="nm">{p.name}</div>
            <div className="ic">{p.icon}</div>
            <div className="sm">
              {p.summary}
              {p.confidence.label !== 'Yüksek' && <> · güven {p.confidence.label.toLowerCase()}</>}
            </div>
            <div className="tt">
              {Math.round(p.tMin) === Math.round(p.tMax) ? `${Math.round(p.tMin)}°` : `${Math.round(p.tMin)}°–${Math.round(p.tMax)}°`}
              {p.pRain >= 0.15 && <small>☔ %{Math.round(p.pRain * 100)}</small>}
            </div>
          </div>
        ))}
      </section>
    </>
  );
}
