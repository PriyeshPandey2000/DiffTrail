import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { extensionDirectory, extensionVersion, root, rulesets } from './config.js';
import { candidates } from './candidates.js';
import { configureCandidate } from './configure-candidate.js';

const comparison = process.env.BENCH_COMPARE === '1';
const modes = process.env.BENCH_MODES?.split(',') || (comparison ? ['baseline','ubol','ghostery','adguard'] : ['baseline','filtered']);
if (modes.some(mode => !['baseline','filtered',...Object.keys(candidates)].includes(mode))) throw new Error('Unknown BENCH_MODES value');
const selectedRulesets = process.env.BENCH_FILTERS === 'overlays' ? rulesets.filter(id => id.startsWith('annoyances-')) : rulesets;
const allSites = JSON.parse(await readFile(new URL('./sites.json', import.meta.url), 'utf8'));
const selected = process.argv.slice(2);
const sites = selected.length ? allSites.filter(site => selected.includes(site.id)) : allSites;
if (!sites.length) throw new Error('No matching site IDs');
const output = resolve(root, comparison ? 'artifacts/blocker-comparison' : 'artifacts/overlay-benchmark', new Date().toISOString().replaceAll(':', '-'));
await mkdir(output, { recursive: true });
const manifest = JSON.parse(await readFile(resolve(extensionDirectory, 'manifest.json'), 'utf8'));
if (manifest.version !== extensionVersion) throw new Error('Run npm run setup:benchmark first');
const scriptSha256 = createHash('sha256').update(await readFile(new URL(import.meta.url))).digest('hex');
const run = { comparison, modes, candidates: Object.fromEntries(Object.entries(candidates).map(([id,c])=>[id,{name:c.name,version:c.version,sha256:c.sha256}])), scriptSha256, platform: process.platform, architecture: process.arch, nodeVersion: process.version, startedAt: new Date().toISOString(), extensionVersion, rulesets: selectedRulesets, viewport: { width: 1280, height: 800 }, locale: 'en-GB', timezone: 'Europe/London', geography: 'Host network; no regional proxy or IP emulation', results: [] };
await writeFile(resolve(output, 'run.json'), JSON.stringify(run, null, 2));
console.log(`Evidence: ${output}`);

// Observation only: these checks never hide, click, or alter site elements.
function observe() {
  const visible = element => {
    const style = getComputedStyle(element);
    const box = element.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) !== 0 && box.width > 0 && box.height > 0 && box.top < innerHeight && box.left < innerWidth && box.bottom > 0 && box.right > 0;
  };
  const elements = [];
  const visit = root => {
    for (const element of root.querySelectorAll('*')) {
      if (elements.length >= 10_000) return;
      elements.push(element);
      if (element.shadowRoot) visit(element.shadowRoot);
    }
  };
  if (document.body) visit(document.body);
  const overlays = [];
  for (const element of elements) {
    const style = getComputedStyle(element);
    const dialog = element.matches('dialog[open], [role="dialog"], [aria-modal="true"]');
    if (!dialog && !['fixed', 'sticky'].includes(style.position)) continue;
    if (!visible(element)) continue;
    const text = (element.innerText || '').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const box = element.getBoundingClientRect();
    const cookie = /cookie|consent|privacy preferences|tracking technologies/i.test(text) && /accept|reject|agree|preferences|manage|allow|use|settings/i.test(text);
    const popup = dialog || /subscribe|newsletter|sign up|special offer|notifications/i.test(text);
    overlays.push({ tag: element.tagName, id: element.id, role: element.getAttribute('role'), text: text.slice(0, 1000), cookie, popup, box: { x: box.x, y: box.y, width: box.width, height: box.height } });
    if (overlays.length >= 30) break;
  }
  return {
    time: Math.round(performance.now()), title: document.title,
    bodyCookieSignal: /cookie|consent/i.test(document.body?.innerText || ''),
    consentActions: elements.filter(element => element.matches('button, [role=button]') && visible(element) && /accept|reject|agree|manage cookies|necessary|no, thank|yes, i accept/i.test(element.innerText || '')).map(element => element.innerText.slice(0, 150)).slice(0, 12),
    iframes: [...document.querySelectorAll('iframe')].filter(visible).map(element => ({ src: element.src.slice(0, 300), box: { x: element.getBoundingClientRect().x, y: element.getBoundingClientRect().y, width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height } })).slice(0, 15),
    text: (document.body?.innerText || '').slice(0, 15_000),
    textLength: document.body?.innerText.length || 0,
    headings: [...document.querySelectorAll('h1,h2')].filter(visible).slice(0, 8).map(element => element.innerText),
    images: { total: document.images.length, loaded: [...document.images].filter(image => image.complete && image.naturalWidth > 0).length },
    scrollY, scrollHeight: document.documentElement.scrollHeight,
    overflow: { html: getComputedStyle(document.documentElement).overflowY, body: document.body ? getComputedStyle(document.body).overflowY : null },
    overlays,
  };
}

