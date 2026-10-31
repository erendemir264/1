// Builds the hourly timeline by merging every model and ensemble member into
// one weighted "scenario pool", then derives days and periods from it.
import type { Advice, DayOut, HourOut, Nowcast, Pool, WindowResult } from './types';
import type { EnsembleSet, Hourly } from './sources';
import { analyzeWindow, bitsToHex, clothing, hourIcon } from './window';

const WET_MM = 0.2; // mm in one hour that a person would call "rain"

interface Scenario {
  w: number;
  precip: number[];
  temp: number[];
  feels: number[];
  gust: number[];
  det: boolean;
}

function median(a: number[]) {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function wq(vals: number[], w: number[], q: number) {
  const idx = vals.map((_, i) => i).sort((a, b) => vals[a] - vals[b]);
  const tot = idx.reduce((a, i) => a + w[i], 0);
  let acc = 0;
  for (const i of idx) {
    acc += w[i];
    if (acc >= q * tot) return vals[i];
  }
  return vals[idx[idx.length - 1]];
}

/**
 * Open-Meteo precipitation at time T is the sum of the hour BEFORE T.
 * We label hours by their start, so hour [t, t+1h) uses the value at t+1h.
 */
function align(time: number[], series: (number | null)[] | undefined, timeline: number[], shiftForSum = false) {
  if (!series) return undefined;
  const map = new Map<number, number>();
  time.forEach((t, i) => map.set(t, i));
  const out: number[] = [];
  for (const t of timeline) {
    const i = map.get(shiftForSum ? t + 3600 : t);
    const v = i === undefined ? null : series[i];
    if (v == null) return undefined; // incomplete → drop this source
    out.push(v);
  }
  return out;
}

function alignLoose(time: number[], series: (number | null)[] | undefined, timeline: number[], shiftForSum = false) {
  const map = new Map<number, number>();
  time.forEach((t, i) => map.set(t, i));
  return timeline.map((t) => {
    const i = map.get(shiftForSum ? t + 3600 : t);
    const v = i === undefined || !series ? null : series[i];
    return v == null ? undefined : v;
  });
}

export interface BuildInput {
  now: number;
  tzOffset: number;
  main: Hourly;
  dets: { model: string; h: Hourly }[];
  ens: EnsembleSet[];
  prev?: Hourly;
}

export function buildHours(inp: BuildInput) {
  const { now, tzOffset, main } = inp;
  const localNow = now + tzOffset;
  const dayStart = Math.floor(localNow / 86400) * 86400 - tzOffset;
  const end = dayStart + 3 * 86400 + 6 * 3600;
  // only forecast hours matter for the pool; past hours of today are kept for context
  const timeline = main.time.filter((t) => t >= dayStart && t < end);

  const scen: Scenario[] = [];
  const detModels: string[] = [];
  for (const d of inp.dets) {
    const precip = align(d.h.time, d.h.vars.precipitation, timeline, true);
    const temp = align(d.h.time, d.h.vars.temperature_2m, timeline);
    if (!precip || !temp) continue;
    const feels = align(d.h.time, d.h.vars.apparent_temperature, timeline) ?? temp;
    const gust = align(d.h.time, d.h.vars.wind_gusts_10m, timeline) ?? timeline.map(() => NaN);
    scen.push({ w: 0, precip, temp, feels, gust, det: true });
    detModels.push(d.model);
  }
  const ensModels: string[] = [];
  const ensGroups: Scenario[][] = [];
  for (const e of inp.ens) {
    const group: Scenario[] = [];
    for (const m of e.members) {
      const precip = align(e.time, m.precipitation, timeline, true);
      const temp = align(e.time, m.temperature_2m, timeline);
      if (!precip || !temp) continue;
      const feels = align(e.time, m.apparent_temperature, timeline) ?? temp;
      const gust = align(e.time, m.wind_gusts_10m, timeline) ?? timeline.map(() => NaN);
      group.push({ w: 0, precip, temp, feels, gust, det: false });
    }
    if (group.length >= 5) {
      ensGroups.push(group);
      ensModels.push(e.model);
    }
  }
  // Fallback: at least the best-match model
  if (!scen.length) {
    const precip = align(main.time, main.vars.precipitation, timeline, true);
    const temp = align(main.time, main.vars.temperature_2m, timeline);
    if (precip && temp) {
      scen.push({
        w: 0,
        precip,
        temp,
        feels: align(main.time, main.vars.apparent_temperature, timeline) ?? temp,
        gust: align(main.time, main.vars.wind_gusts_10m, timeline) ?? timeline.map(() => NaN),
        det: true,
      });
      detModels.push('best_match');
    }
  }
  // Weights: ensembles 65 %, single models 35 %; each system counts equally
  // no matter how many members it has.
  const detShare = ensGroups.length ? 0.35 : 1;
  const ensShare = scen.length ? 0.65 : 1;
  const nDet = scen.length;
  for (const s of scen) s.w = detShare / nDet;
  for (const g of ensGroups) for (const s of g) s.w = ensShare / ensGroups.length / g.length;
  const all = [...scen, ...ensGroups.flat()];
  if (!all.length) throw new Error('Hiçbir modelden veri alınamadı');
  const weights = all.map((s) => s.w);
  const wsum = weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < weights.length; i++) weights[i] /= wsum;

  const v = main.vars;
  const L = (s?: (number | null)[], sh = false) => alignLoose(main.time, s, timeline, sh);
  const code = L(v.weather_code);
  const isDay = L(v.is_day);
  const wind = L(v.wind_speed_10m);
  const wdir = L(v.wind_direction_10m);
  const cape = L(v.cape);
  const steer = L(v.wind_speed_700hPa);
  const steerDir = L(v.wind_direction_700hPa);
  const rh700 = L(v.relative_humidity_700hPa);
  const bmMm = L(v.precipitation, true);
  const bmT = L(v.temperature_2m);
  const cloudMain = L(v.cloud_cover);
  const detClouds = inp.dets.map((d) => alignLoose(d.h.time, d.h.vars.cloud_cover, timeline));
  const prevMm = inp.prev ? alignLoose(inp.prev.time, inp.prev.vars.precipitation_previous_day1, timeline, true) : [];
  const prevT = inp.prev ? alignLoose(inp.prev.time, inp.prev.vars.temperature_2m_previous_day1, timeline) : [];

  const hours: HourOut[] = timeline.map((t, k) => {
    const det = all.filter((s) => s.det);
    const temps = all.map((s) => s.temp[k]);
    const temp = median(det.map((s) => s.temp[k]));
    const feels = median(det.map((s) => s.feels[k]));
    const wetBits = all.map((s) => s.precip[k] >= WET_MM);
    let p = 0;
    const wetAmounts: number[] = [];
    const wetW: number[] = [];
    all.forEach((s, i) => {
      if (wetBits[i]) {
        p += weights[i];
        wetAmounts.push(s.precip[k]);
        wetW.push(weights[i]);
      }
    });
    const gusts = all.map((s) => s.gust[k]).filter((g) => !isNaN(g));
    const gustW = all.filter((s) => !isNaN(s.gust[k])).map((s) => weights[all.indexOf(s)]);
    const clouds = detClouds.map((c) => c[k]).filter((c): c is number => c !== undefined);
    const cloud = clouds.length ? median(clouds) : (cloudMain[k] ?? 50);
    const local = new Date((t + tzOffset) * 1000);
    const tempMed = isNaN(temp) ? median(temps) : temp;
    const c = code[k];
    const snowCode = c !== undefined && ((c >= 71 && c <= 77) || c === 85 || c === 86);
    return {
      t,
      hour: local.getUTCHours(),
      dayIdx: Math.floor((t - dayStart) / 86400),
      past: t + 3600 <= now,
      temp: Math.round(tempMed * 10) / 10,
      tLo: Math.round(wq(temps, weights, 0.1) * 10) / 10,
      tHi: Math.round(wq(temps, weights, 0.9) * 10) / 10,
      feels: Math.round((isNaN(feels) ? tempMed : feels) * 10) / 10,
      pop: Math.min(1, 0.02 + 0.96 * p),
      mm: wetAmounts.length ? Math.round(wq(wetAmounts, wetW, 0.5) * 10) / 10 : 0,
      snow: snowCode || tempMed <= 1.5,
      cloud: Math.round(cloud),
      wind: Math.round(wind[k] ?? 0),
      gust: Math.round(gusts.length ? median(gusts) : (wind[k] ?? 0) * 1.5),
      gustHi: Math.round(gusts.length ? wq(gusts, gustW, 0.9) : (wind[k] ?? 0) * 1.8),
      windDir: Math.round(wdir[k] ?? 0),
      steer: steer[k] !== undefined ? Math.round(steer[k]!) : undefined,
      steerDir: steerDir[k] !== undefined ? Math.round(steerDir[k]!) : undefined,
      cape: cape[k] !== undefined ? Math.round(cape[k]!) : undefined,
      rh700: rh700[k] !== undefined ? Math.round(rh700[k]!) : undefined,
      code: c,
      isDay: isDay[k] !== undefined ? isDay[k] === 1 : local.getUTCHours() >= 7 && local.getUTCHours() < 18,
      wet: bitsToHex(wetBits),
      detWet: det.filter((s) => s.precip[k] >= WET_MM).length,
      detTotal: det.length,
      bmMm: bmMm[k],
      bmT: bmT[k],
      prevMm: prevMm[k],
      prevTemp: prevT[k],
    };
  });

  const pool: Pool = {
    weights: weights.map((w) => Math.round(w * 1e6) / 1e6),
    ensembleMembers: ensGroups.reduce((a, g) => a + g.length, 0),
    detModels,
    ensembleModels: ensModels,
  };
  return { hours, pool, dayStart };
}

