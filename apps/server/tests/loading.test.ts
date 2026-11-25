import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { before, after, test } from 'node:test';
import { chromium } from 'playwright';
import type { Browser } from 'playwright';
import { normalizeOptions } from '../src/services/options.ts';
import { preparePage, waitForImages } from '../src/services/loading.ts';
import { createCaptureService } from '../src/services/capture.ts';
import { createApp } from '../src/app.ts';

let browser: Browser;
let server: http.Server;
let origin: string;
before(async () => {
  browser = await chromium.launch();
  server = http.createServer((req, res) => {
    if (req.url === '/broken.png') { res.writeHead(404); res.end(); return; }
    if (req.url === '/image.svg') { setTimeout(() => { if (!res.destroyed) { res.setHeader('Content-Type', 'image/svg+xml'); res.end('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="green"/></svg>'); } }, 250); return; }
    if (req.url === '/pending.png') return; // Never finish this subresource.
    res.setHeader('Content-Type', 'text/html');
    res.end((req.url === '/tall' ? '<body style="height:4000px">' : '<body>') + '<h1>Ready</h1>' + (req.url === '/heavy' ? '<img src="/pending.png">' : '') + '</body>');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  origin = `http://127.0.0.1:${address.port}`;
});
after(async () => {
  await browser?.close();
  server?.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
});

test('loading defaults are stable and normalization is idempotent', () => {
  const defaults = normalizeOptions({ url: origin });
  assert.equal(defaults.waitUntil, 'load');
  assert.equal(defaults.delay, 0);
  assert.equal(defaults.scroll, false);
  assert.equal(defaults.timeout, undefined);
  assert.notEqual(normalizeOptions({ url: origin, fullPage: true }).scroll, false);
  assert.equal(normalizeOptions({ url: origin, fullPage: true, scroll: false }).scroll, false);
  const full = normalizeOptions({ url: origin, fullPage: true });
  assert.deepEqual(normalizeOptions(full), full);
  const resolved = normalizeOptions({ url: origin, waitUntil: 'networkidle', timeout: 60000, delay: 150,
    waitForSelector: '.ready', scroll: true, viewport: { height: 400 } });
  assert.deepEqual(resolved.scroll, { step: 320, delay: 200, maxSteps: 30 });
  assert.deepEqual(normalizeOptions(resolved), resolved);
});

test('invalid loading controls return HTTP 400 before invoking capture', async () => {
  const api = http.createServer(createApp({ capture: async () => assert.fail('invalid request reached capture') }));
  try {
    api.listen(0, '127.0.0.1'); await once(api, 'listening');
    const address = api.address(); assert.ok(address && typeof address !== 'string');
    for (const options of [{ waitUntil: null }, { waitUntil: 'commit' }, { delay: -1 }, { delay: 10001 }, { delay: '2' },
      { timeout: 0 }, { timeout: 90001 }, { timeout: null }, { waitForSelector: '' }, { waitForSelector: 12 },
      { waitForSelector: 'x'.repeat(1001) }, { scroll: null }, { scroll: [] }, { scroll: { typo: 1 } },
      { scroll: { step: 0 } }, { scroll: { delay: 1001 } }, { scroll: { maxSteps: 101 } }]) {
      const result: Response = await fetch(`http://127.0.0.1:${address.port}/api/screenshot`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: origin, ...options }),
      });
      assert.equal(result.status, 400, JSON.stringify(options));
    }
  } finally { api.closeAllConnections(); await new Promise<void>(resolve => api.close(() => resolve())); }
});

test('selector waits for visibility and delay allows delayed content to finish', async () => {
  const page = await browser.newPage();
  try {
    await page.setContent('<div id="ready" hidden>Loaded</div><script>setTimeout(()=>document.querySelector("#ready").hidden=false,150);setTimeout(()=>document.title="Finished",300)</script>');
    const result = await preparePage(page, normalizeOptions({ url: origin, waitForSelector: '#ready', delay: 250 }), 2000);
    assert.equal(result.selector, 'matched');
    assert.equal(await page.title(), 'Finished');
  } finally { await page.close(); }
});

test('scroll triggers lazy content and restores the top; disabled scroll leaves it untouched', async () => {
  const page = await browser.newPage({ viewport: { width: 600, height: 400 } });
  try {
    await page.setContent('<body style="height:1800px"><script>addEventListener("scroll",()=>{if(scrollY>800)document.body.dataset.loaded="yes"})</script>');
    await preparePage(page, normalizeOptions({ url: origin }), 3000);
    assert.equal(await page.getAttribute('body', 'data-loaded'), null);
    const result = await preparePage(page, normalizeOptions({ url: origin, scroll: { step: 300, delay: 30 } }), 3000);
    assert.equal(result.scroll.status, 'completed');
    assert.equal(await page.getAttribute('body', 'data-loaded'), 'yes');
    assert.equal(await page.evaluate(() => scrollY), 0);
  } finally { await page.close(); }
});

