import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { before, after, test } from 'node:test';
import { chromium } from 'playwright';
import type { Browser } from 'playwright';
import { createApp } from '../src/app.ts';
import { createCaptureService } from '../src/services/capture.ts';
import { normalizeOptions } from '../src/services/options.ts';
import { prepareTarget, targetBounds } from '../src/services/target.ts';
import type { CaptureMetadata } from '../src/services/types.ts';

let browser: Browser;
let target: http.Server;
let api: http.Server;
let origin: string;
let apiUrl: string;
let targetRequests = 0;
const native = process.env.RUN_ADGUARD_TESTS === '1';
const capture = createCaptureService({ settleMs: 0 });
const base = '<style>*{box-sizing:border-box}body{margin:0;background:white}.card{width:300px;height:160px;background:rgb(0,128,0)}</style>';
async function listen(server: http.Server) {
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  return `http://127.0.0.1:${address.port}`;
}
async function close(server: http.Server) {
  server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
}
before(async () => {
  browser = await chromium.launch();
  target = http.createServer((req, res) => {
    targetRequests++;
    if (req.url === '/lazy.svg') {
      setTimeout(() => { res.setHeader('Content-Type', 'image/svg+xml'); res.end('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="160"><path fill="green" d="M0 0h300v160H0z"/></svg>'); }, 200);
      return;
    }
    res.setHeader('Content-Type', 'text/html');
    const fixtures: Record<string, string> = {
      '/': '<div style="height:1500px"></div><div class="card"></div><div class="card" style="background:red"></div><div style="height:600px"></div>',
      '/delayed': '<div id="later" class="card" hidden></div><script>setTimeout(()=>document.querySelector("#later").hidden=false,200)</script>',
      '/hidden': '<div id="hidden" class="card" hidden></div><div class="card" hidden></div><div class="card"></div>',
      '/nested': '<div style="height:1400px"></div><div style="height:200px;width:340px;overflow:auto"><div style="height:1000px"></div><div class="card"></div></div>',
      '/shadow': '<div id="host"></div><script>document.querySelector("#host").attachShadow({mode:"open"}).innerHTML=\'<div class="card" style="width:300px;height:160px;background:green"></div>\'</script>',
      '/lazy': '<div style="height:1600px"></div><img id="lazy" src="/lazy.svg" loading="lazy" width="300" height="160" style="display:block"><div style="height:600px"></div>',
      '/wide': '<div class="card" style="width:2500px;height:700px"></div>',
      '/large': '<div class="card" style="height:9000px"></div>',
      '/overlay': '<div class="card"></div><div id="cookie-banner" style="position:fixed;inset:0;background:red;z-index:100">We use cookies</div>',
      '/resize': '<div class="card"></div><script>setTimeout(()=>document.querySelector(".card").style.width="420px",100)</script>',
      '/fractional': '<div style="height:1300.2px"></div><div class="card" style="height:160.2px"></div>',
    };
    res.end(base + (fixtures[req.url || '/'] ?? fixtures['/']));
  });
  origin = await listen(target);
  api = http.createServer(createApp({ capture }));
  apiUrl = await listen(api);
});
after(async () => { await close(api); await capture.close(); await close(target); await browser.close(); });
async function post(extra: object, path = '/') {
  return fetch(`${apiUrl}/api/screenshot`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: origin + path, viewport: { width: 640, height: 400 }, ...extra }) });
}
const metadata = (response: Response): CaptureMetadata => JSON.parse(response.headers.get('x-difftrail-metadata')!);
async function image(response: Response, width: number, height: number, rgb?: number[]) {
  assert.equal(response.status, 200, response.status === 200 ? '' : await response.text());
  assert.equal(response.headers.get('content-type'), 'image/png');
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.equal(bytes.readUInt32BE(16), width); assert.equal(bytes.readUInt32BE(20), height);
  if (rgb) {
    const page = await browser.newPage();
    try {
      const samples = await page.evaluate(async data => {
        const img = new Image(); img.src = `data:image/png;base64,${data}`; await img.decode();
        const canvas = document.createElement('canvas'); canvas.width = img.width; canvas.height = img.height;
        const ctx = canvas.getContext('2d')!; ctx.drawImage(img, 0, 0);
        return [[10, 10], [img.width / 2, img.height / 2], [img.width - 10, img.height - 10]].map(([x,y]) => Array.from(ctx.getImageData(x,y,1,1).data).slice(0,3));
      }, bytes.toString('base64'));
      for (const sample of samples) assert.deepEqual(sample, rgb);
    } finally { await page.close(); }
  }
}