/** Blend the radar/track result into the next 3 hourly probabilities. */
export function applyNowcast(hours: HourOut[], nc: Nowcast, now: number) {
  if (nc.source === 'none' || nc.state === 'unknown') return;
  const strength = nc.source === 'radar' ? 1 : 0.4;
  for (const h of hours) {
    const lead = (h.t - now) / 3600;
    if (h.t + 3600 <= now || lead >= 3) continue;
    const w = strength * (lead < 1 ? 0.75 : lead < 2 ? 0.55 : 0.3);
    let obs = 0.05;
    if (nc.etaMin !== undefined) {
      const s = now + nc.etaMin * 60;
      const e = nc.endMin !== undefined ? now + nc.endMin * 60 : now + 3 * 3600;
      if (s < h.t + 3600 && e > h.t) obs = 0.88 * (1 - (nc.dissipate ?? 0));
    }
    h.pop = Math.round((w * obs + (1 - w) * h.pop) * 1000) / 1000;
  }
  for (const h of hours) h.pop = Math.round(h.pop * 1000) / 1000;
}

const WEEKDAYS = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
const MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];

const PERIODS: [string, number, number][] = [
  ['Sabah', 6, 12],
  ['Öğleden sonra', 12, 18],
  ['Akşam', 18, 24],
  ['Gece', 24, 30],
];

