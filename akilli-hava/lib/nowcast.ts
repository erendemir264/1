// Short-range (0-3 h) rain tracking: where is the rain now, which way is the
// wind pushing it, will it reach the user, when, and is it growing or dying?
import type { Nowcast, RainCell } from './types';
import { bearingOf, compassTr, fromDirTr, fromXY, posTr, toRad, towardTr } from './geo';
import type { RadarField } from './radar';

interface KmCell {
  x: number; // km east of user
  y: number; // km north of user
  v: number; // presence (radar) or 1 (model point)
  trend?: number; // >1 growing, <1 weakening
}

interface TrackOpts {
  cellArea: number; // km² represented by one cell
  radius: number; // km around the user that counts as "here"
  minFrac: number; // share of that disk that must be wet
  horizon: number; // minutes
}

/** Move the rain field with the wind and see what happens at the user. */
export function track(cells: KmCell[], vx: number, vy: number, o: TrackOpts) {
  const disk = Math.PI * o.radius * o.radius;
  const fracAt = (t: number) => {
    let s = 0;
    for (const c of cells) {
      const x = c.x + vx * t;
      const y = c.y + vy * t;
      if (x * x + y * y <= o.radius * o.radius) s += c.v * o.cellArea;
    }
    return Math.min(1, s / disk);
  };
  let eta: number | undefined;
  let end: number | undefined;
  for (let t = 0; t <= o.horizon; t += 5) {
    const wet = fracAt(t) >= o.minFrac;
    if (wet && eta === undefined) eta = t;
    if (!wet && eta !== undefined && end === undefined) {
      end = t;
      break;
    }
  }
  // closest approach of any rain (for "it will pass next to you")
  let closest = Infinity;
  let closestT = 0;
  for (const c of cells) {
    if (c.v < 0.3) continue;
    const vv = vx * vx + vy * vy;
    let t = vv > 0 ? -(c.x * vx + c.y * vy) / vv : 0;
    t = Math.max(0, Math.min(o.horizon, t));
    const d = Math.hypot(c.x + vx * t, c.y + vy * t);
    if (d < closest) {
      closest = d;
      closestT = t;
    }
  }
  return { eta, end, closest, closestT };
}

function fmtMin(m: number) {
  if (m < 60) return `${Math.max(5, Math.round(m / 5) * 5)} dk`;
  const h = Math.round((m / 60) * 2) / 2;
  return `${String(h).replace('.', ',')} saat`;
}

function trendWord(g: number): Nowcast['trend'] {
  if (g < 0.75) return 'zayıflıyor';
  if (g > 1.3) return 'güçleniyor';
  return 'sabit';
}

function dissipationChance(eta: number, growth: number, rh700?: number) {
  let c = 0.08 + (eta / 180) * 0.25;
  if (growth < 0.75) c += 0.25;
  else if (growth < 0.95) c += 0.1;
  if (growth > 1.3) c -= 0.08;
  if (rh700 !== undefined && rh700 < 55) c += 0.12;
  return Math.max(0.03, Math.min(0.85, c));
}

