import type { CaptureService } from '../src/services/types.ts';

import assert from 'node:assert/strict';
import { once } from 'node:events';
import http from 'node:http';
import { after, before, test } from 'node:test';
import { createApp } from '../src/app.ts';
import { createCaptureService } from '../src/services/capture.ts';
import { normalizeOptions } from '../src/services/options.ts';
import { MAX_FULL_PAGE_HEIGHT, SCALE, MAX_OUTPUT_PIXELS, captureHeightLimit } from '../src/services/output.ts';

const pageOf = (height: number) => `<body style="margin:0"><div style="height:${height}px;background:linear-gradient(red,blue)"></div></body>`;
let target: http.Server;
let origin: string;
before(async () => {
  target = http.createServer((req, res) => {
    const height = Number((req.url || '').slice(1)) || 400;
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(pageOf(height));
  });
  target.listen(0, '127.0.0.1');
  await once(target, 'listening');
  const address = target.address();
  assert.ok(address && typeof address !== 'string');
  origin = `http://127.0.0.1:${address.port}`;
});
after(async () => {
  target.closeAllConnections();
  await new Promise<void>(resolve => target.close(() => resolve()));
});
async function withCapture(run: (capture: CaptureService) => Promise<void>) {
  const capture = createCaptureService({ cleanupEngine: 'cosmetic', settleMs: 0 });
  try { await run(capture); } finally { await capture.close(); }
}
const pngSize = (image: Buffer) => ({ width: image.readUInt32BE(16), height: image.readUInt32BE(20) });

test('output options default to the existing 1920x1080 PNG viewport capture', () => {
  const options = normalizeOptions({ url: origin });
  assert.equal(options.format, 'png');
  assert.equal(options.fullPage, false);
  assert.equal(options.scale, 2);
  assert.deepEqual(options.viewport, { width: 1920, height: 1080 });
  assert.equal('quality' in options, false);
});

test('lossy formats resolve a default quality and jpg is an alias for jpeg', () => {
  assert.equal(normalizeOptions({ url: origin, format: 'jpg' }).format, 'jpeg');
  assert.equal(normalizeOptions({ url: origin, format: 'jpeg' }).quality, 80);
  assert.equal(normalizeOptions({ url: origin, format: 'webp' }).quality, 80);
  assert.equal(normalizeOptions({ url: origin, format: 'webp', quality: 55 }).quality, 55);
});

test('resolved options are a valid request, so normalizing twice changes nothing', () => {
  for (const input of [{ url: origin }, { url: origin, format: 'webp', quality: 40, fullPage: true, viewport: { width: 1280 } }]) {
    const once = normalizeOptions(input);
    assert.deepEqual(normalizeOptions(once), once);
  }
});

test('invalid output options are rejected', () => {
  const bad: unknown[] = [
    { format: 'gif' }, { format: 'PNG' }, { format: null }, { format: 1 },
    { quality: 80 }, { format: 'png', quality: 80 }, { format: 'jpeg', quality: 0 }, { format: 'jpeg', quality: 101 },
    { format: 'jpeg', quality: 80.5 }, { format: 'jpeg', quality: '80' },
    { fullPage: 'true' }, { fullPage: 1 }, { fullPage: null },
    { viewport: 1280 }, { viewport: null }, { viewport: [] }, { viewport: { width: 199 } }, { viewport: { width: 3841 } },
    { viewport: { height: 199 } }, { viewport: { height: 4321 } }, { viewport: { width: 1280.5 } }, { viewport: { width: '1280' } },
    { viewport: { depth: 1 } }, { scale: 0 }, { scale: 5.01 }, { scale: "2" }, { scale: null },
    { maxHeight: 100 }, { fullPage: true, maxHeight: 0 }, { fullPage: true, maxHeight: 100001 }, { fullPage: true, maxHeight: "100" },
  ];
  for (const extra of bad) assert.throws(() => normalizeOptions({ url: origin, ...extra as object }), { code: 'INVALID_OPTIONS' }, JSON.stringify(extra));
});

test('viewport sets the image size at the fixed pixel density', async () => {
  await withCapture(async capture => {
    const result = await capture({ url: origin, viewport: { width: 1280, height: 720 } });
    assert.equal(result.contentType, 'image/png');
    assert.deepEqual(pngSize(result.image), { width: 1280 * SCALE, height: 720 * SCALE });
    assert.deepEqual(result.metadata.output.viewport, { width: 1280, height: 720 });
    assert.equal(result.metadata.output.truncated, false);
  });
});

test('jpeg and webp are encoded and labelled with the right content type', async () => {
  await withCapture(async capture => {
    const jpeg = await capture({ url: origin, format: 'jpeg', quality: 70 });
    assert.equal(jpeg.contentType, 'image/jpeg');
    assert.equal(jpeg.image.subarray(0, 3).toString('hex'), 'ffd8ff');
    assert.equal(jpeg.metadata.output.quality, 70);
    const webp = await capture({ url: origin, format: 'webp' });
    assert.equal(webp.contentType, 'image/webp');
    assert.equal(webp.image.subarray(0, 4).toString(), 'RIFF');
    assert.equal(webp.image.subarray(8, 12).toString(), 'WEBP');
    const png = await capture({ url: origin, format: 'png' });
    assert.equal(png.metadata.output.quality, undefined);
  });
});

