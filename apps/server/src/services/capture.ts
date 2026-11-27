import type { BrowserContextOptions } from 'playwright';
import type { AdguardWorker, BrowserLauncher, CaptureBrowser, CaptureContext, CaptureMetadata, CaptureResult, CaptureService, CleanupCategories, Residual } from './types.ts';
import type { Blocker } from './blocker.ts';

import { chromium } from 'playwright';
import { loadBlocker, applyCosmetics, inspectPage, attachNetworkBlocking } from './blocker.ts';
import { createAdguardContext } from './adguard-context.ts';
import { CaptureError, normalizeOptions } from './options.ts';
import { preparePage, waitForImages } from './loading.ts';
import { OUTPUT_FORMATS, renderImage } from './output.ts';
import { contextOptions, emulatePage, emulationMetadata } from './emulation.ts';
import { validateSelectors, prepareTarget, targetBounds, renderTarget } from './target.ts';
export { CaptureError } from './options.ts';

export interface CaptureServiceOptions {
  browserType?: BrowserLauncher;
  headless?: boolean;
  cleanupEngine?: 'adguard' | 'cosmetic';
  adguardFactory?: (categories: CleanupCategories, options: { headless: boolean; timeoutMs: number; contextOptions: BrowserContextOptions }) => Promise<AdguardWorker>;
  blockerLoader?: typeof loadBlocker;
  maxConcurrent?: number;
  captureTimeout?: number;
  settleMs?: number;
  recycleAfter?: number;
}