function build(
  source: 'radar' | 'model',
  cells: KmCell[],
  vx: number,
  vy: number,
  growth: number,
  opts: TrackOpts,
  lat: number,
  lon: number,
  rh700?: number,
): Nowcast {
  const speed = Math.hypot(vx, vy) * 60;
  const dirTo = bearingOf(vx, vy);
  const res = track(cells, vx, vy, opts);
  const wet = cells.filter((c) => c.v >= 0.3);
  let nearest: KmCell | undefined;
  for (const c of wet) if (!nearest || Math.hypot(c.x, c.y) < Math.hypot(nearest.x, nearest.y)) nearest = c;
  const mapCells: RainCell[] = wet
    .filter((c) => Math.hypot(c.x, c.y) < 200)
    .slice(0, 400)
    .map((c) => ({ ...fromXY(lat, lon, c.x, c.y), v: Math.round(c.v * 100) / 100 }));
  const tag = source === 'radar' ? 'Radar' : 'Model';
  const base = { source, cells: mapCells, motion: { dirTo, speedKmh: Math.round(speed) }, trend: trendWord(growth) };
  const windFrom = fromDirTr(dirTo + 180);

  if (res.eta === 0) {
    const endTxt = res.end ? `, yaklaşık ${fmtMin(res.end)} içinde geçmesi bekleniyor` : '';
    return {
      ...base,
      state: 'raining',
      etaMin: 0,
      endMin: res.end,
      speedKmh: Math.round(speed),
      message: `Şu an bulunduğun yerde yağış var${endTxt}.`,
      detail: `${tag}: yağış ${windFrom} ${Math.round(speed)} km/s hızla ilerliyor, ${trendWord(growth)}.`,
    };
  }
  if (res.eta !== undefined && nearest) {
    const dist = Math.round(Math.hypot(nearest.x, nearest.y));
    const diss = dissipationChance(res.eta, growth, rh700);
    const spread = Math.max(10, Math.round(res.eta * 0.3));
    const dissTxt =
      diss >= 0.45 ? ' Yolda dağılma ihtimali yüksek.' : diss >= 0.25 ? ' Yolda zayıflayıp dağılabilir.' : '';
    return {
      ...base,
      state: 'approaching',
      etaMin: res.eta,
      etaLo: Math.max(0, res.eta - spread),
      etaHi: res.eta + spread,
      endMin: res.end,
      fromDir: compassTr(bearingOf(nearest.x, nearest.y)),
      distanceKm: dist,
      speedKmh: Math.round(speed),
      dissipate: Math.round(diss * 100) / 100,
      message:
        source === 'radar'
          ? `Yağmur yaklaşıyor: yaklaşık ${fmtMin(res.eta)} sonra başlayabilir.${dissTxt}`
          : `Modellere göre yakında (~${fmtMin(res.eta)}) yağış gelebilir.${dissTxt}`,
      detail: `${tag}: yağış bulutu ${dist} km ${posTr(bearingOf(nearest.x, nearest.y))}, ${windFrom} ${Math.round(
        speed,
      )} km/s ile geliyor ve ${trendWord(growth)}.`,
    };
  }
  if (nearest && res.closest < 40) {
    const dist = Math.round(Math.hypot(nearest.x, nearest.y));
    return {
      ...base,
      state: 'passing',
      fromDir: compassTr(bearingOf(nearest.x, nearest.y)),
      distanceKm: dist,
      speedKmh: Math.round(speed),
      message: `Yakındaki yağış büyük ihtimalle sana uğramadan geçecek (en yakın ~${Math.round(res.closest)} km).`,
      detail: `${tag}: yağış ${dist} km ${posTr(bearingOf(nearest.x, nearest.y))}; rüzgar onu ${towardTr(dirTo)} taşıyor. Rüzgar dönerse gelebilir.`,
    };
  }
  return {
    ...base,
    state: 'clear',
    speedKmh: Math.round(speed),
    message: 'Önümüzdeki 2-3 saatte yakınına yağış gelmesi beklenmiyor.',
    detail: nearest
      ? `${tag}: en yakın yağış ~${Math.round(Math.hypot(nearest.x, nearest.y))} km ${posTr(bearingOf(nearest.x, nearest.y))}, sana doğru gelmiyor.`
      : `${tag}: çevrende ~150 km içinde yağış görünmüyor.`,
  };
}

/** Find the best displacement between two radar frames (block matching). */
export function estimateMotion(a: Float32Array, b: Float32Array, W: number, H: number, maxShift: number) {
  const blur = (g: Float32Array) => {
    const o = new Float32Array(g.length);
    for (let y = 1; y < H - 1; y++)
      for (let x = 1; x < W - 1; x++) {
        let s = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += g[(y + dy) * W + x + dx];
        o[y * W + x] = s / 9;
      }
    return o;
  };
  const A = blur(a);
  const B = blur(b);
  let best = { dx: 0, dy: 0, err: Infinity };
  let zeroErr = Infinity;
  for (let sy = -maxShift; sy <= maxShift; sy++) {
    for (let sx = -maxShift; sx <= maxShift; sx++) {
      let err = 0;
      let n = 0;
      for (let y = maxShift; y < H - maxShift; y++) {
        for (let x = maxShift; x < W - maxShift; x++) {
          const bv = B[y * W + x];
          const av = A[(y - sy) * W + (x - sx)];
          if (bv === 0 && av === 0) continue;
          const d = bv - av;
          err += d * d;
          n++;
        }
      }
      if (n < 20) continue;
      // fixed region normalisation so empty overlaps don't win
      err = err / ((W - 2 * maxShift) * (H - 2 * maxShift));
      if (sx === 0 && sy === 0) zeroErr = err;
      // tiny preference for smaller shifts breaks ties
      const score = err * (1 + 0.002 * (sx * sx + sy * sy));
      if (score < best.err) best = { dx: sx, dy: sy, err: score };
    }
  }
  return { ...best, zeroErr };
}

