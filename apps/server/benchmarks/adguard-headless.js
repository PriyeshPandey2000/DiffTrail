import { chromium } from 'playwright';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { candidates } from './candidates.js';
import { root } from './config.js';
import { configureCandidate } from './configure-candidate.js';
import { observe } from './observe.js';

const exec = promisify(execFile);
const modes = (process.env.BENCH_MODES || 'baseline,adguard,api').split(',');
if (modes.some(mode => !['baseline', 'adguard', 'api'].includes(mode))) throw new Error('Invalid BENCH_MODES');
const all = JSON.parse(await readFile(new URL('./sites.json', import.meta.url)));
const selected = process.argv.slice(2);
if (selected.some(id => !all.some(site => site.id === id))) throw new Error('Unknown site ID');
const sites = selected.length ? all.filter(site => selected.includes(site.id)) : all.filter(site => ['cookiebot','onetrust','guardian','booking'].includes(site.id));
const output = resolve(root, 'artifacts/adguard-headless', new Date().toISOString().replaceAll(':', '-'));
await mkdir(output, { recursive: true });
const run = { startedAt: new Date().toISOString(), headless: true, channel: 'chromium',
  platform: process.platform, arch: process.arch, viewport: { width: 1280, height: 800 }, locale: 'en-GB', timezone: 'Europe/London',
  workers: Number(process.env.BENCH_WORKERS || 1), modes,
  measurement: 'Sampled process RSS sum via CDP process IDs and ps, every 500ms after browser connection. RSS includes shared pages; not PSS, not kernel peak. CPU from CDP cpuTime. Single-host single-region exploratory runs.',
  reference: { version: candidates.adguard.version, archiveSha256: candidates.adguard.sha256 },
  apiBuild: modes.includes('api') ? JSON.parse(await readFile(resolve(root, '.cache/adguard-api/extension/build.json'))) : null,
  scriptSha256: createHash('sha256').update(await readFile(new URL(import.meta.url))).digest('hex'), results: [] };