test('target validation rejects malformed and conflicting options before navigation', async () => {
  const bad = [{ selector: '' }, { selector: null }, { selector: 5 }, { selector: 'x'.repeat(1001) }, { clip: null }, { clip: [] }, { clip: {} },
    { clip: { x: -1, y: 0, width: 1, height: 1 } }, { clip: { x: 0, y: 0, width: 0, height: 1 } },
    { clip: { x: 0, y: 0.5, width: 1, height: 1 } }, { clip: { x: 0, y: 0, width: '10', height: 1 } },
    { clip: { x: 0, y: 0, width: 10, height: 10, extra: true } }, { selector: '.card', fullPage: true },
    { clip: { x: 0, y: 0, width: 10, height: 10 }, fullPage: true }, { selector: '.card', clip: { x: 0, y: 0, width: 10, height: 10 } },
    { selector: 'div[' }, { selector: 'text=foo' }, { selector: 'div >> text=foo' },
    ...['div::before', '*|div', '::part(x)', '&'].flatMap(selector => [{ selector }, { waitForSelector: selector }])];
  const before = targetRequests;
  for (const body of bad) { const result = await post(body); assert.equal(result.status, 400, JSON.stringify(body)); }
  assert.equal(targetRequests, before);
  for (const body of [{ selector: '.card' }, { clip: { x: 0, y: 500, width: 300, height: 160 } }]) {
    const normalized = normalizeOptions({ url: origin, ...body });
    assert.deepEqual(normalizeOptions(normalized), normalized);
  }
});

test('selector captures the first match below the fold at both densities', async () => {
  for (const scale of [1, 2]) {
    const result = await post({ selector: '.card', scale });
    assert.deepEqual(metadata(result).output.target, { mode: 'selector', bounds: { x: 0, y: 1500, width: 300, height: 160 } });
    await image(result, 300 * scale, 160 * scale, [0, 128, 0]);
  }
});

test('a target removed or hidden after readiness returns 422 without waiting for a match', async () => {
  const page = await browser.newPage();
  const options = normalizeOptions({ url: origin, selector: '#promo' });
  try {
    for (const action of ['remove', 'hide']) {
      await page.setContent('<div id="promo" style="width:100px;height:50px">Promo</div>');
      await prepareTarget(page, options, 1000);
      await page.evaluate(action => {
        const element = document.querySelector<HTMLElement>('#promo')!;
        if (action === 'remove') element.remove();
        else element.style.visibility = 'hidden';
      }, action);
      // A short page timeout would turn the previous evaluate() implementation
      // into a TimeoutError, so this distinguishes the 422 path without sleeps.
      page.setDefaultTimeout(100);
      await assert.rejects(targetBounds(page, options), { code: 'TARGET_NOT_VISIBLE', status: 422 });
    }
  } finally { await page.close(); }
});

test('selector waits for delayed visibility and scrolls nested containers', async () => {
  for (const [path, selector] of [['/delayed', '#later'], ['/nested', '.card'], ['/shadow', '.card']]) {
    const response = await post({ selector }, path);
    await image(response, 600, 320, [0, 128, 0]);
  }
});