function dayHeadline(main: WindowResult, periods: WindowResult[]) {
  const temps = periods
    .filter((p) => p.name !== 'Gece')
    .map((p) => `${p.name.toLowerCase()} ${Math.round((p.tMin + p.tMax) / 2)}°`)
    .join(', ');
  return `${main.summary} ${temps.charAt(0).toUpperCase() + temps.slice(1)}.`;
}

/** e.g. "Akşam için mont al, öğleden sonra ince ceket yeter." */
function clothingPlan(periods: WindowResult[]): Advice | undefined {
  const ps = periods.filter((p) => p.name !== 'Gece');
  if (ps.length < 2) return undefined;
  const lv = ps.map((p) => clothing(p.feelsMin));
  const levels = lv.map((l) => l.level);
  if (Math.max(...levels) === Math.min(...levels)) return undefined;
  const ci = levels.indexOf(Math.min(...levels));
  const wi = levels.indexOf(Math.max(...levels));
  const c = ps[ci];
  const w = ps[wi];
  const text =
    ci > wi
      ? `${c.name} için ${lv[ci].noun} al; ${w.name.toLowerCase()} ${lv[wi].noun} yeter`
      : `${c.name} ${lv[ci].noun} giy; ${w.name.toLowerCase()} ${lv[wi].noun} yeter`;
  const why = 'Hissedilen: ' + ps.map((p) => `${p.name.toLowerCase()} ${Math.round(p.feelsMin)}°`).join(' · ');
  return { icon: lv[ci].icon, text, why };
}

