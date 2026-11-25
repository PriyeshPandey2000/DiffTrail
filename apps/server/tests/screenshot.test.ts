import type { Browser, BrowserContext, LaunchOptions } from 'playwright';
import type { CaptureServiceOptions } from '../src/services/capture.ts';
import type { CaptureContext, CaptureHandler, CaptureMetadata, CaptureService } from '../src/services/types.ts';

import assert from 'node:assert/strict';
import { once } from 'node:events';
import http from 'node:http';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import { createApp } from '../src/app.ts';
import { createCaptureService as createService } from '../src/services/capture.ts';
// Keep the earlier cosmetic candidate's regressions independent of the native extension.
const createCaptureService = (options: CaptureServiceOptions = {}) => createService({ cleanupEngine: 'cosmetic', ...options });
import { normalizeOptions } from '../src/services/options.ts';
import { cases } from './fixtures/cleanup.ts';

let target: http.Server;
let origin: string;
before(async () => {
  target = http.createServer((req, res) => {
    if (req.url === '/challenge') {
      res.writeHead(403, { 'Content-Type': 'text/html', 'cf-mitigated': 'challenge' });
      return res.end('<title>Just a moment...</title>Performing security verification');
    }
    if (req.url === '/wp-content/plugins/adrotate/a.js') {
      res.writeHead(200, { 'Content-Type': 'application/javascript' });
      return res.end('document.body.style.background="red"');
    }
    res.writeHead(req.url === '/missing' ? 404 : 200, { 'Content-Type': 'text/html' });
    if (req.url === '/ads-fixture') return res.end('<body style="background:blue"><script src="/wp-content/plugins/adrotate/a.js"></script></body>');
    if (req.url === '/state') return res.end(`<body><script>document.body.style.background=(localStorage.session||document.cookie.includes('session='))?'red':'blue';localStorage.session='yes';document.cookie='session=yes'</script></body>`);
    res.end(cases[(req.url || '/').slice(1)]?.html || cases.banner.html);
  });
  origin = await listen(target);
});
after(async () => close(target));
async function listen(server: http.Server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return `http://127.0.0.1:${address.port}`;
}
async function close(server: http.Server) {
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
}
async function withApi(capture: CaptureHandler, run: (post: (body: unknown) => Promise<Response>, url: string) => Promise<void>) {
  const server = http.createServer(createApp({ capture }));
  const url = await listen(server);
  const post = (body: unknown) => fetch(`${url}/api/screenshot`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  try { await run(post, url); }
  finally { await close(server); await capture.close?.(); }
}
async function withCapture(options: CaptureServiceOptions, run: (capture: CaptureService) => Promise<void>) {
  const capture = createCaptureService({ settleMs: 0, ...options });
  try { await run(capture); } finally { await capture.close(); }
}
function assertPng(image: Buffer) {
  assert.equal(image.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(image.readUInt32BE(16), 3840);
  assert.equal(image.readUInt32BE(20), 2160);
}
const meta = (response: Response): CaptureMetadata => JSON.parse(response.headers.get('x-difftrail-metadata') || 'null');

test('raw HTTP capture loads no blocker, requires no key, and performs no residual scan', async () => {
  await withApi(createCaptureService({ blockerLoader: () => assert.fail('Raw mode loaded rules') }), async post => {
    for (const cleanup of [undefined, 'none', { cookies: false, popups: false }]) {
      const response = await post({ url: origin, cleanup });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('content-type'), 'image/png');
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.equal(response.headers.get('x-difftrail-cleanup'), 'skipped');
      assert.equal(meta(response).residual.state, 'not-checked');
      assert.equal(meta(response).rulesVersion, null);
      assert.equal(meta(response).aiUsed, false);
      assertPng(Buffer.from(await response.arrayBuffer()));
    }
  });
});

test('standard cleanup returns a changed PNG and versioned outcome headers without AI', async () => {
  await withApi(createCaptureService({ settleMs: 0 }), async post => {
    const raw = Buffer.from(await (await post({ url: origin })).arrayBuffer());
    const response = await post({ url: origin, cleanup: 'standard' });
    const image = Buffer.from(await response.arrayBuffer());
    assertPng(image);
    assert.notDeepEqual(image, raw);
    const metadata = meta(response);
    assert.equal(metadata.status, 'applied');
    assert.equal(metadata.hidden, 1);
    assert.equal(metadata.aiUsed, false);
    assert.equal(metadata.consent, 'none');
    assert.equal(metadata.residual.state, 'none-detected');
    assert.ok(metadata.rulesVersion);
    assert.match(metadata.rulesVersion, /^[a-f0-9]{16}$/);
    assert.equal(response.headers.get('x-difftrail-rules-version'), metadata.rulesVersion);
    assert.equal(metadata.blockedRequests, 0);
  });
});

test('default observation window catches a banner inserted after three seconds', async () => {
  await withCapture({ settleMs: 4500 }, async capture => {
    const result = await capture({ url: `${origin}/delayed`, cleanup: 'standard' });
    assert.equal(result.metadata.hidden, 1);
    assert.equal(result.metadata.residual.state, 'none-detected');
    assert.equal(result.cleanup, 'applied');
  });
});

test('leftover scroll lock is disclosed with the usable PNG', async () => {
  await withCapture({}, async capture => {
    const result = await capture({ url: `${origin}/locked`, cleanup: 'standard' });
    assert.equal(result.cleanup, 'partial');
    assert.equal(result.metadata.residual.state, 'unknown');
    assert.ok(result.metadata.residual.signals.includes('scroll-lock'));
    assertPng(result.image);
  });
});

test('protected login UI is retained and reported as suspected rather than removed', async () => {
  await withCapture({}, async capture => {
    const raw = await capture({ url: `${origin}/login` });
    const result = await capture({ url: `${origin}/login`, cleanup: 'standard' });
    assert.equal(result.cleanup, 'unchanged');
    assert.equal(result.metadata.hidden, 0);
    assert.ok(result.metadata.guarded !== null && result.metadata.guarded > 0);
    assert.equal(result.metadata.residual.state, 'suspected');
    assert.deepEqual(result.image, raw.image);
  });
});

test('invalid options, legacy clean, and unavailable actions fail before capture', async () => {
  await withApi(() => assert.fail('Invalid options reached capture'), async post => {
    const bodies = [ {}, { url: 'bad' }, { url: 'file:///tmp/test' }, { url: 'https://user:pass@example.com' },
      { url: [origin] }, ...[true, false, 'true', null, [], 'aggressive', { cookies: 1 }, { typo: true }].map(cleanup => ({ url: origin, cleanup })),
      { url: origin, clean: true }, { url: origin, clean: false }, { url: origin, ai: true }, { url: origin, ai: null },
      { url: origin, consent: 'reject' }, { url: origin, cleanup: { chat: true } }, { url: origin, extra: 'typo' },
    ];
    for (const body of bodies) assert.equal((await post(body)).status, 400, JSON.stringify(body));
    const legacy = await post({ url: origin, clean: true });
    assert.match((await legacy.json()).error.message, /cleanup/);
  });
});

test('category object only enables requested categories and rejects ambiguous booleans', () => {
  assert.deepEqual(normalizeOptions({ url: origin, cleanup: { ads: true } }).cleanup, { cookies: false, popups: false, ads: true, tracking: false, social: false, widgets: false, appBanners: false, otherAnnoyances: false });
  assert.deepEqual(normalizeOptions({ url: origin, cleanup: 'standard' }).cleanup, { cookies: true, popups: true, ads: false, tracking: false, social: false, widgets: false, appBanners: false, otherAnnoyances: false });
});

test('ads network blocking is enabled only when explicitly requested', async () => {
  await withCapture({}, async capture => {
    const ordinary = await capture({ url: `${origin}/ads-fixture`, cleanup: 'standard' });
    const ads = await capture({ url: `${origin}/ads-fixture`, cleanup: { ads: true } });
    assert.equal(ordinary.metadata.blockedRequests, 0);
    assert.equal(ads.metadata.blockedRequests, 1);
    assert.equal(ads.metadata.networkErrors, 0);
    assert.notDeepEqual(ordinary.image, ads.image);
  });
});

test('malformed and oversized JSON get predictable errors', async () => {
  await withApi(() => assert.fail('Capture should not run'), async (post, url) => {
    const response = await fetch(`${url}/api/screenshot`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, 'INVALID_JSON');
    assert.equal((await post({ url: origin, extra: 'x'.repeat(17_000) })).status, 413);
  });
});

test('requested rules failing to initialize return 503; raw capture still works', async () => {
  await withApi(createCaptureService({ blockerLoader: async () => { throw new Error('Missing snapshot'); } }), async post => {
    const response = await post({ url: origin, cleanup: 'standard' });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error.code, 'CLEANUP_UNAVAILABLE');
    assert.equal((await post({ url: origin })).status, 200);
  });
});

