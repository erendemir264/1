// Turns hourly scenario data into plain-language answers for any time window
// ("this evening", "tomorrow morning", "18:00-23:00 when I'm out").
// Runs on both the server and in the browser, so it has no Node dependencies.
import type { Advice, Confidence, HourOut, Nowcast, Pool, WindowResult } from './types';
import { fromDirTr } from './geo';

export function bitsToHex(bits: boolean[]): string {
  let s = '';
  for (let i = 0; i < bits.length; i += 4) {
    let v = 0;
    for (let k = 0; k < 4; k++) if (bits[i + k]) v |= 1 << k;
    s += v.toString(16);
  }
  return s;
}

function orHex(acc: Uint8Array, hex: string) {
  for (let c = 0; c < hex.length; c++) {
    const v = parseInt(hex[c], 16);
    for (let k = 0; k < 4; k++) if (v & (1 << k)) acc[c * 4 + k] = 1;
  }
}

const clamp = (x: number, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const hh = (h: number) => `${String(((h % 24) + 24) % 24).padStart(2, '0')}:00`;
const r = Math.round;

export function rainWord(mm: number, snow: boolean, thunder: boolean) {
  if (snow) return mm < 1 ? 'hafif kar' : 'kar';
  if (thunder) return 'gök gürültülü sağanak';
  if (mm < 0.05) return 'yağış'; // known only from radar tracking
  if (mm < 0.4) return 'çiseleme';
  if (mm < 2) return 'hafif yağmur';
  if (mm < 5) return 'yağmur';
  if (mm < 10) return 'kuvvetli yağmur';
  return 'çok kuvvetli sağanak';
}

/** Clothing level by the "feels like" temperature. */
export function clothing(feels: number): { level: number; icon: string; text: string; noun: string } {
  if (feels < -3) return { level: 0, icon: '🧤', text: 'Kalın mont, bere ve eldiven', noun: 'kalın mont' };
  if (feels < 5) return { level: 1, icon: '🧥', text: 'Mont giy', noun: 'mont' };
  if (feels < 11) return { level: 2, icon: '🧥', text: 'Ceket ya da kaban al', noun: 'ceket' };
  if (feels < 16) return { level: 3, icon: '🧶', text: 'İnce ceket veya hırka', noun: 'ince ceket' };
  if (feels < 21) return { level: 4, icon: '👕', text: 'Uzun kollu ince bir üst yeter', noun: 'uzun kollu' };
  if (feels < 27) return { level: 5, icon: '👕', text: 'Tişört havası', noun: 'tişört' };
  return { level: 6, icon: '🩳', text: 'İnce ve açık renk giy', noun: 'ince kıyafet' };
}

export function hourIcon(h: { pop: number; cloud: number; snow: boolean; isDay: boolean; cape?: number; code?: number }) {
  if (h.pop >= 0.4 && h.snow) return '🌨️';
  if (h.pop >= 0.35 && (h.cape ?? 0) >= 800) return '⛈️';
  if (h.pop >= 0.55) return '🌧️';
  if (h.pop >= 0.3) return h.isDay ? '🌦️' : '🌧️';
  if (h.code === 45 || h.code === 48) return '🌫️';
  if (h.cloud >= 80) return '☁️';
  if (h.cloud >= 45) return h.isDay ? '⛅' : '☁️';
  if (h.cloud >= 20) return h.isDay ? '🌤️' : '🌙';
  return h.isDay ? '☀️' : '🌙';
}

function quantile(vals: { v: number; w: number }[], q: number) {
  const s = [...vals].sort((a, b) => a.v - b.v);
  const tot = s.reduce((a, b) => a + b.w, 0);
  let acc = 0;
  for (const x of s) {
    acc += x.w;
    if (acc >= q * tot) return x.v;
  }
  return s[s.length - 1]?.v ?? 0;
}

/** Use the short-range rain tracking (radar) for windows that start within ~3 h. */
function nowcastAdjust(p: number, from: number, to: number, now: number, nc?: Nowcast) {
  if (!nc || nc.source === 'none' || nc.state === 'unknown') return p;
  const lead = (Math.max(from, now) - now) / 3600;
  if (lead > 3) return p;
  const strength = nc.source === 'radar' ? 1 : 0.4;
  const w = strength * (lead < 1 ? 0.75 : lead < 2 ? 0.55 : 0.3);
  const horizonEnd = now + 3 * 3600;
  let obs: number | null = null;
  if (nc.etaMin !== undefined) {
    const s = now + nc.etaMin * 60;
    const e = nc.endMin !== undefined ? now + nc.endMin * 60 : horizonEnd;
    if (s < to && e > from) obs = 0.88 * (1 - (nc.dissipate ?? 0));
  }
  if (obs === null) {
    if (to > horizonEnd) return p; // window extends past what tracking can see
    obs = 0.05;
  }
  return clamp(w * obs + (1 - w) * p);
}

export interface WindowCtx {
  now: number;
  nowcast?: Nowcast;
}

export function analyzeWindow(all: HourOut[], pool: Pool, from: number, to: number, name: string, ctx: WindowCtx): WindowResult | null {
  const hs = all.filter((h) => h.t >= from && h.t < to && h.t + 3600 > ctx.now);
  if (!hs.length) return null;
  const n = pool.weights.length;

  // Probability that it rains at some point in the window: count the
  // scenarios that are wet in ANY hour of the window (not the max of hours).
  const any = new Uint8Array(n);
  for (const h of hs) orHex(any, h.wet);
  let pRaw = 0;
  for (let i = 0; i < n; i++) if (any[i]) pRaw += pool.weights[i];
  let pRain = clamp(0.02 + 0.96 * pRaw);
  pRain = nowcastAdjust(pRain, from, to, ctx.now, ctx.nowcast);

  // When would it start? Spread of the first wet hour across scenarios.
  let onset: WindowResult['onset'];
  if (pRaw >= 0.2 && hs.length >= 3) {
    const firsts: { v: number; w: number }[] = [];
    const seen = new Uint8Array(n);
    hs.forEach((h, idx) => {
      const bits = new Uint8Array(n);
      orHex(bits, h.wet);
      for (let i = 0; i < n; i++)
        if (bits[i] && !seen[i]) {
          seen[i] = 1;
          firsts.push({ v: idx, w: pool.weights[i] });
        }
    });
    const lo = quantile(firsts, 0.2);
    const hi = quantile(firsts, 0.8);
    if (hi - lo >= 3) onset = { lo: hs[lo].hour, hi: hs[hi].hour };
  }

  // Hours worth mentioning
  const maxPop = Math.max(...hs.map((h) => h.pop));
  const thr = Math.max(0.25, maxPop * 0.7);
  const spans: WindowResult['rainSpans'] = [];
  for (const h of hs) {
    if (h.pop < thr) continue;
    const last = spans[spans.length - 1];
    if (last && last.to === h.t) {
      last.to = h.t + 3600;
      last.p = Math.max(last.p, h.pop);
    } else spans.push({ from: h.t, to: h.t + 3600, p: h.pop });
  }
  const spanHours = hs.filter((h) => h.pop >= thr);
  const mmTyp = spanHours.length ? spanHours.reduce((a, h) => a + h.mm, 0) / spanHours.length : 0;
  const snow = spanHours.some((h) => h.snow);
  const thunder = spanHours.some((h) => (h.cape ?? 0) >= 800 && h.pop >= 0.3);
  const word = rainWord(mmTyp, snow, thunder);

  const tMin = Math.min(...hs.map((h) => h.temp));
  const tMax = Math.max(...hs.map((h) => h.temp));
  const feelsMin = Math.min(...hs.map((h) => h.feels));
  const feelsMax = Math.max(...hs.map((h) => h.feels));
  const gustMax = Math.max(...hs.map((h) => h.gust));
  const gustHi = Math.max(...hs.map((h) => h.gustHi));
  const avg = (f: (h: HourOut) => number) => hs.reduce((a, h) => a + f(h), 0) / hs.length;
  const cloud = avg((h) => h.cloud);
  const steer = avg((h) => h.steer ?? 0);
  const steerDir = hs[Math.floor(hs.length / 2)].steerDir;
  const cape = Math.max(...hs.map((h) => h.cape ?? 0));
  const rh700 = avg((h) => h.rh700 ?? 70);
  const isDay = hs.filter((h) => h.isDay).length >= hs.length / 2;
  const fog = hs.some((h) => h.code === 45 || h.code === 48);

  // Did the forecast change since yesterday? (same model, same hours)
  let changed: string | undefined;
  const withPrev = hs.filter((h) => h.prevMm !== undefined && h.bmMm !== undefined);
  if (withPrev.length >= Math.min(4, hs.length)) {
    const prevSum = withPrev.reduce((a, h) => a + (h.prevMm ?? 0), 0);
    const nowSum = withPrev.reduce((a, h) => a + (h.bmMm ?? 0), 0);
    const dT = withPrev.reduce((a, h) => a + ((h.bmT ?? h.temp) - (h.prevTemp ?? h.temp)), 0) / withPrev.length;
    if (prevSum < 0.5 && nowSum >= 2) changed = 'Dünkü tahminde yağış yoktu, yeni verilerde yağış çıktı.';
    else if (prevSum >= 2 && nowSum < 0.5) changed = 'Dünkü tahminde yağış vardı, yeni veriler kuru gösteriyor.';
    else if (Math.abs(dT) >= 3) changed = `Sıcaklık tahmini dünden bu yana ${r(Math.abs(dT))}° ${dT > 0 ? 'yükseldi' : 'düştü'}.`;
  }

  // ---- confidence ----
  const tSpread = avg((h) => h.tHi - h.tLo);
  const gSpread = avg((h) => h.gustHi - h.gust);
  const cRain = Math.abs(2 * pRain - 1);
  const cTemp = clamp(1 - (tSpread - 2) / 6);
  const cGust = clamp(1 - gSpread / 30);
  const leadH = Math.max(0, (hs[0].t - ctx.now) / 3600);
  const leadF = clamp(1 - leadH / 240, 0.7, 1);
  let pct = 40 + 55 * (0.6 * cRain + 0.3 * cTemp + 0.1 * cGust) * leadF;
  if (changed) pct -= 7;
  pct = r(clamp(pct, 30, 95));
  let reason: string;
  if (cRain < 0.45) reason = `10 senaryodan ${clamp(r(pRain * 10), 1, 9)} tanesinde yağmur var, kalanında yok.`;
  else if (changed) reason = 'Tahmin dünden bu yana değişti.';
  else if (cTemp < 0.5) reason = `Sıcaklıkta ±${Math.max(2, r(tSpread / 2))}° oynama olabilir.`;
  else if (pct >= 80) reason = 'Modeller büyük ölçüde aynı şeyi söylüyor.';
  else reason = 'Zaman uzadıkça kesinlik azalıyor, yaklaştıkça netleşecek.';
  const confidence: Confidence = { pct, label: pct >= 80 ? 'Yüksek' : pct >= 62 ? 'Orta' : 'Düşük', reason };

  // ---- summary ----
  const spanTxt = spans.length
    ? spans
        .slice(0, 2)
        .map((s) => `${hh(all.find((h) => h.t === s.from)!.hour)}–${hh(all.find((h) => h.t === s.to - 3600)!.hour + 1)}`)
        .join(' ve ') + ' arası'
    : '';
  let summary: string;
  if (pRain < 0.15) summary = snow ? 'Kar beklenmiyor.' : 'Yağmur beklenmiyor.';
  else if (pRain < 0.35) summary = `Büyük ihtimalle kuru; ${spanTxt ? spanTxt + ' ' : ''}kısa bir ${word} ihtimali var.`;
  else if (pRain < 0.6) summary = `${spanTxt ? spanTxt + ' ' : ''}${word} ihtimali var.`;
  else summary = `${spanTxt ? spanTxt + ' ' : ''}${word} bekleniyor.`;
  summary = summary.charAt(0).toUpperCase() + summary.slice(1);

  // ---- advice ----
  const advice: Advice[] = [];
  const cl = clothing(feelsMin);
  advice.push({
    icon: cl.icon,
    text: cl.text,
    why: `Hissedilen en düşük ${r(feelsMin)}°${feelsMax - feelsMin >= 6 ? `, en yüksek ${r(feelsMax)}°` : ''}`,
  });
  if (feelsMax - feelsMin >= 8) {
    advice.push({ icon: '↕️', text: 'Katmanlı giyin', why: `Gün içinde ${r(feelsMin)}° ile ${r(feelsMax)}° arası değişiyor` });
  }
  const windyRain = gustMax >= 45 && pRain >= 0.3;
  if (snow && pRain >= 0.3) advice.push({ icon: '🥾', text: 'Kaymayan, su geçirmez ayakkabı', why: `Kar ihtimali %${r(pRain * 100)}` });
  else if (windyRain) advice.push({ icon: '🧥', text: 'Yağmurluk ya da kapüşon', why: `Rüzgar sert (${r(gustMax)} km/s), şemsiye zorlanır` });
  else if (pRain >= 0.55) advice.push({ icon: '☂️', text: 'Şemsiye al', why: `Yağmur ihtimali %${r(pRain * 100)}` });
  else if (pRain >= 0.3) advice.push({ icon: '🌂', text: 'Çantaya katlanır şemsiye at', why: `Yağmur ihtimali %${r(pRain * 100)}` });
  if (pRain >= 0.5 && mmTyp >= 4 && !snow) advice.push({ icon: '👟', text: 'Su geçirmez ayakkabı', why: 'Yağış kuvvetli olabilir' });
  if (gustMax >= 50 && !windyRain) advice.push({ icon: '🌬️', text: 'Rüzgarlık işe yarar', why: `Hamleler ${r(gustMax)} km/s` });
  if (feelsMax >= 32) advice.push({ icon: '💧', text: 'Yanına su al', why: `Hissedilen ${r(feelsMax)}°` });
  if (tMin <= 1 && hs.some((h) => h.pop >= 0.3)) advice.push({ icon: '⚠️', text: 'Yollarda buzlanma olabilir', why: `Sıcaklık ${r(tMin)}°` });

  // ---- warnings: short "why it might be different" notes ----
  const warnings: string[] = [];
  if (changed) warnings.push(changed);
  if (steer >= 35 && pRain >= 0.2 && pRain <= 0.75) {
    warnings.push(
      `Bulutları taşıyan rüzgar kuvvetli (${steerDir !== undefined ? fromDirTr(steerDir) + ' ' : ''}${r(steer)} km/s): yağış 1-2 saat erken/geç gelebilir ve kısa sürer.`,
    );
  }
  if (onset) warnings.push(`Yağışın başlama saati net değil (${hh(onset.lo)}–${hh(onset.hi)} arası).`);
  if (cape >= 800 && pRain >= 0.2 && pRain <= 0.75) warnings.push('Sağanak tipi: her yere düşmeyebilir, düşerse kısa ve kuvvetli olur.');
  if (rh700 < 50 && pRain >= 0.2 && pRain <= 0.6) warnings.push('Üst katmanlarda hava kuru; zayıf bulutlar yağmur bırakmadan dağılabilir.');
  if (gustHi >= 65) warnings.push(`Fırtına ihtimali: hamleler ${r(gustHi)} km/s'ye çıkabilir.`);
  if (fog) warnings.push('Sis bekleniyor; araç kullanıyorsan dikkat.');
  if (pRain < 0.2 && cloud >= 85 && rh700 >= 85) warnings.push('Hava kapalı ve nemli; hafif çiseleme sürpriz olmaz.');

  return {
    from,
    to,
    name,
    pRain,
    rainWord: word,
    snow,
    rainSpans: spans,
    onset,
    tMin,
    tMax,
    feelsMin,
    feelsMax,
    gustMax,
    icon: hourIcon({ pop: pRain, cloud, snow, isDay, cape, code: fog ? 45 : undefined }),
    summary,
    confidence,
    advice: advice.slice(0, 4),
    warnings: warnings.slice(0, 3),
    changed,
  };
}