export function radarNowcast(f: RadarField, lat: number, lon: number, steer?: { speed: number; dirFrom: number }, rh700?: number): Nowcast | null {
  let total = 0;
  for (let i = 0; i < f.newer.length; i++) total += f.newer[i];
  const anyEcho = total > 3;
  if (!anyEcho && f.covered !== true) return null; // can't tell "no rain" from "no radar"
  if (f.covered === false) return null;

  // motion in km per minute
  let vx: number;
  let vy: number;
  let oldTotal = 0;
  for (let i = 0; i < f.older.length; i++) oldTotal += f.older[i];
  const maxShift = Math.min(20, Math.ceil((150 * (f.minutesBetween / 60)) / f.cellKm));
  const m = total > 15 && oldTotal > 15 ? estimateMotion(f.older, f.newer, f.W, f.H, maxShift) : null;
  if (m && m.err < m.zeroErr * 0.97) {
    vx = (m.dx * f.cellKm) / f.minutesBetween;
    vy = (-m.dy * f.cellKm) / f.minutesBetween; // grid y grows southwards
  } else if (steer) {
    const to = toRad(steer.dirFrom + 180);
    vx = (Math.sin(to) * steer.speed * 0.85) / 60;
    vy = (Math.cos(to) * steer.speed * 0.85) / 60;
  } else {
    vx = 0;
    vy = 0;
  }
  // growth of rain area around the user (within ~150 km)
  const R = 150 / f.cellKm;
  let gNew = 0;
  let gOld = 0;
  const cells: KmCell[] = [];
  for (let cy = 0; cy < f.H; cy++)
    for (let cx = 0; cx < f.W; cx++) {
      const dx = cx - f.ux;
      const dy = cy - f.uy;
      if (dx * dx + dy * dy > R * R) continue;
      const i = cy * f.W + cx;
      gNew += f.newer[i];
      gOld += f.older[i];
      if (f.newer[i] > 0.05) cells.push({ x: dx * f.cellKm, y: -dy * f.cellKm, v: f.newer[i] });
    }
  const growth = gOld > 2 ? gNew / gOld : 1;
  const nc = build(
    'radar',
    cells,
    vx,
    vy,
    growth,
    { cellArea: f.cellKm * f.cellKm, radius: 8, minFrac: 0.25, horizon: 180 },
    lat,
    lon,
    rh700,
  );
  nc.radarTime = f.time;
  return nc;
}

export interface GridPoint {
  x: number;
  y: number;
  now: number;
  before: number;
  after: number;
}

export function modelNowcast(points: GridPoint[], lat: number, lon: number, steer: { speed: number; dirFrom: number }, rh700?: number): Nowcast {
  const to = toRad(steer.dirFrom + 180);
  const vx = (Math.sin(to) * steer.speed * 0.85) / 60;
  const vy = (Math.cos(to) * steer.speed * 0.85) / 60;
  const cells: KmCell[] = points
    .filter((p) => p.now >= 0.2)
    .map((p) => ({ x: p.x, y: p.y, v: Math.min(1, 0.4 + p.now / 2) }));
  let past = 0;
  let fut = 0;
  for (const p of points) {
    if (p.now < 0.2 && p.before < 0.2) continue;
    past += p.before + p.now;
    fut += p.now + p.after;
  }
  const growth = past > 0.3 ? fut / past : 1;
  return build('model', cells, vx, vy, growth, { cellArea: Math.PI * 14 * 14, radius: 18, minFrac: 0.25, horizon: 180 }, lat, lon, rh700);
}