export function buildDays(hours: HourOut[], pool: Pool, dayStart: number, now: number, tzOffset: number, nowcast: Nowcast): DayOut[] {
  const days: DayOut[] = [];
  for (let d = 0; d < 3; d++) {
    const base = dayStart + d * 86400;
    const periods = PERIODS.map(([name, a, b]) => analyzeWindow(hours, pool, base + a * 3600, base + b * 3600, name, { now, nowcast })).filter(
      (x): x is WindowResult => !!x,
    );
    const from = d === 0 ? Math.max(base + 6 * 3600, Math.floor(now / 3600) * 3600) : base + 6 * 3600;
    const main =
      analyzeWindow(hours, pool, from, base + 24 * 3600, d === 0 ? 'Bugün' : 'Gün boyu', { now, nowcast }) ??
      analyzeWindow(hours, pool, from, base + 30 * 3600, 'Bu gece', { now, nowcast });
    if (!main) continue;
    const plan = clothingPlan(periods);
    if (plan) {
      // replace the generic clothing line (always first) and the layering hint
      main.advice = [plan, ...main.advice.slice(1).filter((a) => a.text !== 'Katmanlı giyin')];
    }
    main.advice = main.advice.slice(0, 4);
    const local = new Date((base + 12 * 3600 + tzOffset) * 1000);
    days.push({
      dayIdx: d,
      label: d === 0 ? 'Bugün' : d === 1 ? 'Yarın' : WEEKDAYS[local.getUTCDay()],
      date: `${local.getUTCDate()} ${MONTHS[local.getUTCMonth()]}`,
      main,
      periods,
      headline: dayHeadline(main, periods),
    });
  }
  return days;
}

export function nowSummary(hours: HourOut[], now: number, nc: Nowcast) {
  const i = hours.findIndex((h) => h.t <= now && h.t + 3600 > now);
  const h = hours[Math.max(0, i)];
  const n = hours[Math.min(hours.length - 1, Math.max(0, i) + 1)];
  const f = (now - h.t) / 3600;
  const temp = Math.round(h.temp + (n.temp - h.temp) * f);
  const feels = Math.round(h.feels + (n.feels - h.feels) * f);
  const raining = nc.state === 'raining' || (nc.source !== 'radar' && h.pop >= 0.6);
  const icon = raining ? (h.snow ? '🌨️' : '🌧️') : hourIcon({ ...h, pop: Math.min(h.pop, 0.29) });
  return { temp, feels, icon, text: raining ? (h.snow ? 'Kar yağıyor' : 'Yağmurlu') : codeText(h.code, h.cloud) };
}

function codeText(code: number | undefined, cloud: number) {
  if (code === 45 || code === 48) return 'Sisli';
  if (cloud >= 85) return 'Kapalı';
  if (cloud >= 50) return 'Parçalı bulutlu';
  if (cloud >= 20) return 'Az bulutlu';
  return 'Açık';
}
