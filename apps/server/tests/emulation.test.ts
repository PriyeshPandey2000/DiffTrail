import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { after, before, test } from 'node:test';
import { createApp } from '../src/app.ts';
import { createCaptureService } from '../src/services/capture.ts';
import { DEVICES, MAX_SCALE, contextOptions } from '../src/services/emulation.ts';
import { normalizeOptions } from '../src/services/options.ts';

interface Report {
  headers: { userAgent?: string; acceptLanguage?: string };
  page: Record<string, unknown>;
}
// The fixture page reports what the browser exposes back to the fixture server.
const probe = `<!doctype html><meta name="viewport" content="width=device-width"><body><script>
fetch('/report', { method: 'POST', body: JSON.stringify({
  userAgent: navigator.userAgent, language: navigator.language,
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  dark: matchMedia('(prefers-color-scheme: dark)').matches,
  reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
  print: matchMedia('print').matches,
  touch: navigator.maxTouchPoints > 0,
  width: innerWidth, ratio: devicePixelRatio,
}) });
</script></body>`;
let server: http.Server;
let origin: string;
let reports: Report[] = [];
let pending: Partial<Report> = {};
before(async () => {
  server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/report') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => { reports.push({ headers: pending.headers ?? {}, page: JSON.parse(body) }); res.end(); });
      return;
    }
    if (req.url === '/slow.svg') {
      setTimeout(() => { if (!res.destroyed) { res.setHeader('Content-Type', 'image/svg+xml'); res.end('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="green"/></svg>'); } }, 400);
      return;
    }
    if (req.url === '/wide' || req.url === '/wide-image') {
      // No viewport meta tag: mobile browsers lay this out 980 CSS px wide and zoom out.
      res.setHeader('Content-Type', 'text/html');
      res.end('<!doctype html><body style="margin:0;height:2500px"><div style="position:absolute;left:800px;top:100px;width:150px;height:150px;background:rgb(255,0,0)"></div>'
        + (req.url === '/wide-image' ? '<img src="/slow.svg" width="100" height="100" style="position:absolute;left:600px;top:20px">' : '') + '</body>');
      return;
    }
    pending = { headers: { userAgent: req.headers['user-agent'], acceptLanguage: req.headers['accept-language'] } };
    res.setHeader('Content-Type', 'text/html');
    res.end(probe);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  origin = `http://127.0.0.1:${address.port}`;
});
after(async () => {
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
});
async function captureReport(request: Record<string, unknown>) {
  reports = [];
  const capture = createCaptureService({ cleanupEngine: 'cosmetic', settleMs: 0 });
  try {
    const result = await capture({ url: origin, waitUntil: 'networkidle', ...request } as never);
    assert.equal(reports.length, 1);
    return { result, report: reports[0]! };
  } finally { await capture.close(); }
}

test('every preset resolves from the installed Playwright and has a landscape twin', () => {
  assert.equal(Object.keys(DEVICES).length, 26);
  for (const [id, device] of Object.entries(DEVICES)) {
    assert.equal(device.id, id);
    assert.equal(device.mobile, true);
    assert.equal(device.landscape, id.endsWith('_landscape'));
    if (!device.landscape) assert.ok(DEVICES[`${id}_landscape`]);
  }
});

test('emulation options are omitted unless requested, so the host locale and time zone apply', () => {
  const options = normalizeOptions({ url: origin });
  for (const key of ['device', 'userAgent', 'locale', 'timezone', 'colorScheme', 'reducedMotion', 'media']) assert.equal(key in options, false, key);
  assert.deepEqual(contextOptions(options), { viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2 });
});

test('a device preset sets viewport and density, and explicit options override it', () => {
  const phone = normalizeOptions({ url: origin, device: 'iphone_15' });
  assert.deepEqual([phone.viewport, phone.scale], [{ width: 393, height: 659 }, 3]);
  assert.equal(MAX_SCALE, 5);
  assert.equal(normalizeOptions({ url: origin, device: 'galaxy_s9+' }).scale, 4.5);
  assert.equal(normalizeOptions({ url: origin, device: 'pixel_5' }).scale, 2.75);
  const custom = normalizeOptions({ url: origin, device: 'iphone_15', viewport: { width: 500 }, scale: 1, userAgent: 'DiffTrail-Test/1.0' });
  assert.deepEqual([custom.viewport, custom.scale], [{ width: 500, height: 659 }, 1]);
  assert.equal(contextOptions(custom).userAgent, 'DiffTrail-Test/1.0');
  assert.equal(contextOptions(custom).isMobile, true);
  assert.equal(normalizeOptions({ url: origin, scale: 1.5 }).scale, 1.5);
});

