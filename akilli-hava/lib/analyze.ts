import type { ForecastResponse, Nowcast } from './types';
import { DET_MODELS, ENS_MODELS, fetchDet, fetchEnsemble, fetchGrid, fetchMain, fetchPrevious } from './sources';
import { fetchRadar } from './radar';
import { modelNowcast, radarNowcast, type GridPoint } from './nowcast';
import { applyNowcast, buildDays, buildHours, nowSummary } from './engine';
import { destination, toXY } from './geo';

const NAMES: Record<string, string> = {
  ecmwf_ifs025: 'ECMWF (Avrupa)',
  icon_seamless: 'ICON (Almanya)',
  gfs_seamless: 'GFS (ABD)',
  gfs025: 'GFS (ABD)',
  meteofrance_seamless: 'ARPEGE (Fransa)',
  ukmo_seamless: 'UKMO (İngiltere)',
  gem_seamless: 'GEM (Kanada)',
  best_match: 'Open-Meteo en iyi eşleşme',
};

const RINGS = [20, 45, 75, 110, 150];
const BEARINGS = Array.from({ length: 12 }, (_, i) => i * 30);

export async function analyze(lat: number, lon: number): Promise<ForecastResponse> {
  const now = Math.floor(Date.now() / 1000);
  const gridPts = RINGS.flatMap((km) => BEARINGS.map((b) => destination(lat, lon, b, km)));

  const [mainR, prevR, radarR, gridR, ...rest] = await Promise.allSettled([
    fetchMain(lat, lon),
    fetchPrevious(lat, lon),
    fetchRadar(lat, lon),
    fetchGrid(gridPts),
    ...DET_MODELS.map((m) => fetchDet(lat, lon, m)),
    ...ENS_MODELS.map((m) => fetchEnsemble(lat, lon, m)),
  ]);
  if (mainR.status !== 'fulfilled') throw new Error(`Hava verisi alınamadı: ${(mainR.reason as Error)?.message ?? ''}`);
  const main = mainR.value;
  const detR = rest.slice(0, DET_MODELS.length);
  const ensR = rest.slice(DET_MODELS.length);
  const dets = detR.flatMap((r, i) => (r.status === 'fulfilled' ? [{ model: DET_MODELS[i], h: r.value as any }] : []));
  const ens = ensR.flatMap((r) => (r.status === 'fulfilled' ? [r.value as any] : []));

  const { hours, pool, dayStart } = buildHours({
    now,
    tzOffset: main.tzOffset,
    main: main.hourly,
    dets,
    ens,
    prev: prevR.status === 'fulfilled' ? prevR.value : undefined,
  });

  // ---- short-range rain tracking ----
  const cur = hours.find((h) => h.t <= now && h.t + 3600 > now) ?? hours[0];
  const steer =
    cur.steer !== undefined && cur.steerDir !== undefined
      ? { speed: cur.steer, dirFrom: cur.steerDir }
      : { speed: cur.wind * 1.6, dirFrom: cur.windDir };
  let nowcast: Nowcast | null = null;
  if (radarR.status === 'fulfilled') {
    try {
      nowcast = radarNowcast(radarR.value, lat, lon, steer, cur.rh700);
    } catch {
      nowcast = null;
    }
  }
  if (!nowcast && gridR.status === 'fulfilled') {
    const h0 = Math.floor(now / 3600) * 3600;
    const pts: GridPoint[] = gridR.value.map((g, i) => {
      const at = (t: number) => {
        const k = g.time.indexOf(t);
        return k >= 0 ? (g.precip[k] ?? 0) : 0;
      };
      const { x, y } = toXY(lat, lon, gridPts[i].lat, gridPts[i].lon);
      // value at T = rain during the hour before T
      return { x, y, before: at(h0), now: at(h0 + 3600), after: at(h0 + 7200) };
    });
    nowcast = modelNowcast(pts, lat, lon, steer, cur.rh700);
  }
  if (!nowcast) nowcast = { source: 'none', state: 'unknown', message: 'Yakın çevredeki yağış takibi şu an yapılamıyor.', cells: [] };

  applyNowcast(hours, nowcast, now);
  const days = buildDays(hours, pool, dayStart, now, main.tzOffset, nowcast);

  const sources = [
    ...pool.detModels.map((m) => NAMES[m] ?? m),
    ...(pool.ensembleMembers ? [`${pool.ensembleMembers} ensemble senaryosu (${pool.ensembleModels.map((m) => (NAMES[m] ?? m).split(' ')[0]).join(', ')})`] : []),
    ...(nowcast.source === 'radar' ? ['RainViewer radar'] : nowcast.source === 'model' ? ['150 km çevrede 60 noktalı yağış taraması'] : []),
    ...(prevR.status === 'fulfilled' ? ['Dünkü tahminle karşılaştırma'] : []),
  ];

  return {
    location: { lat, lon, tzOffset: main.tzOffset, timezone: main.timezone },
    generatedAt: now,
    now: nowSummary(hours, now, nowcast),
    nowcast,
    days,
    hours: hours.filter((h) => !h.past || h.t >= now - 3 * 3600),
    pool,
    sources,
  };
}
