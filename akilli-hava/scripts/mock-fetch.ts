// Synthetic Open-Meteo + RainViewer responses for offline testing.
// Scenario: dry, cool today; a rain front arrives from the west tomorrow afternoon,
// models disagree on its timing. Radar shows a rain blob ~60 km west moving east.
import { PNG } from 'pngjs';

const SCN = process.env.SCN ?? 'front';
let seed = 42;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const now = Math.floor(Date.now() / 1000);
const off = 3 * 3600;
const dayStart = Math.floor((now + off) / 86400) * 86400 - off;
const start = dayStart - 86400;
const times = Array.from({ length: 5 * 24 }, (_, i) => start + i * 3600);
const localH = (t: number) => new Date((t + off) * 1000).getUTCHours();

function member(shiftH: number, dry: boolean, tBias: number, amp = 1) {
  const front = dayStart + 86400 + 14 * 3600 + shiftH * 3600; // tomorrow 14:00
  return times.map((t) => {
    const h = localH(t);
    const diurnal = 12 + 5 * Math.sin(((h - 9) / 24) * 2 * Math.PI);
    const after = t >= front;
    const temp = diurnal + tBias - (after ? 4 : 0) + (rnd() - 0.5);
    let precip = 0;
    if (!dry && t >= front && t < front + 5 * 3600) precip = amp * (1 + 2 * rnd());
    if (SCN === 'now' && t >= now - 3600 && t < now + 2 * 3600) precip = 1.2;
    return { temp, feels: temp - 2.5, precip, gust: after ? 45 + 10 * rnd() : 20 + 8 * rnd(), cloud: after ? 95 : t > front - 6 * 3600 ? 70 : 20 };
  });
}

function json(o: unknown) {
  return new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
}

function hourly(m: ReturnType<typeof member>, suffix = '') {
  const s = (k: string) => k + suffix;
  return {
    time: times,
    [s('temperature_2m')]: m.map((x) => x.temp),
    [s('apparent_temperature')]: m.map((x) => x.feels),
    [s('precipitation')]: m.map((x) => x.precip),
    [s('cloud_cover')]: m.map((x) => x.cloud),
    [s('wind_gusts_10m')]: m.map((x) => x.gust),
  };
}

function radarPng(url: string) {
  const m = url.match(/\/256\/(\d+)\/(\d+)\/(\d+)\//)!;
  const [z, tx, ty] = [1, 2, 3].map((i) => +m[i]);
  const png = new PNG({ width: 256, height: 256 });
  const n = 2 ** z;
  const lat = 41.01, lon = 28.97;
  const gx = ((lon + 180) / 360) * n * 256;
  const r = (lat * Math.PI) / 180;
  const gy = ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n * 256;
  const coverage = url.includes('coverage');
  const old = url.includes('OLD');
  const cx = gx - (old ? 84 : 63);
  const cy = gy + 5;
  for (let y = 0; y < 256; y++)
    for (let x = 0; x < 256; x++) {
      const px = tx * 256 + x, py = ty * 256 + y;
      const inBlob = SCN !== 'clear' && (px - cx) ** 2 / 30 ** 2 + (py - cy) ** 2 / 45 ** 2 <= 1;
      const i = (y * 256 + x) * 4;
      if (coverage || inBlob) {
        png.data[i] = 30; png.data[i + 1] = 90; png.data[i + 2] = 200; png.data[i + 3] = coverage ? 60 : 255;
      }
    }
  return new Response(PNG.sync.write(png), { status: 200, headers: { 'content-type': 'image/png' } });
}

globalThis.fetch = (async (input: any) => {
  const url = typeof input === 'string' ? input : input.url;
  const u = new URL(url);
  const q = u.searchParams;
  if (u.hostname === 'api.rainviewer.com') {
    if (process.env.NORADAR) return new Response('no', { status: 503 });
    return json({ host: 'https://tilecache.rainviewer.com', radar: { past: [0, 1, 2, 3].map((i) => ({ time: now - (3 - i) * 600, path: `/v2/radar/${i === 3 ? 'NEW' : i === 0 ? 'OLD' : 'MID' + i}` })) } });
  }
  if (u.hostname === 'tilecache.rainviewer.com') return radarPng(url);
  const model = q.get('models')!;
  if (u.hostname === 'ensemble-api.open-meteo.com') {
    const nMem = model === 'ecmwf_ifs025' ? 51 : model === 'gfs025' ? 31 : 40;
    const h: any = { time: times };
    for (let k = 0; k < nMem; k++) {
      const m = member(Math.round((rnd() - 0.5) * 6), rnd() < 0.25, (rnd() - 0.5) * 3);
      const sfx = k === 0 ? '' : `_member${String(k).padStart(2, '0')}`;
      h['temperature_2m' + sfx] = m.map((x) => x.temp);
      h['apparent_temperature' + sfx] = m.map((x) => x.feels);
      h['precipitation' + sfx] = m.map((x) => x.precip);
      h['wind_gusts_10m' + sfx] = m.map((x) => x.gust);
    }
    return json({ utc_offset_seconds: off, timezone: 'Europe/Istanbul', hourly: h });
  }
  if (u.hostname === 'previous-runs-api.open-meteo.com') {
    const m = member(0, true, 0); // yesterday: "dry tomorrow"
    return json({ utc_offset_seconds: off, hourly: { time: times, precipitation: member(0, false, 0).map((x) => x.precip), temperature_2m: m.map((x) => x.temp), precipitation_previous_day1: m.map((x) => x.precip), temperature_2m_previous_day1: m.map((x) => x.temp) } });
  }
  if (q.get('latitude')!.includes(',')) {
    const lats = q.get('latitude')!.split(',');
    return json(lats.map(() => ({ hourly: { time: times, precipitation: times.map(() => (rnd() < 0.1 ? 0.5 : 0)) } })));
  }
  if (model === 'best_match') {
    const m = member(0, false, 0);
    const h: any = hourly(m);
    h.weather_code = times.map(() => 2);
    h.wind_speed_10m = times.map(() => 18);
    h.wind_direction_10m = times.map(() => 270);
    h.is_day = times.map((t) => (localH(t) >= 7 && localH(t) < 18 ? 1 : 0));
    h.cape = times.map(() => 150);
    h.wind_speed_700hPa = times.map(() => 42);
    h.wind_direction_700hPa = times.map(() => 268);
    h.relative_humidity_700hPa = times.map(() => 75);
    return json({ utc_offset_seconds: off, timezone: 'Europe/Istanbul', hourly: h });
  }
  if (model === 'ukmo_seamless') return new Response(JSON.stringify({ error: true, reason: 'Invalid model' }), { status: 400 });
  const m = member(Math.round((rnd() - 0.5) * 4), model === 'gfs_seamless', (rnd() - 0.5) * 2);
  return json({ utc_offset_seconds: off, hourly: hourly(m, model === 'icon_seamless' ? '_icon_seamless' : '') });
}) as typeof fetch;