test('viewport and full-page images must fit the format and pixel limits at the requested scale', () => {
  const big = { url: origin, viewport: { width: 3840, height: 4320 } };
  assert.equal(normalizeOptions({ ...big, scale: 2 }).scale, 2);
  for (const extra of [{ scale: 3 }, { scale: 5, viewport: { width: 3840, height: 2160 } }]) {
    assert.throws(() => normalizeOptions({ ...big, ...extra }), { code: 'INVALID_OPTIONS' }, JSON.stringify(extra));
  }
  // Wide full-page captures only need the width to fit; height is truncated as before.
  assert.equal(normalizeOptions({ url: origin, scale: 5, fullPage: true, viewport: { width: 3000 } }).scale, 5);
  assert.throws(() => normalizeOptions({ url: origin, scale: 5, fullPage: true, viewport: { width: 3400 }, format: 'webp' }), { code: 'INVALID_OPTIONS' });
  // Targets are checked against their own size, not the viewport.
  assert.equal(normalizeOptions({ ...big, scale: 3, selector: 'h1' }).scale, 3);
  assert.equal(normalizeOptions({ url: origin, scale: 5 }).scale, 5);
});

test('emulation options normalize idempotently', () => {
  const once = normalizeOptions({ url: origin, device: 'ipad_mini_landscape', locale: 'de-de', timezone: 'Asia/Kolkata', colorScheme: 'dark', reducedMotion: true, media: 'print', userAgent: 'Agent/1' });
  assert.equal(once.locale, 'de-DE');
  assert.deepEqual(normalizeOptions(once), once);
  assert.equal('reducedMotion' in normalizeOptions({ url: origin, reducedMotion: false }), false);
});

test('invalid emulation options are rejected', () => {
  const bad: unknown[] = [
    { device: 'iphone_99' }, { device: 'iPhone 15' }, { device: 1 }, { device: 'toString' }, { device: '__proto__' },
    { userAgent: '' }, { userAgent: ' ' }, { userAgent: 'a\nb' }, { userAgent: 'ü' }, { userAgent: 'a'.repeat(513) }, { userAgent: 1 },
    { locale: 'not a locale' }, { locale: '' }, { locale: 1 }, { locale: 'x'.repeat(36) },
    { timezone: 'Mars/Olympus' }, { timezone: '+05:30' }, { timezone: '' }, { timezone: 'UTC/../x' }, { timezone: 5 },
    { colorScheme: 'no-preference' }, { colorScheme: true }, { reducedMotion: 'reduce' }, { media: 'tv' },
    { scale: 0.5 }, { scale: 5.5 }, { scale: '2' }, { scale: Number.NaN },
  ];
  for (const extra of bad) assert.throws(() => normalizeOptions({ url: origin, ...extra as object }), { code: 'INVALID_OPTIONS' }, JSON.stringify(extra));
  for (const timezone of ['UTC', 'Europe/Berlin', 'America/Argentina/Buenos_Aires', 'Etc/GMT+5']) assert.equal(normalizeOptions({ url: origin, timezone }).timezone, timezone);
});

test('the browser sees the requested device, language, time zone, and preferences', async () => {
  const { result, report } = await captureReport({ device: 'iphone_15', locale: 'de-DE', timezone: 'Europe/Berlin', colorScheme: 'dark', reducedMotion: true });
  assert.match(report.headers.userAgent ?? '', /iPhone/);
  assert.match(report.headers.acceptLanguage ?? '', /^de-DE/);
  assert.equal(report.page.userAgent, report.headers.userAgent);
  assert.deepEqual([report.page.language, report.page.timezone, report.page.dark, report.page.reducedMotion, report.page.touch, report.page.width, report.page.ratio],
    ['de-DE', 'Europe/Berlin', true, true, true, 393, 3]);
  assert.equal(result.image.readUInt32BE(16), 393 * 3);
  assert.deepEqual(result.metadata.emulation, { device: 'iphone_15', deviceScale: 3, mobile: true, touch: true, userAgent: report.headers.userAgent,
    locale: 'de-DE', timezone: 'Europe/Berlin', colorScheme: 'dark', reducedMotion: true, media: 'screen' });
});

