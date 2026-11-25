import type { RequestType } from '@ghostery/adblocker-playwright';
import type { CaptureContext, CapturePage, CleanupCategories, Residual } from './types.ts';

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { PlaywrightBlocker, Request } from '@ghostery/adblocker-playwright';
import { inspectDOM } from './dom.ts';

export interface Blocker {
  cosmetic: PlaywrightBlocker;
  network: PlaywrightBlocker | null;
  version: string;
  categories: string[];
}
export interface FilterManifest {
  version: string;
  sources: Record<string, { sha256: string; compressedSha256: string; sourceSha256: string; sourceCompressedSha256: string }>;
}

const directory = new URL('../../resources/filters/', import.meta.url);
const engines = new Map<string, Promise<Blocker>>();
const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');

export async function attachNetworkBlocking(context: CaptureContext, network: PlaywrightBlocker, counters: { blockedRequests: number; networkErrors: number }) {
  if (!context.route) throw new Error('Browser context does not support network routing');
  await context.route('**/*', async route => {
    try {
      const details = route.request();
      const frame = details.frame();
      if (details.isNavigationRequest() && !frame.parentFrame()) return await route.continue();
      const request = Request.fromRawDetails({ url: details.url(), sourceUrl: frame.url(), type: details.resourceType() as RequestType });
      if (network.match(request).match) {
        counters.blockedRequests++;
        return await route.abort('blockedbyclient');
      }
      await route.continue();
    } catch {
      counters.networkErrors++;
      await route.continue().catch(() => {});
    }
  });
}

export async function loadBlocker(categories: Partial<CleanupCategories> & { chat?: boolean }): Promise<Blocker> {
  const names = (['cookies', 'popups', 'chat', 'ads'] as const).filter(name => categories[name]);
  const key = names.join(',');
  if (!engines.has(key)) {
    const promise = (async () => {
      const manifest: FilterManifest = JSON.parse(await readFile(new URL('manifest.json', directory), 'utf8'));
      const lists = await Promise.all(names.map(async name => {
        const compressed = await readFile(new URL(`${name}.txt.gz`, directory));
        if (sha256(compressed) !== manifest.sources[name].compressedSha256) throw new Error('Invalid filter snapshot');
        const text = gunzipSync(compressed).toString();
        if (sha256(text) !== manifest.sources[name].sha256) throw new Error('Invalid filter snapshot');
        return text;
      }));
      const text = lists.join('\n');
      const cosmetic = PlaywrightBlocker.parse(text, { loadNetworkFilters: false, loadCosmeticFilters: true, loadExtendedSelectors: false });
      // Network blocking exists only for the explicitly selected ads category.
      const network = categories.ads ? PlaywrightBlocker.parse(lists[names.indexOf('ads')], {
        loadNetworkFilters: true, loadCosmeticFilters: false, loadCSPFilters: false,
      }) : null;
      return { cosmetic, network, version: manifest.version, categories: names };
    })();
    engines.set(key, promise);
    promise.catch(() => engines.delete(key));
  }
  return engines.get(key)!;
}

export async function applyCosmetics(page: Pick<CapturePage, 'frames'>, blocker: Pick<Blocker, 'cosmetic'>) {
  const summary = { hidden: 0, guarded: 0, invalid: 0, framesSkipped: 0 };
  for (const frame of page.frames()) {
    try {
      if (frame.parentFrame()) {
        const owner = await frame.frameElement();
        try { if (!(await owner.isVisible())) continue; } finally { await owner.dispose(); }
      }
      const { hostname, domain } = Request.fromRawDetails({ url: frame.url() });
      const features = await frame.evaluate(() => {
        const roots: (Document | ShadowRoot)[] = [document];
        const ids = new Set<string>(), classes = new Set<string>(), hrefs = new Set<string>();
        let count = 0;
        for (let index = 0; index < roots.length && count < 20_000; index++) {
          for (const element of roots[index].querySelectorAll('*')) {
            if (++count > 20_000) break;
            if (element.id) ids.add(element.id);
            for (const name of element.classList) classes.add(name);
            const href = element.getAttribute('href');
            if (href !== null) hrefs.add(href);
            if (element.shadowRoot) roots.push(element.shadowRoot);
          }
        }
        return { ids: [...ids], classes: [...classes], hrefs: [...hrefs] };
      });
      const ancestors = [];
      for (let ancestor = frame.parentFrame(); ancestor; ancestor = ancestor.parentFrame()) {
        const request = Request.fromRawDetails({ url: ancestor.url() });
        ancestors.push({ hostname: request.hostname, domain: request.domain });
      }
      const { matches } = blocker.cosmetic.matchCosmeticFilters({ url: frame.url(), hostname, domain, ancestors, ...features,
        getRulesFromDOM: true, getRulesFromHostname: true, getInjectionRules: false, getExtendedRules: false });
      const selectors = [...new Set(matches.flatMap(({ filter, exception }) => filter && !exception
        && !filter.isScriptInject() && !filter.isExtended() && !filter.hasCustomStyle() ? [filter.getSelector()] : []))];
      const result = await frame.evaluate(inspectDOM, { selectors, apply: true });
      summary.hidden += result.hidden;
      summary.guarded += result.guarded;
      summary.invalid += result.invalid;
    } catch {
      summary.framesSkipped++;
    }
  }
  return summary;
}

export async function inspectPage(page: Pick<CapturePage, 'frames'>): Promise<Residual> {
  const frames: { residual: Residual['state']; signals: string[] }[] = [];
  for (const frame of page.frames()) {
    try {
      if (frame.parentFrame()) {
        const owner = await frame.frameElement();
        try { if (!(await owner.isVisible())) continue; } finally { await owner.dispose(); }
      }
      frames.push(await frame.evaluate(inspectDOM).then(({ residual, signals }) => ({ residual, signals })));
    } catch { frames.push({ residual: 'unknown', signals: ['frame-unavailable'] }); }
  }
  const state = frames.some(frame => frame.residual === 'blocked') ? 'blocked'
    : frames.some(frame => frame.residual === 'suspected') ? 'suspected'
      : frames.some(frame => frame.residual === 'unknown') ? 'unknown' : 'none-detected';
  return { state, signals: [...new Set(frames.flatMap(frame => frame.signals))] };
}
