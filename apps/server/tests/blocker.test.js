import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import { CosmeticFilter, PlaywrightBlocker, Request } from '@ghostery/adblocker-playwright';
import { loadBlocker, applyCosmetics, inspectPage } from '../src/services/blocker.js';
import { inspectDOM } from '../src/services/dom.js';
import { selectRule } from '../src/services/filter-policy.js';
import { cases, iframeFixture } from './fixtures/cleanup.js';

let browser, server, origin, blocker;
before(async () => {
  server = http.createServer((req, res) => {
    const name = req.url.slice(1);
    res.setHeader('Content-Type', 'text/html');
    res.end(name === 'iframe' || name === 'cross-frame' ? iframeFixture(origin, name === 'cross-frame') : (cases[name]?.html || cases.none.html));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch();
  blocker = await loadBlocker({ cookies: true, popups: true });
});
after(async () => {
  await browser?.close();
  if (server?.listening) {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
async function withPage(name, run) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  try {
    const page = await context.newPage();
    await page.goto(`${origin}/${name}`);
    await run(page, context);
  } finally { await context.close(); }
}

test('snapshot policy drops scripts, custom styles, procedural rules, and consent-network blocking', () => {
  for (const line of [
    "example.com##+js(set-cookie, consent, yes)",
    "example.com#%#//scriptlet('trusted-click-element', '#accept')",
    'example.com#$#body { overflow:auto!important; }',
    'example.com##.modal:style(display:none!important)',
    'example.com##div:has-text(consent)',
    'example.com##^script:has-text(cookie)',
    '||cmp.example.com^',
  ]) assert.equal(selectRule(line, 'cookies').rule, undefined, line);
  assert.equal(selectRule('###cookie-banner', 'cookies').rule, '###cookie-banner');
  assert.equal(selectRule('example.com#@#.cookie-banner', 'cookies').rule, 'example.com#@#.cookie-banner');
  assert.equal(selectRule('||ads.example.com^', 'ads').kind, 'network');
  for (const line of ['||ads.example.com^$redirect=noop.js', '||ads.example.com^$removeparam=tracking', '||ads.example.com^$csp=script-src none']) {
    assert.equal(selectRule(line, 'ads').rule, undefined, line);
  }
});

test('every bundled cosmetic rule passes the action policy and snapshot hashes match', async () => {
  const directory = new URL('../resources/filters/', import.meta.url);
  const manifest = JSON.parse(await readFile(new URL('manifest.json', directory), 'utf8'));
  const hash = value => createHash('sha256').update(value).digest('hex');
  for (const [name, source] of Object.entries(manifest.sources)) {
    const upstream = await readFile(new URL(`upstream/${name}.txt.gz`, directory));
    assert.equal(hash(upstream), source.sourceCompressedSha256);
    assert.equal(hash(gunzipSync(upstream)), source.sourceSha256);
    const compressed = await readFile(new URL(`${name}.txt.gz`, directory));
    assert.equal(hash(compressed), source.compressedSha256);
    const text = gunzipSync(compressed).toString();
    assert.equal(hash(text), source.sha256);
    for (const line of text.split('\n')) {
      const selected = selectRule(line, name);
      assert.equal(selected.rule, line);
      if (selected.kind === 'cosmetic') {
        const filter = CosmeticFilter.parse(line);
        assert.equal(filter.isScriptInject() || filter.isExtended() || filter.hasCustomStyle(), false);
      }
    }
  }
});

test('maintained cookie rules hide a banner without a key, clicks, storage writes, or a network engine', async () => {
  assert.equal(blocker.network, null);
  await withPage('banner', async (page, context) => {
    assert.equal((await inspectPage(page)).state, 'suspected');
    const before = { cookies: await context.cookies(), storage: await page.evaluate(() => ({ ...localStorage })) };
    const result = await applyCosmetics(page, blocker);
    assert.equal(result.hidden, 1);
    assert.equal(result.framesSkipped, 0);
    assert.equal(await page.locator('#cookie-banner').isVisible(), false);
    assert.equal(await page.evaluate(() => window.accepts), 0);
    assert.deepEqual(await context.cookies(), before.cookies);
    assert.deepEqual(await page.evaluate(() => ({ ...localStorage })), before.storage);
    assert.equal((await inspectPage(page)).state, 'none-detected');
    assert.equal(await page.locator('main').isVisible(), true);
  });
});

test('engine preserves domain-scoped exceptions', async () => {
  // Synthetic rules are restricted to this engine-contract test.
  const cosmetic = PlaywrightBlocker.parse('###cookie-banner\n127.0.0.1#@##cookie-banner', { loadNetworkFilters: false });
  await withPage('banner', async page => {
    assert.equal((await applyCosmetics(page, { cosmetic })).hidden, 0);
    assert.equal(await page.locator('#cookie-banner').isVisible(), true);
  });
});

test('upstream rules can hide a zero-height wrapper around a visible fixed dialog', async () => {
  await withPage('wrapper', async page => {
    assert.equal((await applyCosmetics(page, blocker)).hidden, 1);
    assert.equal(await page.locator('[role="dialog"]').isVisible(), false);
    assert.equal(await page.locator('main').isVisible(), true);
    assert.equal((await inspectPage(page)).state, 'none-detected');
  });
});

test('a delayed banner needs an observation window and a later hide pass', async () => {
  await withPage('delayed', async page => {
    assert.equal((await applyCosmetics(page, blocker)).hidden, 0);
    await page.locator('#cookie-banner').waitFor({ state: 'visible', timeout: 5000 });
    assert.equal((await applyCosmetics(page, blocker)).hidden, 1);
  });
});

test('scroll-triggered banners are caught after scrolling', async () => {
  await withPage('scroll', async page => {
    await page.evaluate(() => scrollTo(0, 650));
    await page.locator('#cookie-banner').waitFor({ state: 'visible' });
    assert.equal((await applyCosmetics(page, blocker)).hidden, 1);
  });
});

test('open shadow DOM is supported by the rule matcher and hide pass', async () => {
  await withPage('shadow', async page => {
    assert.equal((await applyCosmetics(page, blocker)).hidden, 1);
    assert.equal(await page.locator('#cookie-banner').isVisible(), false);
  });
});

for (const name of ['iframe', 'cross-frame']) {
  test(`rules run inside ${name}; an empty frame is not declared clear`, async () => {
    await withPage(name, async page => {
      const result = await applyCosmetics(page, blocker);
      assert.equal(result.hidden, 1);
      assert.equal(result.framesSkipped, 0);
      assert.equal(await page.frameLocator('iframe').locator('#cookie-banner').isVisible(), false);
      assert.equal((await inspectPage(page)).state, 'suspected');
    });
  });
}

test('closed shadow DOM remains a disclosed residual without blindly hiding its host', async () => {
  await withPage('closed', async page => {
    assert.equal((await applyCosmetics(page, blocker)).hidden, 0);
    const result = await page.evaluate(inspectDOM);
    assert.equal(result.residual, 'suspected');
    // DOM APIs cannot tell an absent shadow root from a closed one. The entire
    // host is not selected by an upstream rule and no AI action exists here.
    assert.equal(result.candidates.length > 0, true);
  });
});

test('leftover scroll lock is reported as unknown instead of success', async () => {
  await withPage('locked', async page => {
    assert.equal((await applyCosmetics(page, blocker)).hidden, 1);
    assert.deepEqual(await inspectPage(page), { state: 'unknown', signals: ['scroll-lock'] });
    assert.equal(await page.evaluate(() => getComputedStyle(document.body).overflowY), 'hidden');
  });
});

for (const name of ['navigation', 'map', 'none']) {
  test(`${name} control is preserved without a false obstruction flag`, async () => {
    await withPage(name, async page => {
      assert.equal((await applyCosmetics(page, blocker)).hidden, 0);
      assert.equal((await inspectPage(page)).state, 'none-detected');
      assert.equal(await page.locator('main').isVisible(), true);
    });
  });
}

for (const name of ['login', 'age', 'main']) {
  test(`${name} content is guarded even when a list selector matches it`, async () => {
    await withPage(name, async page => {
      const result = await applyCosmetics(page, blocker);
      assert.equal(result.hidden, 0);
      assert.equal(result.guarded > 0, true);
      assert.equal(await page.locator('#cookie-banner').isVisible(), true);
      if (name !== 'main') {
        const detection = await page.evaluate(inspectDOM);
        assert.equal(detection.residual, 'suspected');
        assert.equal(detection.candidates.every(candidate => candidate.protected), true);
      }
    });
  });
}

test('ads have a separate opt-in network engine; cookie mode does not block requests', async () => {
  const ads = await loadBlocker({ ads: true });
  assert.notEqual(ads.network, null);
  assert.equal(ads.network.config.loadCosmeticFilters, false);
  const request = Request.fromRawDetails({ url: 'https://example.com/ads/test.js', sourceUrl: origin, type: 'script' });
  assert.equal(typeof ads.network.match(request).match, 'boolean');
  assert.equal((await loadBlocker({ cookies: true })).network, null);
});

test('live reference labels cover 17 reachable sites and three explicit exclusions', async () => {
  const manifest = JSON.parse(await readFile(new URL('../benchmarks/regressions.json', import.meta.url), 'utf8'));
  assert.equal(manifest.sites.filter(site => site.status === 'reachable-reference').length, 17);
  assert.equal(manifest.sites.filter(site => site.status === 'excluded-access-restriction').length, 3);
  assert.equal(new Set(manifest.sites.map(site => site.id)).size, 20);
  assert.equal(manifest.sites.every(site => site.baseline && site.libraryExpectation === 'unmeasured'), true);
});
