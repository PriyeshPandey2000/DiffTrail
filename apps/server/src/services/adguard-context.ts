import type { BrowserContext, BrowserContextOptions } from 'playwright';
import type { AdguardWorker, CleanupCategories, CleanupCategory } from './types.ts';

import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CaptureError } from './options.ts';
import { DEFAULT_VIEWPORT, SCALE } from './output.ts';

interface RuntimeBuild {
  lazyStart: boolean;
  files: Record<string, string>;
  package: string;
  referenceVersion: string;
}
interface RuntimeState {
  ready: boolean;
  configuration?: { rules?: string[] };
  enabled: string[];
  rulesCount: number;
}

export const filterCategories = Object.freeze({
  cookies: [18], popups: [19], ads: [2], tracking: [3, 17, 25], social: [4],
  widgets: [22], appBanners: [20], otherAnnoyances: [21],
});
export const selectFilters = (categories: Partial<CleanupCategories>) => [...new Set(Object.entries(filterCategories)
  .filter(([key]) => categories[key as CleanupCategory]).flatMap(([, ids]) => ids))].sort((a, b) => a - b);
const directory = new URL('../../../../.cache/adguard-runtime/extension/', import.meta.url);
const extensionPath = fileURLToPath(directory);
const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
let verified: Promise<RuntimeBuild & { rulesVersion: string }> | undefined;
async function loadBuild() {
  if (!verified) {
    verified = (async () => {
      const build: RuntimeBuild = JSON.parse(await readFile(new URL('build.json', directory), 'utf8'));
      if (!build.lazyStart || !build.files || Object.keys(build.files).length < 3) throw new Error('Invalid AdGuard runtime build');
      for (const [name, expected] of Object.entries(build.files)) {
        if (sha256(await readFile(new URL(name, directory))) !== expected) throw new Error('AdGuard asset checksum mismatch');
      }
      return { ...build, rulesVersion: sha256(JSON.stringify(build.files)).slice(0, 16) };
    })();
    verified.catch(() => { verified = undefined; });
  }
  return verified;
}

// Fresh persistent profile per capture. Extension storage and website storage
// never cross requests. No pool of previously visited profiles is maintained.
export async function createAdguardContext(categories: Partial<CleanupCategories>, { timeoutMs = 25_000, headless = true, contextOptions = { viewport: { ...DEFAULT_VIEWPORT }, deviceScaleFactor: SCALE } }: { timeoutMs?: number; headless?: boolean; contextOptions?: BrowserContextOptions } = {}): Promise<AdguardWorker<BrowserContext>> {
  const started = Date.now();
  let build;
  try { build = await loadBuild(); }
  catch { throw new CaptureError('CLEANUP_UNAVAILABLE', 'Run npm run setup:adguard to build the verified AdGuard runtime.', 503); }
  const profile = await mkdtemp(resolve(tmpdir(), 'difftrail-adguard-'));
  let context: BrowserContext | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closing: Promise<void> | undefined;
  const close = () => closing ||= (async () => {
    try { await context?.close(); } finally { await rm(profile, { recursive: true, force: true }); }
  })();
  try {
    const initialize = async (): Promise<AdguardWorker<BrowserContext>> => {
      context = await chromium.launchPersistentContext(profile, {
        ...contextOptions, channel: 'chromium', headless, timeout: Math.min(10_000, timeoutMs), acceptDownloads: false,
        args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
      });
      const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: Math.max(1, timeoutMs - (Date.now() - started)) });
      const id = new URL(worker.url()).host;
      const control = await context.newPage();
      await control.goto(`chrome-extension://${id}/status.html`);
      const filters = selectFilters(categories);
      const state = await control.evaluate(async filters => {
        const { chrome } = globalThis as unknown as { chrome: { runtime: {
          sendMessage(message: { type: string; filters: number[] }): Promise<RuntimeState>;
        } } };
        return chrome.runtime.sendMessage({ type: 'difftrail:configure', filters });
      }, filters);
      if (!state?.ready || state.configuration?.rules?.length || !filters.every(filter => state.enabled.includes(`ruleset_${filter}`))
        || state.enabled.some(name => !filters.includes(Number(name.replace('ruleset_', ''))))) {
        throw new Error('AdGuard selected rulesets are not ready');
      }
      await control.close();
      // Close launch pages before allowing the target navigation.
      for (const page of context.pages()) await page.close();
      return { context, close, metadata: { engine: 'adguard-api-mv3', package: build.package,
        referenceVersion: build.referenceVersion, rulesVersion: build.rulesVersion, filters,
        rulesCount: state.rulesCount, setupMs: Date.now() - started } };
    };
    const pending = initialize();
    // If Chromium finishes launching after the setup deadline, close it too.
    const closeLate = async () => { if (closing) { try { await context?.close(); } finally { await rm(profile, { recursive: true, force: true }); } } };
    pending.then(closeLate, closeLate).catch(() => {});
    return await Promise.race([pending, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new CaptureError('CAPTURE_TIMEOUT', 'AdGuard startup exceeded its time limit.', 504)), timeoutMs);
    })]);
  } catch (error) {
    await close();
    if (error instanceof CaptureError) throw error;
    throw new CaptureError('CLEANUP_UNAVAILABLE', 'Unable to initialize AdGuard. Run npm run setup:adguard and retry.', 503);
  } finally { clearTimeout(timer); }
}