test('targeting scrolls to lazy images and waits for their pixels', async () => {
  for (const body of [{ selector: '#lazy' }, { clip: { x: 0, y: 1600, width: 300, height: 160 } }]) {
    const result = await post({ ...body, waitUntil: 'domcontentloaded' }, '/lazy');
    assert.equal(metadata(result).loading.images?.loaded, 1);
    await image(result, 600, 320, [0, 128, 0]);
  }
});

test('clip uses document coordinates outside the viewport without density changing its position', async () => {
  for (const scale of [1, 2]) {
    const result = await post({ clip: { x: 40, y: 1520, width: 200, height: 100 }, scale });
    assert.deepEqual(metadata(result).output.target, { mode: 'clip', bounds: { x: 40, y: 1520, width: 200, height: 100 } });
    await image(result, 200 * scale, 100 * scale, [0, 128, 0]);
  }
  await image(await post({ clip: { x: 1700, y: 450, width: 300, height: 160 } }, '/wide'), 600, 320, [0, 128, 0]);
});

test('targets larger than the viewport and lossy formats work', async () => {
  await image(await post({ selector: '.card' }, '/wide'), 5000, 1400, [0, 128, 0]);
  for (const format of ['jpeg', 'webp']) {
    const response = await post({ selector: '.card', format, quality: 70 });
    assert.equal(response.status, 200); assert.equal(response.headers.get('content-type'), `image/${format}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(format === 'jpeg' ? bytes.subarray(0,3).toString('hex') : bytes.subarray(8,12).toString(), format === 'jpeg' ? 'ffd8ff' : 'WEBP');
  }
});

test('missing or hidden targets return errors, and capacity is released', async () => {
  for (const selector of ['#missing', '#hidden', '.card']) {
    const response = await post({ selector }, '/hidden');
    assert.equal(response.status, 422); assert.equal((await response.json()).error.code, 'TARGET_NOT_VISIBLE');
  }
  const response = await post({ selector: '#missing', timeout: 1000 });
  assert.equal(response.status, 504);
  await image(await post({ selector: '.card' }), 600, 320);
});

test('out-of-document and oversized targets fail rather than silently truncating', async () => {
  for (const body of [{ clip: { x: 0, y: 2400, width: 100, height: 100 } }, { clip: { x: 600, y: 0, width: 100, height: 100 } }]) {
    const response = await post(body); assert.equal(response.status, 422);
    assert.equal((await response.json()).error.code, 'TARGET_OUT_OF_BOUNDS');
  }
  for (const body of [{ selector: '.card', format: 'webp' }, { clip: { x: 0, y: 0, width: 10000, height: 10000 } }]) {
    const response = await post(body, '/large'); assert.equal(response.status, 422);
    assert.equal((await response.json()).error.code, 'TARGET_TOO_LARGE');
  }
});

test('final selector bounds reflect layout changes during loading', async () => {
  const result = await post({ selector: '.card', delay: 200 }, '/resize');
  assert.equal(metadata(result).output.target?.bounds.width, 420);
  await image(result, 840, 320, [0, 128, 0]);
});

test('fractional elements at the document edge are captured without a false bounds error', async () => {
  const response = await post({ selector: '.card' }, '/fractional');
  // Chromium encloses fractional element bounds in whole CSS pixels.
  await image(response, 600, 322, [0, 128, 0]);
});

test('native cleanup composes with selector and clip without adding site rules', { skip: !native }, async () => {
  const nativeCapture = createCaptureService();
  try {
    for (const body of [{ selector: '.card' }, { clip: { x: 0, y: 0, width: 300, height: 160 } }]) {
      const result = await nativeCapture({ url: origin + '/overlay', cleanup: 'standard', ...body });
      assert.equal(result.metadata.engine, 'adguard-api-mv3');
      const response = new Response(new Uint8Array(result.image), { headers: { 'Content-Type': result.contentType } });
      await image(response, 600, 320, [0, 128, 0]);
    }
  } finally { await nativeCapture.close(); }
});
