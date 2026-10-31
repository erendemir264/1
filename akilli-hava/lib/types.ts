// Shared types between the server analysis and the client UI.

export interface HourOut {
  t: number; // unix seconds (start of hour)
  hour: number; // local hour 0-23
  dayIdx: number; // 0 = today, 1 = tomorrow ...
  past: boolean;
  temp: number; // multi-model median
  tLo: number; // p10 of all scenarios
  tHi: number; // p90 of all scenarios
  feels: number;
  pop: number; // 0..1 rain probability for this hour (incl. nowcast)
  mm: number; // typical amount if it rains (mm/h)
  snow: boolean;
  cloud: number; // %
  wind: number; // km/h
  gust: number; // km/h median
  gustHi: number; // km/h p90
  windDir: number; // deg, from
  steer?: number; // 700 hPa wind speed (km/h) = cloud steering wind
  steerDir?: number; // deg, from
  cape?: number;
  rh700?: number;
  code?: number; // WMO weather code (best match)
  isDay: boolean;
  wet: string; // hex bitmask: which scenarios rain in this hour
  detWet: number; // how many deterministic models rain this hour
  detTotal: number;
  bmMm?: number; // best-match model now (to compare like with like)
  bmT?: number;
  prevMm?: number; // what yesterday's forecast said for this hour
  prevTemp?: number;
}

export interface RainCell {
  lat: number;
  lon: number;
  v: number; // intensity / presence 0..1+
}

export interface Nowcast {
  source: 'radar' | 'model' | 'none';
  state: 'raining' | 'approaching' | 'passing' | 'clear' | 'unknown';
  etaMin?: number;
  etaLo?: number;
  etaHi?: number;
  endMin?: number;
  fromDir?: string; // Turkish compass word, e.g. "batı"
  distanceKm?: number;
  speedKmh?: number;
  trend?: 'güçleniyor' | 'zayıflıyor' | 'sabit';
  dissipate?: number; // 0..1 chance it falls apart before reaching user
  message: string;
  detail?: string;
  cells: RainCell[];
  motion?: { dirTo: number; speedKmh: number };
  radarTime?: number;
}

export interface Pool {
  weights: number[]; // weight per scenario (sum = 1)
  ensembleMembers: number;
  detModels: string[];
  ensembleModels: string[];
}

export interface Advice {
  icon: string;
  text: string;
  why?: string;
}

export interface Confidence {
  pct: number;
  label: 'Yüksek' | 'Orta' | 'Düşük';
  reason: string;
}

export interface WindowResult {
  from: number;
  to: number;
  name: string;
  pRain: number;
  rainWord: string; // "hafif yağmur" etc.
  snow: boolean;
  rainSpans: { from: number; to: number; p: number }[];
  onset?: { lo: number; hi: number };
  tMin: number;
  tMax: number;
  feelsMin: number;
  feelsMax: number;
  gustMax: number;
  icon: string;
  summary: string;
  confidence: Confidence;
  advice: Advice[];
  warnings: string[];
  changed?: string;
}

export interface DayOut {
  dayIdx: number;
  label: string; // Bugün / Yarın / Cumartesi
  date: string; // 31 Ekim
  main: WindowResult;
  periods: WindowResult[];
  headline: string;
}

export interface ForecastResponse {
  location: { lat: number; lon: number; tzOffset: number; timezone: string };
  generatedAt: number;
  now: { temp: number; feels: number; icon: string; text: string };
  nowcast: Nowcast;
  days: DayOut[];
  hours: HourOut[];
  pool: Pool;
  sources: string[];
}
