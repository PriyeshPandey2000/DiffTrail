import type { CaptureOptions, CapturePage, Clip, ImageOutput } from './types.ts';
import { CaptureError } from './options.ts';
import { MAX_FORMAT_SIDE, MAX_OUTPUT_PIXELS } from './output.ts';

// Validate CSS on the blank page, before navigation or any target-page scripts.
export async function validateSelectors(page: CapturePage, options: CaptureOptions) {
  for (const key of ['selector', 'waitForSelector'] as const) {
    const selector = options[key];
    if (selector === undefined) continue;
    const valid = await page.evaluate(value => { try { document.querySelector(value); return true; } catch { return false; } }, selector);
    if (!valid) throw new CaptureError('INVALID_OPTIONS', `${key} must be a valid CSS selector.`, 400);
    try {
      // Browser CSS and Playwright's parser accept different syntax. Count on
      // the blank page validates the actual capture engine without waiting.
      await targetLocator(page, selector).count();
    } catch (error) {
      if (error instanceof Error && /while parsing css selector/i.test(error.message)) {
        throw new CaptureError('INVALID_OPTIONS', `${key} must be a CSS selector supported by Playwright.`, 400);
      }
      // Browser closure and protocol errors are capture failures, not bad input.
      throw error;
    }
  }
}

export function targetLocator(page: CapturePage, selector: string) {
  // Force CSS; callers cannot inject Playwright's text, XPath, or chaining engines.
  return page.locator(`css=${selector}`).first();
}

export async function prepareTarget(page: CapturePage, options: CaptureOptions, timeout: number): Promise<void> {
  if (options.clip) {
    await page.evaluate(({ x, y }) => window.scrollTo({ left: x, top: y, behavior: 'instant' }), options.clip);
    return;
  }
  if (options.selector === undefined) return;
  const locator = targetLocator(page, options.selector);
  const deadline = Date.now() + timeout;
  try {
    await locator.waitFor({ state: 'visible', timeout });
    await locator.scrollIntoViewIfNeeded({ timeout: Math.max(1, deadline - Date.now()) });
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw new CaptureError('TARGET_NOT_VISIBLE', 'The first matching element was missing, hidden, or unstable within the target wait limit.', 422);
    }
    throw error;
  }
}

// Bounds are document-relative CSS pixels, even after scrolling nested containers.
export async function targetBounds(page: CapturePage, options: CaptureOptions): Promise<Clip | undefined> {
  if (options.clip) return options.clip;
  if (options.selector === undefined) return;
  // Read position and scroll offset together: scroll anchoring can move both
  // between separate protocol calls while a lazy page grows (e.g. Amazon).
  // evaluateAll does not wait for a missing match. Initial readiness was already
  // checked; a target removed during cleanup must fail as 422, not a timeout.
  const box = await targetLocator(page, options.selector).evaluateAll(elements => {
    const element = elements[0];
    if (!element || getComputedStyle(element).visibility === 'hidden') return null;
    const rect = element.getBoundingClientRect();
    return { x: rect.x + scrollX, y: rect.y + scrollY, width: rect.width, height: rect.height };
  });
  if (!box || box.width <= 0 || box.height <= 0) throw new CaptureError('TARGET_NOT_VISIBLE', 'The first matching element has no visible bounds.', 422);
  return box;
}

export async function renderTarget(page: CapturePage, options: CaptureOptions, timeout: number): Promise<{ image: Buffer; output: ImageOutput }> {
  // Playwright waits for fonts during encoding too. Resolve them before measuring
  // so a late font swap does not make the recorded bounds stale immediately.
  await page.evaluate(async () => { await document.fonts.ready; });
  // Re-resolve after cleanup and image loading: either can change the layout.
  await prepareTarget(page, options, Math.min(5000, timeout));
  const bounds = (await targetBounds(page, options))!;
  const { width, height } = bounds;
  const side = MAX_FORMAT_SIDE[options.format];
  // Native element screenshots enclose fractional CSS bounds in whole pixels.
  const outputWidth = (Math.ceil(bounds.x + width) - Math.floor(bounds.x)) * options.scale;
  const outputHeight = (Math.ceil(bounds.y + height) - Math.floor(bounds.y)) * options.scale;
  if (outputWidth > side || outputHeight > side || outputWidth * outputHeight > MAX_OUTPUT_PIXELS) {
    throw new CaptureError('TARGET_TOO_LARGE', 'The requested target exceeds the format or output-pixel limit. Reduce its size, use scale:1, or choose another format.', 422);
  }
  const documentSize = await page.evaluate(() => ({
    width: Math.max(innerWidth, document.documentElement.scrollWidth, document.body?.scrollWidth ?? 0),
    height: Math.max(innerHeight, document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0),
  }));
  // scrollWidth/Height are integers while element geometry is fractional.
  // A selector may touch the rounded document edge; explicit clips stay exact.
  const tolerance = options.selector === undefined ? 0 : 1;
  if (bounds.x < -tolerance || bounds.y < -tolerance || bounds.x + width > documentSize.width + tolerance || bounds.y + height > documentSize.height + tolerance) {
    throw new CaptureError('TARGET_OUT_OF_BOUNDS', 'The requested target extends outside the document.', 422);
  }
  const { format, quality, scale, viewport } = options;
  const base = { type: format, timeout, ...(quality === undefined ? {} : { quality }) } as const;
  const image = options.selector !== undefined
    ? await targetLocator(page, options.selector).screenshot(base)
    : await page.screenshot({ ...base, fullPage: true, clip: bounds });
  return { image, output: { format, ...(quality === undefined ? {} : { quality }), scale, fullPage: false, viewport,
    truncated: false, target: { mode: options.selector !== undefined ? 'selector' : 'clip', bounds } } };
}