export function createCaptureService({
  browserType = chromium,
  headless = process.env.DIFFTRAIL_HEADLESS !== 'false',
  cleanupEngine = 'adguard',
  adguardFactory = createAdguardContext,
  blockerLoader = loadBlocker,
  maxConcurrent = cleanupEngine === 'adguard' ? 1 : 2,
  captureTimeout = 30_000,
  settleMs = 4500,
  recycleAfter = 100,
}: CaptureServiceOptions = {}): CaptureService {
  let active = 0, uses = 0, closed = false;
  let browser: CaptureBrowser | undefined;
  let launching: Promise<CaptureBrowser> | undefined;
  const openContexts = new Set<() => Promise<void>>();
  const closeBrowser = async () => {
    const current = browser;
    browser = undefined;
    uses = 0;
    await current?.close();
  };
  const getBrowser = async () => {
    if (browser && browser.isConnected?.() !== false) return browser;
    if (!launching) {
      launching = browserType.launch({ headless, timeout: Math.min(10_000, captureTimeout) }).then(async instance => {
        if (closed) { await instance.close(); throw new CaptureError('SERVICE_CLOSED', 'Capture service is closed.', 503); }
        browser = instance;
        instance.on?.('disconnected', () => { if (browser === instance) browser = undefined; });
        return instance;
      }).finally(() => { launching = undefined; });
    }
    return launching;
  };
  async function capture(input: unknown): Promise<CaptureResult> {
    const options = normalizeOptions(input);
    const requestTimeout = options.timeout ?? captureTimeout;
    if (closed) throw new CaptureError('SERVICE_CLOSED', 'Capture service is closed.', 503);
    if (active >= maxConcurrent) throw new CaptureError('CAPACITY_EXCEEDED', 'Capture capacity reached. Try again shortly.', 503);
    active++;
    const start = Date.now();
    let context: CaptureContext | undefined;
    let nativeWorker: AdguardWorker | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let closingContext: Promise<void> | undefined;
    let expired = false;
    const closeContext = async () => {
      if (!context) return;
      closingContext ||= (async () => {
        try {
          if (nativeWorker) await nativeWorker.close();
          else await context?.close();
        } finally { openContexts.delete(closeContext); }
      })();
      return closingContext;
    };
    const ensureActive = () => {
      if (closed) throw new CaptureError('SERVICE_CLOSED', 'Capture service is closed.', 503);
      if (expired || Date.now() - start >= requestTimeout) throw new CaptureError('CAPTURE_TIMEOUT', 'Capture exceeded its time limit.', 504);
    };
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        expired = true;
        reject(new CaptureError('CAPTURE_TIMEOUT', 'Capture exceeded its time limit.', 504));
      }, requestTimeout);
    });
    const work = async (): Promise<CaptureResult> => {
      const requested = Object.values(options.cleanup).some(Boolean);
      let blocker: Blocker | undefined;
      if (requested && cleanupEngine === 'cosmetic') {
        try { blocker = await blockerLoader(options.cleanup); }
        catch { throw new CaptureError('CLEANUP_UNAVAILABLE', 'Unable to load the bundled cleanup rules.', 503); }
      }
      ensureActive();
      if (requested && cleanupEngine === 'adguard') {
        nativeWorker = await adguardFactory(options.cleanup, { headless, timeoutMs: Math.max(1, requestTimeout - (Date.now() - start)), contextOptions: contextOptions(options) });
        context = nativeWorker.context;
      } else {
        const instance = await getBrowser();
        ensureActive();
        uses++;
        context = await instance.newContext({ ...contextOptions(options), serviceWorkers: 'block', acceptDownloads: false });
      }
      openContexts.add(closeContext);
      try {
        ensureActive();
        const counters = { blockedRequests: 0, networkErrors: 0 };
        if (blocker?.network) await attachNetworkBlocking(context, blocker.network, counters);
        const page = await context.newPage();
        page.setDefaultTimeout(5000);
        page.setDefaultNavigationTimeout(Math.min(15_000, requestTimeout));
        await emulatePage(page, options);
        await validateSelectors(page, options);
        const response = await page.goto(options.url, { waitUntil: options.waitUntil });
        if (response && response.status() >= 400) {
          const upstreamStatus = response.status();
          const challenge = response.headers?.()['cf-mitigated'] === 'challenge';
          throw new CaptureError('UPSTREAM_HTTP_ERROR', `The target page returned HTTP ${upstreamStatus}${challenge ? ' (browser verification challenge)' : ''}.`, 502,
            { upstreamStatus, ...(challenge ? { reason: 'browser-verification' } : {}) });
        }
        const loading = await preparePage(page, options, requestTimeout);
        ensureActive();
        await prepareTarget(page, options, Math.min(5000, Math.max(1, requestTimeout - (Date.now() - start))));
        const summary = { hidden: 0, guarded: 0, invalid: 0, framesSkipped: 0 };
        let residual: Residual = { state: 'not-checked', signals: [] };
        let failed = false, transientFrameErrors = 0;
        if (nativeWorker) {
          // AdGuard's maintained content scripts observe and apply its rules.
          // There is no second layer of DiffTrail selectors or hiding here.
          await page.waitForTimeout(settleMs);
          try { residual = await inspectPage(page); }
          catch { residual = { state: 'unknown', signals: ['inspection-failed'] }; }
        }
        if (blocker) {
          const end = Date.now() + settleMs;
          // Observe delayed DOM after optional loading preparation; cleanup never clicks.
          do {
            ensureActive();
            try {
              const pass = await applyCosmetics(page, blocker);
              summary.hidden += pass.hidden;
              summary.guarded = Math.max(summary.guarded, pass.guarded);
              summary.invalid = Math.max(summary.invalid, pass.invalid);
              summary.framesSkipped = pass.framesSkipped;
              transientFrameErrors += pass.framesSkipped;
            } catch { failed = true; break; }
            const remaining = end - Date.now();
            if (remaining <= 0) break;
            await page.waitForTimeout(Math.min(250, remaining));
          } while (true);
          try { residual = await inspectPage(page); }
          catch { residual = { state: 'unknown', signals: ['inspection-failed'] }; }
          if ((summary.framesSkipped || summary.invalid || counters.networkErrors) && residual.state === 'none-detected') {
            residual = { state: 'unknown', signals: [...residual.signals, 'incomplete-application'] };
          }
        }
        ensureActive();
        const region = await targetBounds(page, options);
        loading.images = await waitForImages(page, options, Math.min(1500, Math.max(0, requestTimeout - (Date.now() - start))), region);
        ensureActive();
        // Full pages can take several seconds to encode; they may use the rest of the deadline.
        const render = options.selector !== undefined || options.clip ? renderTarget : renderImage;
        const { image, output } = await render(page, options, Math.max(1, requestTimeout - (Date.now() - start)));
        ensureActive();
        const applied = summary.hidden > 0 || counters.blockedRequests > 0;
        const incomplete = failed || summary.framesSkipped > 0 || summary.invalid > 0 || counters.networkErrors > 0;
        const status = !requested ? 'skipped' : nativeWorker ? (residual.state === 'none-detected' ? 'enabled' : 'partial') : incomplete ? (applied ? 'partial' : 'failed')
          : applied ? (residual.state === 'none-detected' ? 'applied' : 'partial') : 'unchanged';
        const metadata: CaptureMetadata = {
          status, categories: options.cleanup, engine: nativeWorker ? 'adguard-api-mv3' : blocker ? 'ghostery-cosmetic-experiment' : 'none',
          rulesVersion: nativeWorker?.metadata.rulesVersion ?? blocker?.version ?? null,
          ...summary, ...counters, transientFrameErrors, residual, consent: 'none', aiUsed: false,
          ...(nativeWorker ? {
            hidden: null, guarded: null, blockedRequests: null,
            filtering: nativeWorker.metadata,
            cookieRulesMayInteract: Boolean(options.cleanup.cookies),
          } : {}),
          output, loading, emulation: emulationMetadata(options), elapsedMs: Date.now() - start,
        };
        return { image, contentType: OUTPUT_FORMATS[output.format].contentType, cleanup: status, metadata };
      } finally { await closeContext(); }
    };
    try {
      return await Promise.race([work(), deadline]);
    } catch (error) {
      if (error instanceof CaptureError) throw error;
      if (error instanceof Error && error.name === 'TimeoutError') throw new CaptureError('CAPTURE_TIMEOUT', 'Capture exceeded its time limit.', 504);
      throw new CaptureError('CAPTURE_FAILED', 'Unable to capture the target page.', 502);
    } finally {
      clearTimeout(timer);
      // A timeout interrupts page work by closing its context. A late-created
      // context is also closed in work's finally after ensureActive rejects.
      try {
        if (context) await closeContext();
        else if (expired && active === 1) await closeBrowser();
      } finally {
        active--;
        if (!active && uses >= recycleAfter) await closeBrowser();
      }
    }
  }
  capture.close = async () => {
    closed = true;
    try { await launching; } catch { /* failed launch has nothing to close */ }
    await Promise.allSettled([...openContexts].map(close => close()));
    await closeBrowser();
  };
  return capture;
}