test('infinite scrolling is bounded and scroll-locked pages are reported honestly', async () => {
  const page = await browser.newPage({ viewport: { width: 600, height: 400 } });
  try {
    await page.setContent('<body style="height:4000px"><script>addEventListener("scroll",()=>document.body.style.height=(document.body.scrollHeight+500)+"px")</script>');
    const options = normalizeOptions({ url: origin, scroll: { step: 300, delay: 30, maxSteps: 3 } });
    assert.deepEqual((await preparePage(page, options, 2000)).scroll, { status: 'limited', steps: 3 });
    assert.equal(await page.evaluate(() => scrollY), 0);
    await page.goto('about:blank');
    await page.setContent('<body style="height:4000px">Locked<script>addEventListener("scroll",()=>scrollTo(0,0))</script>');
    assert.equal((await preparePage(page, options, 2000)).scroll.status, 'blocked');
  } finally { await page.close(); }
});

test('domcontentloaded captures a heavy page while the default load wait still times out', async () => {
  const capture = createCaptureService({ captureTimeout: 5000 });
  try {
    const result = await capture({ url: `${origin}/heavy`, waitUntil: 'domcontentloaded' });
    assert.equal(result.metadata.loading.waitUntil, 'domcontentloaded');
    assert.equal(result.image.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    await assert.rejects(capture({ url: `${origin}/heavy`, timeout: 1000 }), { code: 'CAPTURE_TIMEOUT', status: 504 });
  } finally { await capture.close(); }
});

test('request deadlines include selector waits and delay and release capacity after failure', async () => {
  const capture = createCaptureService({ captureTimeout: 5000 });
  try {
    await assert.rejects(capture({ url: origin, waitForSelector: '#missing', timeout: 1000 }), { code: 'CAPTURE_TIMEOUT', status: 504 });
    await assert.rejects(capture({ url: origin, delay: 1500, timeout: 1000 }), { code: 'CAPTURE_TIMEOUT', status: 504 });
    await assert.rejects(capture({ url: `${origin}/tall`, timeout: 1000, scroll: { delay: 1000, step: 100 } }), { code: 'CAPTURE_TIMEOUT', status: 504 });
    const result = await capture({ url: origin, timeout: 6000, delay: 1500, waitUntil: 'networkidle' });
    assert.equal(result.metadata.loading.timeout, 6000);
    await assert.rejects(capture({ url: origin, waitForSelector: '[' }), { code: 'INVALID_OPTIONS', status: 400 });
    assert.equal((await capture({ url: origin })).cleanup, 'skipped');
  } finally { await capture.close(); }
});


test('image readiness waits for lazy images, records failures, and stops at its budget', async () => {
  const page = await browser.newPage({ viewport: { width: 600, height: 400 } });
  try {
    await page.goto(origin);
    await page.setContent(`<img width="100" height="100" data-src="${origin}/image.svg"><img width="50" height="50" src="${origin}/broken.png"><img width="50" height="50" src="${origin}/pending.png"><script>setTimeout(()=>document.querySelector('[data-src]').src=document.querySelector('[data-src]').dataset.src,50)</script>`, { waitUntil: 'domcontentloaded' });
    const result = await waitForImages(page, normalizeOptions({ url: origin }), 700);
    assert.equal(result.state, 'incomplete');
    assert.equal(result.loaded, 1);
    assert.equal(result.failed, 1);
    assert.equal(result.pending, 1);
    assert.equal(result.untriggered, 0);
    assert.ok(result.elapsedMs >= 650 && result.elapsedMs < 2000);
  } finally { await page.close(); }
});

test('ready pages return promptly and ignore images beyond the capture region', async () => {
  const page = await browser.newPage({ viewport: { width: 600, height: 400 } });
  try {
    await page.goto(origin);
    await page.setContent(`<p>No relevant pending images</p><img src="${origin}/pending.png" style="position:absolute;top:1500px;width:100px;height:100px">`, { waitUntil: 'domcontentloaded' });
    const result = await waitForImages(page, normalizeOptions({ url: origin }), 1500);
    assert.equal(result.state, 'ready');
    assert.equal(result.pending, 0);
    assert.ok(result.elapsedMs < 1000);
    const capped = await waitForImages(page, normalizeOptions({ url: origin, fullPage: true, maxHeight: 500 }), 1500);
    assert.equal(capped.state, 'ready');
    assert.equal(capped.pending, 0);
  } finally { await page.close(); }
});