test('browser is reused, contexts close, and cookies/storage do not leak between requests', async () => {
  let launches = 0;
  const contexts: BrowserContext[] = [];
  const browserType = { launch: async (options: LaunchOptions) => {
    launches++;
    const instance = await chromium.launch(options);
    const original = instance.newContext.bind(instance);
    instance.newContext = async options => { const context = await original(options); contexts.push(context); return context; };
    return instance;
  } };
  await withCapture({ browserType }, async capture => {
    const first = await capture({ url: `${origin}/state` });
    const next = await capture({ url: `${origin}/state` });
    assert.deepEqual(first.image, next.image);
    assert.equal(launches, 1);
    assert.equal(contexts.length, 2);
    assert.equal(contexts.every(context => context.pages().length === 0), true);
  });
});

test('simultaneous requests share one browser and return separate PNGs', async () => {
  let launches = 0;
  const browserType = { launch: async (options: LaunchOptions) => { launches++; return chromium.launch(options); } };
  await withApi(createCaptureService({ browserType }), async post => {
    const responses = await Promise.all([post({ url: origin }), post({ url: `${origin}/none` })]);
    const images = [];
    for (const response of responses) {
      assert.equal(response.status, 200);
      const image = Buffer.from(await response.arrayBuffer());
      assertPng(image);
      images.push(image);
    }
    assert.notDeepEqual(images[0], images[1]);
    assert.equal(launches, 1);
  });
});

