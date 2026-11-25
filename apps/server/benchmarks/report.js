import { readFile, writeFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';

if (!process.argv[2]) throw new Error('Usage: node apps/server/benchmarks/report.js <run-directory>');
const directory = resolve(process.argv[2]);
const run = JSON.parse(await readFile(resolve(directory, 'run.json'), 'utf8'));
let reviews = [];
try { reviews = JSON.parse(await readFile(resolve(directory, 'review.json'), 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const escape = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const sites = [...new Set(run.results.map(result => result.site))];
const rows = [];
for (const site of sites) {
  const review = reviews.find(item => item.site === site);
  const source = review?.source ? resolve(directory, '..', review.source) : directory;
  const prefix = relative(directory, source).replaceAll('\\', '/');
  const modes = [];
  for (const mode of ['baseline', 'filtered']) {
    const result = JSON.parse(await readFile(resolve(source, `${site}-${mode}/result.json`), 'utf8'));
    const folder = [prefix, `${site}-${mode}`].filter(Boolean).join('/');
    modes.push(`<section><h3>${mode} · HTTP ${escape(result.httpStatus ?? '—')}</h3>${result.error ? `<p>${escape(result.error)}</p>` : ''}${['1s','3s','15s','after-scroll'].map(phase => `<figure><img loading="lazy" src="${escape(folder)}/${phase}.png" alt="${escape(site)} ${mode} ${phase}"><figcaption>${phase}</figcaption></figure>`).join('')}<a href="${escape(folder)}/result.json">Raw observations</a></section>`);
  }
  rows.push(`<details><summary>${escape(site)} — ${escape(review?.status || 'Unreviewed')}</summary><p>${escape(review?.note || 'Inspect the screenshots; automated detections are not a success score.')}</p><div class="pair">${modes.join('')}</div></details>`);
}
const categories = [['removed', 'Cookie dialog removed'], ['remained', 'Cookie dialog remained'], ['not-observed', 'No cookie dialog observed'], ['blocked', 'Access blocked / untestable']];
const counts = categories.map(([id, label]) => ({ label, count: reviews.filter(item => item.status === id).length }));
const chart = reviews.length ? `<div role="img" aria-label="${escape(counts.map(item => `${item.label}: ${item.count}`).join('; '))}">${counts.map(item => `<div class="bar-row"><span>${item.label}</span><div class="track"><div class="bar" style="width:${item.count / sites.length * 100}%"></div></div><strong>${item.count}</strong></div>`).join('')}<p class="muted">Counts of sites · ${sites.length} total · no-dialog cases are not cleanup successes</p></div>` : '';
await writeFile(resolve(directory, 'report.html'), `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>DiffTrail overlay benchmark</title><style>
:root{color-scheme:light dark;--background:light-dark(#fff,#151515);--foreground:light-dark(#161616,#eee);--muted-foreground:light-dark(#555,#aaa);--muted:light-dark(#eee,#303030);--chart-1:light-dark(#285cba,#86adf4)}body{font:16px system-ui;background:var(--background);color:var(--foreground);max-width:1100px;margin:32px auto;padding:0 20px}h1{font-size:26px}a{color:var(--chart-1)}.pair{display:grid;grid-template-columns:1fr 1fr;gap:20px}img{width:100%;height:auto}figure{margin:20px 0}details{border-bottom:1px solid var(--muted);padding:16px 0}summary{cursor:pointer;font-weight:600}.muted,figcaption{color:var(--muted-foreground)}.bar-row{display:grid;grid-template-columns:250px 1fr 24px;align-items:center;gap:12px;margin:14px 0}.track{height:20px;background:var(--muted)}.bar{height:100%;background:var(--chart-1)}@media(max-width:650px){.pair{grid-template-columns:1fr}.bar-row{grid-template-columns:1fr 1fr 20px;font-size:13px}}
</style><h1>DiffTrail overlay benchmark</h1><p>${escape(run.startedAt)} · uBlock Origin Lite ${escape(run.extensionVersion)} · ${sites.length} sites · fresh profiles · real Chromium through CDP</p><p>Full ad/tracker + annoyance configuration, en-GB, 1280×800, host network. Cookiebot and Guardian use a paired rerun after correcting the benchmark's background-worker readiness check. Samples include delayed observations and scrolling. Results are manually reviewed screenshot outcomes, not a general success-rate estimate or a full functionality audit.</p>${chart}${rows.join('')}</html>`);
console.log(resolve(directory, 'report.html'));
