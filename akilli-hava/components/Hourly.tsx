'use client';

import { Fragment } from 'react';
import type { HourOut } from '@/lib/types';
import { hourIcon } from '@/lib/window';

const LABELS = ['Bugün', 'Yarın', 'Öbür gün', ''];

export default function Hourly({ hours, now }: { hours: HourOut[]; now: number }) {
  const list = hours.filter((h) => h.t + 3600 > now);
  return (
    <div className="hours">
      {list.map((h, i) => {
        const isNow = h.t <= now;
        const newDay = i > 0 && h.dayIdx !== list[i - 1].dayIdx;
        return (
          <Fragment key={h.t}>
            {newDay && <div className="daysep">{LABELS[h.dayIdx] ?? ''}</div>}
            <div className="hr" title={`${Math.round(h.tLo)}°–${Math.round(h.tHi)}° arası olası`}>
              <div className="h">{isNow ? 'Şimdi' : `${String(h.hour).padStart(2, '0')}:00`}</div>
              <div className="ic">{hourIcon(h)}</div>
              <div className="t">{Math.round(h.temp)}°</div>
              <div className="bar">
                <i style={{ height: `${Math.max(2, h.pop * 44)}px`, opacity: h.pop < 0.15 ? 0.25 : 1 }} />
              </div>
              <div className="p">{h.pop >= 0.15 ? `%${Math.round(h.pop * 100)}` : ''}</div>
              {h.gust >= 40 && <div className="p" style={{ color: 'var(--muted)' }}>💨{h.gust}</div>}
            </div>
          </Fragment>
        );
      })}
    </div>
  );
}
