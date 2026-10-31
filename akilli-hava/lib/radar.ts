// Real precipitation radar from RainViewer (free, attribution required).
// We download the last radar frames around the user, turn them into a coarse
// grid (~4 km cells) and later track how the rain field moves between frames.
import { PNG } from 'pngjs';
import { toRad } from './geo';

const MAPS = 'https://api.rainviewer.com/public/weather-maps.json';
const COVERAGE = 'https://tilecache.rainviewer.com/v2/coverage/0/256';
export const RADAR_ZOOM = 7;
const F = 4; // pixels per grid cell

export interface RadarField {
  W: number;
  H: number;
  cellKm: number;
  ux: number; // user position in cell coordinates
  uy: number;
  older: Float32Array; // presence 0..1 per cell
  newer: Float32Array;
  minutesBetween: number;
  time: number; // unix time of newest frame
  covered: boolean | null;
  toLatLon: (cx: number, cy: number) => { lat: number; lon: number };
  host: string;
  path: string;
}

async function fetchPng(url: string) {
  const res = await fetch(url, { signal: AbortSignal.timeout(7000), next: { revalidate: 300 } } as RequestInit);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return PNG.sync.read(Buffer.from(await res.arrayBuffer()));
}

function mosaicToGrid(tiles: PNG[]) {
  // tiles in order: (0,0) (1,0) (0,1) (1,1)
  const size = 512;
  const W = size / F;
  const grid = new Float32Array(W * W);
  tiles.forEach((png, i) => {
    const ox = (i % 2) * 256;
    const oy = Math.floor(i / 2) * 256;
    const w = png.width; // usually 256
    const scale = w / 256;
    for (let y = 0; y < 256; y++) {
      for (let x = 0; x < 256; x++) {
        const idx = (Math.floor(y * scale) * w + Math.floor(x * scale)) * 4;
        if (png.data[idx + 3] >= 100) {
          const cx = Math.floor((ox + x) / F);
          const cy = Math.floor((oy + y) / F);
          grid[cy * W + cx] += 1 / (F * F);
        }
      }
    }
  });
  return { grid, W };
}

export async function fetchRadar(lat: number, lon: number): Promise<RadarField> {
  const res = await fetch(MAPS, { signal: AbortSignal.timeout(5000), next: { revalidate: 120 } } as RequestInit);
  if (!res.ok) throw new Error(`maps HTTP ${res.status}`);
  const maps = await res.json();
  const past: { time: number; path: string }[] = maps?.radar?.past ?? [];
  if (past.length < 3) throw new Error('not enough radar frames');
  const host: string = maps.host ?? 'https://tilecache.rainviewer.com';
  const newest = past[past.length - 1];
  const older = past[Math.max(0, past.length - 4)]; // ~30 min earlier

  const n = 2 ** RADAR_ZOOM;
  const gx = ((lon + 180) / 360) * n * 256;
  const latR = toRad(lat);
  const gy = ((1 - Math.log(Math.tan(latR) + 1 / Math.cos(latR)) / Math.PI) / 2) * n * 256;
  const tx0 = Math.round(gx / 256) - 1;
  const ty0 = Math.round(gy / 256) - 1;
  const tilesXY = [
    [tx0, ty0],
    [tx0 + 1, ty0],
    [tx0, ty0 + 1],
    [tx0 + 1, ty0 + 1],
  ].map(([x, y]) => [((x % n) + n) % n, y]);

  const frameUrls = (path: string) => tilesXY.map(([x, y]) => `${host}${path}/256/${RADAR_ZOOM}/${x}/${y}/2/0_0.png`);
  const [newTiles, oldTiles] = await Promise.all([
    Promise.all(frameUrls(newest.path).map(fetchPng)),
    Promise.all(frameUrls(older.path).map(fetchPng)),
  ]);

  // Coverage: is the user's location inside radar range at all?
  let covered: boolean | null = null;
  try {
    const ux = Math.floor(gx - tx0 * 256);
    const uy = Math.floor(gy - ty0 * 256);
    const ti = (ux >= 256 ? 1 : 0) + (uy >= 256 ? 2 : 0);
    const [cx, cy] = tilesXY[ti];
    const png = await fetchPng(`${COVERAGE}/${RADAR_ZOOM}/${cx}/${cy}/0/0_0.png`);
    const px = ux % 256;
    const py = uy % 256;
    let hit = 0;
    let total = 0;
    for (let dy = -3; dy <= 3; dy++)
      for (let dx = -3; dx <= 3; dx++) {
        const x = Math.min(255, Math.max(0, px + dx));
        const y = Math.min(255, Math.max(0, py + dy));
        total++;
        if (png.data[(y * png.width + x) * 4 + 3] > 0) hit++;
      }
    covered = hit / total > 0.5;
  } catch {
    covered = null;
  }

  const a = mosaicToGrid(oldTiles);
  const b = mosaicToGrid(newTiles);
  const pixKm = (40075.016686 * Math.cos(latR)) / (256 * n);
  const toLatLon = (cx: number, cy: number) => {
    const px = tx0 * 256 + cx * F;
    const py = ty0 * 256 + cy * F;
    const lonP = (px / (n * 256)) * 360 - 180;
    const latP = (Math.atan(Math.sinh(Math.PI * (1 - (2 * py) / (n * 256)))) * 180) / Math.PI;
    return { lat: latP, lon: lonP };
  };
  return {
    W: b.W,
    H: b.W,
    cellKm: pixKm * F,
    ux: (gx - tx0 * 256) / F,
    uy: (gy - ty0 * 256) / F,
    older: a.grid,
    newer: b.grid,
    minutesBetween: Math.max(10, (newest.time - older.time) / 60),
    time: newest.time,
    covered,
    toLatLon,
    host,
    path: newest.path,
  };
}
