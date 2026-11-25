import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const directory = resolve(process.argv[2]);
const run = JSON.parse(await readFile(resolve(directory, 'run.json'), 'utf8'));
const median = values => { const a = [...values].sort((a,b)=>a-b); return a.length ? a.length % 2 ? a[(a.length-1)/2] : (a[a.length/2-1]+a[a.length/2])/2 : 0; };
const names = { baseline: 'No blocker', adguard: 'AdGuard extension', api: 'Official AdGuard API' };
let review;
try { review = JSON.parse(await readFile(resolve(directory, 'review.json'), 'utf8')); } catch { /* Unreviewed runs have no removal scores. */ }
const scores = review ? ['cookies', 'popups', 'chat'].map(category => {
  const cases = review.cases.filter(item => item.api[category]);
  return { category, total: cases.length,
    adguard: cases.filter(item => item.adguard[category] === 'removed').length,
    api: cases.filter(item => item.api[category] === 'removed').length };
}) : [];
const modes = run.modes.map(mode=> {
  const results=run.results.filter(result=>result.mode===mode&&!result.error);
  return {mode,name:names[mode],captures:results.length,medianReadySeconds:median(results.map(r=>r.readyMs))/1000,
    medianPeakRssMiB:median(results.map(r=>r.peakObservedRssKiB))/1024,
    medianReadyRssMiB:median(results.map(r=>r.samples.find(s=>s.stage==='ready')?.rssKiB||0))/1024,
    errors:run.results.filter(r=>r.mode===mode&&r.error).length};
});
await writeFile(resolve(directory,'summary.json'),JSON.stringify({modes,scores,measurement:run.measurement},null,2));
const escape = value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
function bars(key,label,unit){
  const max=Math.max(...modes.map(m=>m[key]))*1.05;
  return `<section><h3>${label}</h3><svg viewBox="0 0 680 165" role="img" aria-label="${label}" style="width:100%;height:165px">${modes.map((m,i)=>`<text x="0" y="${i*50+20}" fill="var(--foreground)" font-size="13">${m.name}</text><rect x="175" y="${i*50+5}" width="${m[key]/max*390}" height="22" rx="4" fill="var(--chart-${i+1})"/><text x="${180+m[key]/max*390}" y="${i*50+21}" fill="var(--foreground)" font-size="13">${m[key].toFixed(1)} ${unit}</text>`).join('')}</svg></section>`;
}
const scoreChart = scores.length ? `<section><h3>Reviewed recurring UI removed · full presets</h3><p>Consumer extension and official API had the same counts in this sample.</p><svg viewBox="0 0 680 135" role="img" aria-label="Cookie notices 6 of 7, popups 1 of 2, chat prompts 1 of 3 in both modes" style="width:100%;height:135px">${scores.map((score,index)=>`<text x="0" y="${index*40+20}" fill="var(--foreground)" font-size="13">${score.category}</text><rect x="175" y="${index*40+5}" width="390" height="22" rx="4" fill="var(--secondary)"/><rect x="175" y="${index*40+5}" width="${390*score.api/score.total}" height="22" rx="4" fill="var(--chart-3)"/><text x="580" y="${index*40+21}" fill="var(--foreground)" font-size="13">${score.api}/${score.total}</text>`).join('')}</svg></section>` : '';
const chart=`<!doctype html><html><head><meta charset="utf-8"><style>:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;font-family:var(--font-sans,sans-serif);color:var(--foreground)}h3{font-size:15px;margin:0 0 8px}section{padding:16px;border:1px solid var(--border);border-radius:var(--radius,12px);margin:12px 0}p{font-size:13px;line-height:1.5;color:var(--muted-foreground)}svg{overflow:visible}</style></head><body><p>${modes[0].captures} sites per mode · Chromium ${escape(run.results[0].browserVersion)} · fresh profile per capture · ${run.workers} concurrent workers</p>${scoreChart}${bars('medianReadySeconds','Median cold readiness, including configuration','s')}${bars('medianPeakRssMiB','Median of each capture’s sampled peak process RSS sum','MiB')}<p>RSS sums include shared memory; these are not private-memory requirements. The extension adapter configures filters sequentially; the official API starts them in one call. Readiness is measured for these integrations, not intrinsic engine speed. Every visit includes a deliberate 20-second observation window. One desktop host/IP, one visit per mode/site.</p></body></html>`;
await writeFile(resolve(directory,'summary.html'),chart);
const sites=[...new Set(run.results.map(r=>r.site))];
const gallery=`<!doctype html><html><head><meta charset="utf-8"><title>Headless AdGuard evidence</title><style>body{font:14px system-ui;margin:24px;background:#eee}section{margin:24px 0}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}img{width:100%}figure{margin:0}figcaption{padding:8px;background:white}h2{margin:8px 0}a{color:#1348a8}</style></head><body><h1>Headless AdGuard evidence</h1><p>Same pinned filter assets. No custom site rules or AI. Dynamic pages can vary. Compare 15-second and post-scroll images; automated observations do not determine success.</p>${sites.map(site=>`<section><h2>${escape(site)}</h2><div class="grid">${run.modes.map(mode=>{const r=run.results.find(r=>r.site===site&&r.mode===mode);return `<figure><figcaption>${names[mode]} · HTTP ${r?.httpStatus||'?'} ${escape(r?.error||'')}</figcaption><a href="${site}-${mode}/15s.png"><img loading="lazy" src="${site}-${mode}/15s.png"></a><a href="${site}-${mode}/after-scroll.png">After scroll</a></figure>`;}).join('')}</div></section>`).join('')}</body></html>`;
await writeFile(resolve(directory,'gallery.html'),gallery);
console.log(JSON.stringify(modes,null,2));
