import type { CaptureOptions, CapturePage, LoadingMetadata, ImageReadiness, Clip } from './types.ts';
import { CaptureError } from './options.ts';
import { captureHeightLimit } from './output.ts';

// All waits run inside capture's shared deadline, which closes the context on expiry.
export async function preparePage(page: CapturePage, options: CaptureOptions, timeout: number): Promise<LoadingMetadata> {
  const metadata: LoadingMetadata = { waitUntil: options.waitUntil, delay: options.delay, timeout,
    selector: 'not-requested', scroll: { status: 'not-requested', steps: 0 } };
  if (options.scroll) {
    const config = options.scroll;
    metadata.scroll.status = 'limited';
    const heightLimit = options.fullPage ? captureHeightLimit(options).height : Number.MAX_SAFE_INTEGER;
    try {
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
      for (let index = 0; index < config.maxSteps; index++) {
        const reached = await page.evaluate(limit => scrollY + innerHeight >= Math.min(limit,
          Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight || 0)) - 1, heightLimit);
        if (reached) { metadata.scroll.status = 'completed'; break; }
        const previous = await page.evaluate(() => window.scrollY);
        await page.evaluate(step => window.scrollTo({ top: window.scrollY + step, behavior: 'instant' }), config.step);
        await page.waitForTimeout(config.delay);
        metadata.scroll.steps++;
        const position = await page.evaluate(limit => ({ y: window.scrollY,
          bottom: window.scrollY + innerHeight >= Math.min(limit, Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight || 0)) - 1 }), heightLimit);
        if (position.bottom) { metadata.scroll.status = 'completed'; break; }
        if (position.y <= previous) { metadata.scroll.status = 'blocked'; break; }
      }
    } finally {
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    }
  }
  if (options.waitForSelector !== undefined) {
    const selector = options.waitForSelector;
    const valid = await page.evaluate(value => { try { document.querySelector(value); return true; } catch { return false; } }, selector);
    if (!valid) throw new CaptureError('INVALID_OPTIONS', 'waitForSelector must be a valid CSS selector.', 400);
    // Prefixing with css= prevents a selector string from choosing another Playwright engine.
    await page.waitForSelector(`css=${selector}`, { state: 'visible', timeout });
    metadata.selector = 'matched';
  }
  if (options.delay) await page.waitForTimeout(options.delay);
  return metadata;
}

// Best-effort main-document img readiness. Broken images never hold up a capture.
// This is bounded by both this budget and capture's shared request deadline.
export async function waitForImages(page: CapturePage, options: CaptureOptions, budgetMs = 1500, region?: Clip): Promise<ImageReadiness> {
  const start = Date.now();
  const unknown = (): ImageReadiness => ({ state: 'unknown', loaded: 0, failed: 0, pending: 0, untriggered: 0, elapsedMs: Date.now() - start });
  const height = options.fullPage ? captureHeightLimit(options).height : options.viewport.height;
  try {
    while (true) {
      const counts = await page.evaluate(({ fullPage, height, width, region }) => {
        const all = document.querySelectorAll('img');
        const counts = { loaded: 0, failed: 0, pending: 0, untriggered: 0, limited: all.length > 10_000 };
        const top = region?.y ?? (fullPage ? 0 : scrollY);
        const left = region?.x ?? 0;
        const right = left + (region?.width ?? width);
        const bottom = top + (region?.height ?? height);
        for (let i = 0; i < Math.min(all.length, 10_000); i++) {
          const image = all[i];
          const box = image.getBoundingClientRect();
          if (box.width <= 0 || box.height <= 0 || box.right + scrollX <= left || box.left + scrollX >= right
            || box.bottom + scrollY <= top || box.top + scrollY >= bottom) continue;
          const style = getComputedStyle(image);
          if (style.visibility === 'hidden' || style.opacity === '0') continue;
          if (!(image.currentSrc || image.getAttribute('src') || image.getAttribute('srcset'))) counts.untriggered++;
          else if (!image.complete) counts.pending++;
          else if (image.naturalWidth > 0) counts.loaded++;
          else counts.failed++;
        }
        return counts;
      }, { fullPage: options.fullPage, height, width: options.viewport.width, region });
      if (!counts || typeof counts !== 'object') return unknown();
      const remaining = budgetMs - (Date.now() - start);
      if ((!counts.pending && !counts.untriggered) || remaining <= 0) {
        const { limited, ...images } = counts;
        return { ...images, state: limited ? 'unknown' : counts.pending || counts.untriggered || counts.failed ? 'incomplete' : 'ready', elapsedMs: Date.now() - start };
      }
      // Also lets IntersectionObserver callbacks run after restoring the top.
      await page.waitForTimeout(Math.min(50, remaining));
    }
  } catch { return unknown(); }
}
