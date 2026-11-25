import type { CaptureOptions, CapturePage, LoadingMetadata } from './types.ts';
import { CaptureError } from './options.ts';

// All waits run inside capture's shared deadline, which closes the context on expiry.
export async function preparePage(page: CapturePage, options: CaptureOptions, timeout: number): Promise<LoadingMetadata> {
  const metadata: LoadingMetadata = { waitUntil: options.waitUntil, delay: options.delay, timeout,
    selector: 'not-requested', scroll: { status: 'not-requested', steps: 0 } };
  if (options.scroll) {
    const config = options.scroll;
    metadata.scroll.status = 'limited';
    try {
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
      for (let index = 0; index < config.maxSteps; index++) {
        const previous = await page.evaluate(() => window.scrollY);
        await page.evaluate(step => window.scrollTo({ top: window.scrollY + step, behavior: 'instant' }), config.step);
        await page.waitForTimeout(config.delay);
        metadata.scroll.steps++;
        const position = await page.evaluate(() => ({ y: window.scrollY,
          bottom: window.scrollY + innerHeight >= Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight || 0) - 1 }));
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