test('browser disconnect recovers on the next request', async () => {
  const browsers: Browser[] = [];
  const browserType = { launch: async (options: LaunchOptions) => { const instance = await chromium.launch(options); browsers.push(instance); return instance; } };
  await withCapture({ browserType }, async capture => {
    await capture({ url: origin });
    await browsers[0].close();
    assertPng((await capture({ url: origin })).image);
    assert.equal(browsers.length, 2);
  });
});

test('browser recycling occurs between requests', async () => {
  let launches = 0;
  const browserType = { launch: async (options: LaunchOptions) => { launches++; return chromium.launch(options); } };
  await withCapture({ browserType, recycleAfter: 1 }, async capture => {
    await capture({ url: origin });
    await capture({ url: origin });
    assert.equal(launches, 2);
  });
});

test('upstream HTTP failures release capacity and allow subsequent captures', async () => {
  await withApi(createCaptureService({ maxConcurrent: 1 }), async post => {
    assert.equal((await post({ url: `${origin}/missing` })).status, 502);
    assert.equal((await post({ url: origin })).status, 200);
  });
});

test('upstream browser challenges expose the target status and reason in JSON', async () => {
  await withApi(createCaptureService(), async post => {
    const response = await post({ url: `${origin}/challenge` });
    assert.equal(response.status, 502);
    const { error } = await response.json();
    assert.equal(error.code, 'UPSTREAM_HTTP_ERROR');
    assert.equal(error.upstreamStatus, 403);
    assert.equal(error.reason, 'browser-verification');
    assert.match(error.message, /HTTP 403.*verification/);
  });
});

test('deadline releases capacity and closes a browser whose context creation stalled', async () => {
  let closed = 0;
  let started!: () => void;
  const launchStarted = new Promise<void>(resolve => { started = resolve; });
  const browserType = { launch: async () => {
    started();
    return { newContext: () => new Promise<CaptureContext>(() => {}), close: async () => { closed++; } };
  } };
  await withCapture({ browserType, maxConcurrent: 1, captureTimeout: 50 }, async capture => {
    const pending = capture({ url: origin });
    const rejected = assert.rejects(pending, { code: 'CAPTURE_TIMEOUT', status: 504 });
    await launchStarted;
    await assert.rejects(capture({ url: origin }), { code: 'CAPACITY_EXCEEDED' });
    await rejected;
    assert.equal(closed, 1);
    await assert.rejects(capture({ url: origin }), { code: 'CAPTURE_TIMEOUT' });
    assert.equal(closed, 2);
  });
});

test('late-created contexts are closed after the request deadline', async () => {
  let resolveContext!: (context: CaptureContext) => void;
  let closes = 0;
  const created = new Promise<CaptureContext>(resolve => { resolveContext = resolve; });
  const browserType = { launch: async () => ({ newContext: () => created, close: async () => {} }) };
  await withCapture({ browserType, captureTimeout: 50 }, async capture => {
    await assert.rejects(capture({ url: origin }), { code: 'CAPTURE_TIMEOUT' });
    resolveContext({ newPage: async () => assert.fail('Expired context must not create a page'), close: async () => { closes++; } });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(closes, 1);
  });
});