console.log(`Evidence: ${output}`);
async function capture(site, mode) {
  const directory = resolve(output, `${site.id}-${mode}`);
  await mkdir(directory);
  const profile = await mkdtemp(resolve(tmpdir(), 'difftrail-adguard-headless-'));
  const extension = mode === 'adguard' ? candidates.adguard.directory : resolve(root, '.cache/adguard-api/extension');
  const result = { site: site.id, mode, requestedUrl: site.url, observations: [], errors: [], samples: [] };
  const start = performance.now();
  let owner, remote, client, timer, sampling = false;
  const sample = async stage => {
    if (!client || sampling) return;
    sampling = true;
    try {
      const { processInfo } = await client.send('SystemInfo.getProcessInfo');
      const ids = processInfo.map(info => Number(info.id)).filter(id => Number.isSafeInteger(id) && id > 0);
      const { stdout } = await exec('ps', ['-o', 'pid=,rss=', '-p', ids.join(',')]);
      const rssKiB = stdout.trim().split('\n').reduce((sum, line) => sum + Number(line.trim().split(/\s+/)[1] || 0), 0);
      result.samples.push({ stage, elapsedMs: Math.round(performance.now() - start), rssKiB, cpuSeconds: processInfo.reduce((sum, info) => sum + info.cpuTime, 0), processCount: ids.length });
    } catch (error) { result.measurementError = String(error).slice(0, 200); }
    finally { sampling = false; }
  };
  try {
    owner = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true,
      viewport: run.viewport, deviceScaleFactor: 1, locale: run.locale, timezoneId: run.timezone, acceptDownloads: false,
      args: ['--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', ...(mode === 'baseline' ? [] : [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`])],
    });
    result.launchMs = Math.round(performance.now() - start);
    const port = (await readFile(resolve(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0];
    remote = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    result.browserVersion = remote.version();
    client = await remote.newBrowserCDPSession();
    await sample('launched');
    timer = setInterval(() => { void sample('interval'); }, 500);
    if (mode !== 'baseline') {
      const worker = owner.serviceWorkers()[0] || await owner.waitForEvent('serviceworker', { timeout: 30_000 });
      const id = new URL(worker.url()).host;
      const page = await owner.newPage();
      await page.goto(`chrome-extension://${id}/${mode === 'adguard' ? 'pages/options.html' : 'status.html'}`);
      if (mode === 'adguard') result.extension = await configureCandidate(page, 'adguard');
      else {
        result.extension = await page.evaluate(async () => chrome.runtime.sendMessage({ type: 'difftrail:status' }));
        if (!result.extension.ready) throw new Error(`Official API startup: ${result.extension.error}`);
        const expected = [2,3,4,17,18,19,20,21,22,25];
        if (!expected.every(id => result.extension.enabled.includes(`ruleset_${id}`))) throw new Error('Official API rulesets missing');
      }
      await page.close();
    }
    result.readyMs = Math.round(performance.now() - start);
    await sample('ready');
    const page = await owner.newPage();
    page.on('pageerror', error => { if (result.errors.length < 30) result.errors.push(error.message.slice(0, 300)); });
    const navigationStart = performance.now();
    try {
      const response = await page.goto(site.url, { waitUntil: 'domcontentloaded', timeout: 20_000 });
      result.httpStatus = response?.status();
    } catch (error) { result.navigationError = error.message.slice(0, 400); }
    for (const waitMs of [1000, 3000, 8000, 15000]) {
      await page.waitForTimeout(Math.max(0, waitMs - (performance.now() - navigationStart)));
      const phase = `at-${waitMs/1000}s`;
      const frames = [];
      for (const frame of page.frames().slice(0, 20)) {
        try { frames.push({ url: frame.url().slice(0, 250), ...await frame.evaluate(observe) }); }
        catch (error) { frames.push({ error: error.message.slice(0, 200) }); }
      }
      result.observations.push({ phase, elapsedMs: Math.round(performance.now() - navigationStart), frames });
      await sample(phase);
      if (waitMs === 3000 || waitMs === 15000) await page.screenshot({ path: resolve(directory, `${waitMs/1000}s.png`), timeout: 7000 });
    }
    await page.mouse.wheel(0, 650);
    await page.waitForTimeout(5000);
    result.observations.push({ phase: 'after-scroll', frames: [{ url: page.url(), ...await page.evaluate(observe) }] });
    await page.screenshot({ path: resolve(directory, 'after-scroll.png'), timeout: 7000 });
    result.finalUrl = page.url();
    result.cookies = (await owner.cookies()).map(({name,domain})=>({name,domain})); // Values deliberately omitted.
    await sample('finished');
  } catch (error) { result.error = error.message.slice(0, 1800); }
  finally {
    clearInterval(timer);
    result.totalMs = Math.round(performance.now() - start);
    result.peakObservedRssKiB = Math.max(0, ...result.samples.map(sample => sample.rssKiB));
    await remote?.close().catch(() => {});
    await owner?.close().catch(() => {});
    await rm(profile, { recursive: true, force: true });
    await writeFile(resolve(directory, 'result.json'), JSON.stringify(result, null, 2));
  }
  console.log(`${site.id} ${mode}: ${result.error || `HTTP ${result.httpStatus}; ready ${result.readyMs}ms; sampled peak ${Math.round(result.peakObservedRssKiB/1024)}MiB`}`);
  return result;
}
let cursor = 0;
await Promise.all(Array.from({ length: Math.min(run.workers, sites.length) }, async () => {
  while (cursor < sites.length) {
    const index = cursor++;
    const ordered = index % 2 ? [...modes].reverse() : modes;
    for (const mode of ordered) {
      run.results.push(await capture(sites[index], mode));
      await writeFile(resolve(output, 'run.json'), JSON.stringify(run, null, 2));
    }
  }
}));
run.finishedAt = new Date().toISOString();
await writeFile(resolve(output, 'run.json'), JSON.stringify(run, null, 2));
