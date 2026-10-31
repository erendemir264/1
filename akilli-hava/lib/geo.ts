const R = 6371; // km

export const toRad = (d: number) => (d * Math.PI) / 180;
export const toDeg = (r: number) => (r * 180) / Math.PI;

/** Point at distance (km) and bearing (deg, 0 = north) from origin. */
export function destination(lat: number, lon: number, bearing: number, km: number) {
  const d = km / R;
  const b = toRad(bearing);
  const p1 = toRad(lat);
  const l1 = toRad(lon);
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
  const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return { lat: toDeg(p2), lon: ((toDeg(l2) + 540) % 360) - 180 };
}

/** Local flat projection in km around an origin (x = east, y = north). Good enough within ~300 km. */
export function toXY(lat0: number, lon0: number, lat: number, lon: number) {
  return {
    x: (lon - lon0) * 111.32 * Math.cos(toRad(lat0)),
    y: (lat - lat0) * 110.574,
  };
}

export function fromXY(lat0: number, lon0: number, x: number, y: number) {
  return { lat: lat0 + y / 110.574, lon: lon0 + x / (111.32 * Math.cos(toRad(lat0))) };
}

/** Bearing (deg, 0 = north, clockwise) of a vector in local km space. */
export function bearingOf(x: number, y: number) {
  return (toDeg(Math.atan2(x, y)) + 360) % 360;
}

const DIRS = ['kuzey', 'kuzeydoğu', 'doğu', 'güneydoğu', 'güney', 'güneybatı', 'batı', 'kuzeybatı'];
export function compassTr(deg: number) {
  return DIRS[Math.round(((deg % 360) + 360) % 360 / 45) % 8];
}

/** "batıdan", "kuzeydoğudan" with correct Turkish suffix. */
export function fromDirTr(deg: number) {
  const w = compassTr(deg);
  return w + (w === 'kuzey' || w === 'güney' ? 'den' : 'dan');
}

/** "batısında", "kuzeyinde": where something is relative to the user. */
export function posTr(deg: number) {
  const w = compassTr(deg);
  if (w.endsWith('y')) return w + 'inde'; // kuzeyinde, güneyinde
  return w + (w.endsWith('ı') ? 'sında' : 'sunda'); // batısında, doğusunda
}

/** "doğuya", "kuzeye": direction something is heading to. */
export function towardTr(deg: number) {
  const w = compassTr(deg);
  return w.endsWith('y') ? w + 'e' : w + 'ya';
}