test('full-page capture covers a page taller than the viewport', async () => {
  await withCapture(async capture => {
    const viewportOnly = await capture({ url: `${origin}/3000`, viewport: { width: 1280, height: 720 } });
    assert.equal(pngSize(viewportOnly.image).height, 720 * SCALE);
    const full = await capture({ url: `${origin}/3000`, fullPage: true, viewport: { width: 1280, height: 720 } });
    assert.deepEqual(pngSize(full.image), { width: 1280 * SCALE, height: 3000 * SCALE });
    assert.equal(full.metadata.output.pageHeight, 3000);
    assert.equal(full.metadata.output.truncated, false);
  });
});

test('a full-page capture of a short page is at least one viewport tall', async () => {
  await withCapture(async capture => {
    const result = await capture({ url: `${origin}/100`, fullPage: true, viewport: { width: 1280, height: 720 } });
    assert.equal(pngSize(result.image).height, 720 * SCALE);
    assert.equal(result.metadata.output.truncated, false);
  });
});

test('PNG exceeds the former common cap while WebP is still truncated and disclosed', async () => {
  const tall = MAX_FULL_PAGE_HEIGHT + 4000;
  await withCapture(async capture => {
    const png = await capture({ url: `${origin}/${tall}`, fullPage: true, scroll: false, viewport: { width: 1280, height: 720 } });
    assert.deepEqual(pngSize(png.image), { width: 1280 * SCALE, height: tall * SCALE });
    assert.equal(png.metadata.output.pageHeight, tall);
    assert.equal(png.metadata.output.truncated, false);
    const webp = await capture({ url: `${origin}/${tall}`, fullPage: true, format: 'webp', scroll: false });
    assert.equal(webp.image.subarray(8, 12).toString(), 'WEBP');
    assert.equal(webp.metadata.output.truncated, true);
  });
});

test('HTTP responses carry the format content type and a truncation header only when truncated', async () => {
  const capture = createCaptureService({ cleanupEngine: 'cosmetic', settleMs: 0 });
  const server = http.createServer(createApp({ capture }));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const post = (body: unknown) => fetch(`http://127.0.0.1:${address.port}/api/screenshot`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  try {
    const short = await post({ url: origin, format: 'jpeg', fullPage: true });
    assert.equal(short.status, 200);
    assert.equal(short.headers.get('content-type'), 'image/jpeg');
    assert.equal(short.headers.get('x-difftrail-truncated'), null);
    const cut = await post({ url: `${origin}/${MAX_FULL_PAGE_HEIGHT + 100}`, fullPage: true, format: 'webp', scroll: false });
    assert.equal(cut.status, 200);
    assert.equal(cut.headers.get('content-type'), 'image/webp');
    assert.equal(cut.headers.get('x-difftrail-truncated'), 'true');
    const invalid = await post({ url: origin, format: 'gif' });
    assert.equal(invalid.status, 400);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await capture.close();
  }
});


test('scale 1 is explicit and preserves layout while changing output dimensions', async () => {
  await withCapture(async capture => {
    const result = await capture({ url: origin, scale: 1, viewport: { width: 640, height: 400 } });
    assert.deepEqual(pngSize(result.image), { width: 640, height: 400 });
    assert.equal(result.metadata.output.scale, 1);
  });
});

test('maxHeight clips only full-page captures and reports the requested limit', async () => {
  await withCapture(async capture => {
    const result = await capture({ url: `${origin}/3000`, fullPage: true, maxHeight: 600, viewport: { width: 640, height: 720 } });
    assert.deepEqual(pngSize(result.image), { width: 1280, height: 1200 });
    assert.equal(result.metadata.output.truncated, true);
    assert.deepEqual(result.metadata.output.truncationReasons, ['max-height']);
    assert.equal(result.metadata.loading.scroll.steps, 0);
  });
});

test('format and pixel caps use output pixels at the selected density', () => {
  const options = normalizeOptions({ url: origin, fullPage: true, viewport: { width: 200 } });
  assert.equal(captureHeightLimit({ ...options, format: 'webp' }).height, 8191);
  assert.equal(captureHeightLimit({ ...options, format: 'jpeg' }).height, 32750);
  assert.equal(captureHeightLimit({ ...options, format: 'jpeg', scale: 1 }).height, 65500);
  assert.equal(captureHeightLimit({ ...options, format: 'webp', scale: 1 }).height, 16383);
  const wide = { ...options, viewport: { width: 3840, height: 1080 }, format: 'png' as const };
  const limit = captureHeightLimit(wide);
  assert.equal(limit.height, Math.floor(MAX_OUTPUT_PIXELS / (3840 * 4)));
  assert.ok(3840 * 4 * limit.height <= MAX_OUTPUT_PIXELS);
});