async function capture(site, mode) {
  const candidateName = mode === 'filtered' ? 'ubol' : mode;
  const candidate = candidates[candidateName];
  const extensionDirectory = candidate?.directory;
  const setupStarted = Date.now();
  const directory = resolve(output, `${site.id}-${mode}`);
  await mkdir(directory);
  const profile = await mkdtemp(resolve(tmpdir(), 'difftrail-benchmark-'));
  let owner;
  let remote;
  const result = { site: site.id, requestedUrl: site.url, category: site.category, mode, observations: [], consoleErrors: [], failedRequests: [], navigation: [] };
  try {
    owner = await chromium.launchPersistentContext(profile, {
      channel: 'chromium', headless: true,
      viewport: run.viewport, deviceScaleFactor: 1, locale: run.locale, timezoneId: run.timezone,
      acceptDownloads: false,
      args: ['--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', ...(mode !== 'baseline' ? [`--disable-extensions-except=${extensionDirectory}`, `--load-extension=${extensionDirectory}`] : [])],
    });
    const port = (await readFile(resolve(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0];
    remote = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    result.browserVersion = remote.version();
    result.remoteDebugging = 'Connected through CDP on loopback ephemeral port';
    const context = remote.contexts()[0];
    if (mode !== 'baseline') {
      const settings = await context.newPage();
      await settings.goto('chrome://extensions');
      const installed = await settings.evaluate(async desiredPath => {
        const deadline = Date.now() + 15_000;
        while (Date.now() < deadline) {
          const list = await chrome.developerPrivate.getExtensionsInfo({ includeDisabled: true, includeTerminated: true });
          const installed = list.find(extension => extension.path === desiredPath && extension.state === 'ENABLED');
          window.__extensionDiagnostics = list.map(extension => ({id:extension.id,path:extension.path,state:extension.state,warnings:extension.installWarnings,errors:extension.runtimeErrors}));
          if (installed) return { id: installed.id, version: installed.version, name: installed.name };
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        throw new Error(`Extension was not enabled by Chromium: ${JSON.stringify(window.__extensionDiagnostics)}`);
      }, extensionDirectory);
      result.installedExtension = installed;
      await settings.goto(`chrome-extension://${installed.id}/${candidate.settings}`);
      result.extension = await configureCandidate(settings, candidateName, { ubolRulesets: selectedRulesets });
      if (result.extension.version !== candidate.version) throw new Error('Loaded extension version does not match candidate');
      await settings.close();
    }
    result.setupMs = Date.now() - setupStarted;
    const page = await context.newPage();
    page.setDefaultTimeout(5_000);
    await page.addInitScript(`window.__difftrailTimeline = []; setInterval(() => { try { const observation = (${observe.toString()})(); const suspects = observation.overlays.filter(item => item.cookie || item.popup); if (window.__difftrailTimeline.length < 40) window.__difftrailTimeline.push({time: observation.time, overlays: suspects, overflow: observation.overflow}); } catch {} }, 1000);`);
    page.on('console', message => { if (message.type() === 'error' && result.consoleErrors.length < 30) result.consoleErrors.push(message.text().slice(0, 500)); });
    page.on('pageerror', error => { if (result.consoleErrors.length < 30) result.consoleErrors.push(error.message.slice(0, 500)); });
    page.on('requestfailed', request => { if (result.failedRequests.length < 100) result.failedRequests.push({ url: request.url().slice(0, 300), error: request.failure()?.errorText }); });
    page.on('framenavigated', frame => { if (frame === page.mainFrame()) result.navigation.push(frame.url()); });
    const started = Date.now();
    try {
      const response = await page.goto(site.url, { waitUntil: 'domcontentloaded', timeout: 20_000 });
      result.httpStatus = response?.status();
      result.domContentLoadedMs = Date.now() - started;
    } catch (error) { result.navigationError = error.message.slice(0, 600); }
    for (const target of [1000, 3000, 8000, 15000]) {
      await new Promise(resolve => setTimeout(resolve, Math.max(0, started + target - Date.now())));
      const observation = { elapsedMs: Date.now() - started, phase: `at-${target / 1000}s`, frames: [] };
      for (const frame of page.frames().slice(0, 15)) {
        try { observation.frames.push({ url: frame.url().slice(0, 300), ...await frame.evaluate(observe) }); }
        catch (error) { observation.frames.push({ error: error.message.slice(0, 300) }); }
      }
      result.observations.push(observation);
      if ([1000, 3000, 15000].includes(target)) await page.screenshot({ path: resolve(directory, `${target / 1000}s.png`), timeout: 7_000 });
    }
    await page.mouse.wheel(0, 650);
    await new Promise(resolve => setTimeout(resolve, 5000));
    result.observations.push({ elapsedMs: Date.now() - started, phase: 'after-scroll', frames: [{ url: page.url(), ...await page.evaluate(observe) }] });
    await page.screenshot({ path: resolve(directory, 'after-scroll.png'), timeout: 7_000 });
    result.timeline = await page.evaluate(() => window.__difftrailTimeline || []);
    result.finalUrl = page.url();
    result.totalMs = Date.now() - started;
  } catch (error) { result.error = error.message.slice(0, 1000); }
  finally {
    await remote?.close().catch(() => {});
    await owner?.close().catch(() => {});
    await rm(profile, { recursive: true, force: true });
    await writeFile(resolve(directory, 'result.json'), JSON.stringify(result, null, 2));
  }
  console.log(`${site.id} ${mode}: ${result.error || `HTTP ${result.httpStatus ?? '?'}; observed ${result.observations.length} stages`}`);
  return result;
}

let cursor = 0;
await Promise.all(Array.from({ length: Math.min(3, sites.length) }, async () => {
  while (cursor < sites.length) {
    const siteIndex = cursor++;
    const site = sites[siteIndex];
    const candidateModes = modes.filter(mode => mode !== 'baseline');
    const offset = siteIndex % Math.max(1, candidateModes.length);
    const orderedModes = [...(modes.includes('baseline') ? ['baseline'] : []), ...candidateModes.slice(offset), ...candidateModes.slice(0, offset)];
    for (const mode of orderedModes) {
      run.results.push(await capture(site, mode));
      await writeFile(resolve(output, 'run.json'), JSON.stringify(run, null, 2));
    }
  }
}));
run.finishedAt = new Date().toISOString();
await writeFile(resolve(output, 'run.json'), JSON.stringify(run, null, 2));
console.log(`Completed. Evidence: ${output}`);