test('without emulation options the browser keeps its defaults and the metadata says so', async () => {
  const { result, report } = await captureReport({ viewport: { width: 800, height: 600 }, scale: 1 });
  assert.match(report.headers.userAgent ?? '', /Chrome/);
  assert.doesNotMatch(report.headers.userAgent ?? '', /iPhone|Mobile/);
  assert.equal(report.page.timezone, Intl.DateTimeFormat().resolvedOptions().timeZone);
  assert.deepEqual([report.page.dark, report.page.touch, report.page.print, report.page.width], [false, false, false, 800]);
  assert.deepEqual(result.metadata.emulation, { device: null, mobile: false, touch: false, userAgent: null, locale: null, timezone: null, colorScheme: null, reducedMotion: false, media: 'screen' });
});

test('custom user agent and print media are applied', async () => {
  const { report } = await captureReport({ userAgent: 'DiffTrail-Test/1.0', media: 'print', scale: 1 });
  assert.equal(report.headers.userAgent, 'DiffTrail-Test/1.0');
  assert.equal(report.page.print, true);
});

test('a preset above 3x renders at its native density', async () => {
  const { result, report } = await captureReport({ device: 'galaxy_s9+' });
  assert.equal(report.page.ratio, 4.5);
  assert.equal(result.image.readUInt32BE(16), 320 * 4.5);
});

test('fractional device density renders at that density', async () => {
  const { result, report } = await captureReport({ device: 'pixel_5' });
  assert.equal(report.page.ratio, 2.75);
  assert.equal(result.image.readUInt32BE(16), Math.round(393 * 2.75));
  assert.equal(result.metadata.output.scale, 2.75);
});

test('full-page capture of a zoomed-out mobile layout keeps the whole visible width', async () => {
  const capture = createCaptureService({ cleanupEngine: 'cosmetic', settleMs: 0 });
  try {
    const result = await capture({ url: `${origin}/wide`, device: 'iphone_15', fullPage: true, scale: 1 });
    // The page is laid out 980 CSS px wide, so the content at x=800 must be in the image.
    assert.equal(result.image.readUInt32BE(16), 980);
    assert.equal(result.image.readUInt32BE(20), 2500);
    assert.equal(result.metadata.output.captureWidth, 980);
    assert.equal(result.metadata.output.truncated, false);
    // Desktop captures keep the configured width.
    const desktop = await capture({ url: `${origin}/wide`, fullPage: true, scale: 1, viewport: { width: 1280, height: 720 } });
    assert.equal(desktop.image.readUInt32BE(16), 1280);
    assert.equal('captureWidth' in desktop.metadata.output, false);
  } finally { await capture.close(); }
});

test('image readiness counts images visible in a zoomed-out mobile viewport', async () => {
  const capture = createCaptureService({ cleanupEngine: 'cosmetic', settleMs: 0 });
  try {
    const result = await capture({ url: `${origin}/wide-image`, device: 'iphone_15', waitUntil: 'domcontentloaded', scale: 1 });
    // The image at x=600 is outside 393 CSS px but inside the zoomed-out view, so it is waited for.
    assert.equal(result.metadata.loading.images?.loaded, 1);
    assert.equal(result.metadata.loading.images?.state, 'ready');
  } finally { await capture.close(); }
});

test('GET /api/devices lists presets with their capture density', async () => {
  const app = http.createServer(createApp({ capture: Object.assign(async () => { throw new Error('unused'); }, { close: async () => {} }) }));
  app.listen(0, '127.0.0.1');
  await once(app, 'listening');
  const address = app.address();
  assert.ok(address && typeof address !== 'string');
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/devices`);
    assert.equal(response.status, 200);
    const { devices } = await response.json() as { devices: { id: string; scale: number; deviceScale: number }[] };
    assert.equal(devices.length, 26);
    const s9 = devices.find(device => device.id === 'galaxy_s9+');
    assert.deepEqual([s9?.deviceScale, s9?.scale], [4.5, 4.5]);
    const invalid = await fetch(`http://127.0.0.1:${address.port}/api/screenshot`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: 'https://example.com', device: 'nope' }) });
    assert.equal(invalid.status, 400);
  } finally {
    app.closeAllConnections();
    await new Promise<void>(resolve => app.close(() => resolve()));
  }
});
