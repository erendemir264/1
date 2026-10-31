import './mock-fetch.ts';
import { analyze } from '../lib/analyze.ts';
import { analyzeWindow } from '../lib/window.ts';

const t0 = Date.now();
const r = await analyze(41.01, 28.97);
console.log('ms', Date.now() - t0, 'scenarios', r.pool.weights.length, 'det', r.pool.detModels, 'ens', r.pool.ensembleModels);
console.log('NOW', r.now);
console.log('NOWCAST', { ...r.nowcast, cells: r.nowcast.cells.length });
for (const d of r.days) {
  console.log(`\n== ${d.label} ${d.date}: ${d.headline}`);
  console.log('  conf', d.main.confidence, 'pRain', d.main.pRain.toFixed(2));
  d.main.advice.forEach((a) => console.log('  ', a.icon, a.text, '—', a.why));
  d.main.warnings.forEach((w) => console.log('   ⚠️', w));
  d.periods.forEach((p) => console.log(`   ${p.name.padEnd(14)} ${p.icon} ${Math.round(p.tMin)}-${Math.round(p.tMax)}° p=${p.pRain.toFixed(2)} ${p.confidence.label}%${p.confidence.pct} | ${p.summary}`));
}
const tz = r.location.tzOffset;
const ds = Math.floor((r.generatedAt + tz) / 86400) * 86400 - tz;
const w = analyzeWindow(r.hours, r.pool, ds + 86400 + 18 * 3600, ds + 86400 + 23 * 3600, 'Plan', { now: r.generatedAt, nowcast: r.nowcast });
console.log('\nPLAN yarın 18-23:', w?.summary, w?.confidence, w?.advice.map((a) => a.text));
console.log('payload KB', Math.round(JSON.stringify(r).length / 1024));
