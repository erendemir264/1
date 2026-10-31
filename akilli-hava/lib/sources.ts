// Data fetching from Open-Meteo (free, no key). Every source is optional:
// if a model or service fails, the analysis continues with the rest.

const FORECAST = 'https://api.open-meteo.com/v1/forecast';
const ENSEMBLE = 'https://ensemble-api.open-meteo.com/v1/ensemble';
const PREVIOUS = 'https://previous-runs-api.open-meteo.com/v1/forecast';

// Independent global/regional weather models that cover Turkey & Europe.
export const DET_MODELS = [
  'ecmwf_ifs025',
  'icon_seamless',
  'gfs_seamless',
  'meteofrance_seamless',
  'ukmo_seamless',
  'gem_seamless',
];

// Ensemble systems: each one runs the same model many times with slightly
// different starting conditions. The spread tells us how certain the future is.
export const ENS_MODELS = ['ecmwf_ifs025', 'icon_seamless', 'gfs025'];

const BASE_VARS = ['temperature_2m', 'apparent_temperature', 'precipitation', 'cloud_cover', 'wind_gusts_10m'];
const MAIN_VARS = [
  ...BASE_VARS,
  'weather_code',
  'wind_speed_10m',
  'wind_direction_10m',
  'is_day',
  'cape',
  'wind_speed_700hPa',
  'wind_direction_700hPa',
  'relative_humidity_700hPa',
];

export type Series = Record<string, (number | null)[]>;
export interface Hourly {
  time: number[];
  vars: Series;
}
export interface EnsembleSet {
  model: string;
  time: number[];
  members: Series[]; // one Series per member (control = first)
}

async function getJSON(url: string, revalidate: number, timeoutMs = 9000): Promise<any> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    next: { revalidate },
  } as RequestInit);
  if (!res.ok) {
    let reason = '';
    try {
      reason = (await res.json())?.reason ?? '';
    } catch {}
    throw new Error(`HTTP ${res.status} ${reason}`.trim());
  }
  return res.json();
}

function common(lat: number, lon: number) {
  return `latitude=${lat}&longitude=${lon}&timezone=auto&timeformat=unixtime&wind_speed_unit=kmh`;
}

/** Pick a variable from an hourly block, accepting both plain and model-suffixed keys. */
function pickVar(hourly: any, v: string, model?: string): (number | null)[] | undefined {
  if (Array.isArray(hourly[v])) return hourly[v];
  if (model && Array.isArray(hourly[`${v}_${model}`])) return hourly[`${v}_${model}`];
  return undefined;
}

export async function fetchMain(lat: number, lon: number) {
  const url = `${FORECAST}?${common(lat, lon)}&hourly=${MAIN_VARS.join(',')}&models=best_match&past_days=1&forecast_days=4`;
  const j = await getJSON(url, 900);
  const vars: Series = {};
  for (const v of MAIN_VARS) {
    const s = pickVar(j.hourly, v, 'best_match');
    if (s) vars[v] = s;
  }
  return {
    hourly: { time: j.hourly.time as number[], vars } as Hourly,
    tzOffset: (j.utc_offset_seconds as number) ?? 0,
    timezone: (j.timezone as string) ?? 'UTC',
  };
}

export async function fetchDet(lat: number, lon: number, model: string): Promise<Hourly> {
  const url = `${FORECAST}?${common(lat, lon)}&hourly=${BASE_VARS.join(',')}&models=${model}&past_days=1&forecast_days=4`;
  const j = await getJSON(url, 1800);
  const vars: Series = {};
  for (const v of BASE_VARS) {
    const s = pickVar(j.hourly, v, model);
    if (s) vars[v] = s;
  }
  if (!vars.precipitation || vars.precipitation.every((x) => x == null)) throw new Error('no data');
  return { time: j.hourly.time, vars };
}

const ENS_VARS = ['temperature_2m', 'apparent_temperature', 'precipitation', 'wind_gusts_10m'];

export async function fetchEnsemble(lat: number, lon: number, model: string): Promise<EnsembleSet> {
  const url = `${ENSEMBLE}?${common(lat, lon)}&hourly=${ENS_VARS.join(',')}&models=${model}&past_days=1&forecast_days=4`;
  const j = await getJSON(url, 3600, 12000);
  const byMember = new Map<number, Series>();
  for (const key of Object.keys(j.hourly)) {
    for (const v of ENS_VARS) {
      // temperature_2m | temperature_2m_member07 | temperature_2m_member07_<model>
      const m = key.match(new RegExp(`^${v}(?:_member(\\d+))?(?:_${model}\\w*)?$`));
      if (!m) continue;
      const id = m[1] ? parseInt(m[1], 10) : 0;
      if (!byMember.has(id)) byMember.set(id, {});
      byMember.get(id)![v] = j.hourly[key];
    }
  }
  const members = [...byMember.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, s]) => s)
    .filter((s) => s.precipitation && s.temperature_2m && s.precipitation.some((x) => x != null));
  if (members.length < 5) throw new Error('too few members');
  return { model, time: j.hourly.time, members };
}

/** What did the forecast from 24 h ago say for the same hours? */
export async function fetchPrevious(lat: number, lon: number) {
  const vars = ['precipitation', 'temperature_2m', 'precipitation_previous_day1', 'temperature_2m_previous_day1'];
  const url = `${PREVIOUS}?${common(lat, lon)}&hourly=${vars.join(',')}&models=best_match&past_days=1&forecast_days=3`;
  const j = await getJSON(url, 3600);
  const out: Hourly = { time: j.hourly.time, vars: {} };
  for (const v of vars) {
    const s = pickVar(j.hourly, v, 'best_match');
    if (s) out.vars[v] = s;
  }
  return out;
}

/** Hourly precipitation at many points around the user (one request). */
export async function fetchGrid(points: { lat: number; lon: number }[]) {
  const lats = points.map((p) => p.lat.toFixed(3)).join(',');
  const lons = points.map((p) => p.lon.toFixed(3)).join(',');
  const url = `${FORECAST}?latitude=${lats}&longitude=${lons}&hourly=precipitation&models=best_match&timeformat=unixtime&timezone=GMT&past_days=1&forecast_days=2`;
  const j = await getJSON(url, 900, 10000);
  const arr = Array.isArray(j) ? j : [j];
  return arr.map((r: any) => ({ time: r.hourly.time as number[], precip: r.hourly.precipitation as (number | null)[] }));
}
