import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

if (!process.argv[2]) throw new Error('Usage: node apps/server/benchmarks/comparison-report.js <run-directory>');
const directory = resolve(process.argv[2]);
const run = JSON.parse(await readFile(resolve(directory, 'run.json'), 'utf8'));
let reviews = [];
try { reviews = JSON.parse(await readFile(resolve(directory, 'review.json'), 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const escape = value => String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const sites = [...new Set(run.results.map(result => result.site))];
const names = { baseline: 'No blocker', ...Object.fromEntries(Object.entries(run.candidates).map(([id,candidate])=>[id,`${candidate.name} ${candidate.version}`])) };
const scoredModes = run.modes.filter(mode => mode !== 'baseline');
const scoreRows = [['cookies','Cookie/privacy notices'],['popups','Promotional modals'],['chat','Chat prompts/launchers']].map(([category,label]) => {
  const cases = reviews.filter(review => review[category]);
  if (!cases.length) return '';
  return `<tr><th>${label}</th>${scoredModes.map(mode=>`<td>${cases.filter(review=>review[category][mode]==='removed').length} / ${cases.length}</td>`).join('')}</tr>`;
}).join('');
const scores = scoreRows ? `<h2>Reviewed outcomes</h2><p>Removed / observed cases, verified in the 15-second and after-scroll screenshots. Chat cases include two launchers and one open prompt. No-dialog and blocked-page baselines are not successes.</p><table><thead><tr><th>Category</th>${scoredModes.map(mode=>`<th>${escape(names[mode])}</th>`).join('')}</tr></thead><tbody>${scoreRows}</tbody></table>` : '';
const details = sites.map(site => {
  const review = reviews.find(item => item.site === site);
  const columns = run.modes.map(mode => {
    const result = run.results.find(result => result.site === site && result.mode === mode);
    if (!result) return '<section><p>Pending</p></section>';
    const outcome = review?.outcomes?.[mode];
    return `<section><h3>${escape(names[mode])}</h3><p>${escape(outcome || (mode === 'baseline' ? review?.baseline : '') || 'Unreviewed')}</p><p>HTTP ${escape(result.httpStatus ?? '—')} · setup ${escape(result.setupMs ?? '—')} ms</p>${result.error ? `<p class="error">${escape(result.error)}</p>` : ''}${['1s','3s','15s','after-scroll'].map(stage=>`<figure><img loading="lazy" src="${site}-${mode}/${stage}.png" alt="${escape(site)} ${escape(mode)} ${stage}"><figcaption>${stage}</figcaption></figure>`).join('')}<a href="${site}-${mode}/result.json">Raw evidence</a></section>`;
  });
  return `<details><summary>${escape(site)} — ${escape(review?.note || 'Unreviewed')}</summary><div class="columns">${columns.join('')}</div></details>`;
});
await writeFile(resolve(directory, 'report.html'), `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>DiffTrail blocker comparison</title><style>
:root{color-scheme:light dark;--bg:light-dark(#fff,#151515);--fg:light-dark(#181818,#eee);--muted:light-dark(#ddd,#383838);--link:light-dark(#225bb5,#9ebcfa)}body{background:var(--bg);color:var(--fg);font:15px system-ui;margin:24px auto;padding:0 20px;max-width:1600px}a{color:var(--link)}.columns{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px}img{width:100%;height:auto}h3{font-size:15px}details{padding:16px 0;border-bottom:1px solid var(--muted)}summary{cursor:pointer;font-weight:600}figure{margin:16px 0}.error{font-weight:600}table{border-collapse:collapse;width:100%;margin:20px 0}th,td{text-align:left;border-bottom:1px solid var(--muted);padding:12px}pre{white-space:pre-wrap;overflow-wrap:anywhere}@media(max-width:1000px){.columns{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:550px){.columns{grid-template-columns:1fr}}</style>
<h1>Configured blocker comparison</h1><p>${escape(run.startedAt)} · ${sites.length} sites · fresh profiles · real Chromium/CDP · ${escape(run.locale)} · host IP</p><p>This compares configured product presets, not isolated filtering engines: Ghostery includes automatic consent rejection and GPC; uBOL and AdGuard use their selected upstream filtering lists. No custom website rules or AI are used. Counts and outcomes require screenshot review; no-cookie baselines and access challenges are not removal successes. Intentional observation time is not production capture latency.</p>${scores}<details><summary>Build versions and checksums</summary><pre>${escape(JSON.stringify(run.candidates,null,2))}</pre></details>${details.join('')}</html>`);
console.log(resolve(directory,'report.html'));
