import type { CapturePage, CaptureOptions, ImageOutput } from './types.ts';

export const OUTPUT_FORMATS = {
  png: { contentType: 'image/png', lossy: false },
  jpeg: { contentType: 'image/jpeg', lossy: true },
  webp: { contentType: 'image/webp', lossy: true },
} as const;
export type OutputFormat = keyof typeof OUTPUT_FORMATS;

export const DEFAULT_FORMAT: OutputFormat = 'png';
export const DEFAULT_QUALITY = 80;
export const DEFAULT_VIEWPORT = Object.freeze({ width: 1920, height: 1080 });
export const VIEWPORT_LIMITS = Object.freeze({ width: [200, 3840], height: [200, 4320] } as const);
// Pixel density is fixed at 2x. A `scale` option may be added later.
export const SCALE = 2;
// One limit for every format: WebP cannot encode more than 16,383 px per side.
export const MAX_IMAGE_DIMENSION = 16_383;
export const MAX_FULL_PAGE_HEIGHT = Math.floor(MAX_IMAGE_DIMENSION / SCALE);

type RenderOptions = Pick<CaptureOptions, 'format' | 'quality' | 'fullPage' | 'viewport'>;

// Full-page output is always clipped to the viewport width and to MAX_FULL_PAGE_HEIGHT,
// so image dimensions are predictable. Pages taller than the limit are truncated and
// the result says so. Optional scrolling is handled by the loading stage.
export async function renderImage(page: CapturePage, { format, quality, fullPage, viewport }: RenderOptions, timeout: number): Promise<{ image: Buffer; output: ImageOutput }> {
  const base = { type: format, timeout, ...(quality === undefined ? {} : { quality }) } as const;
  const output: ImageOutput = { format, ...(quality === undefined ? {} : { quality }), fullPage, viewport, truncated: false };
  if (!fullPage) return { image: await page.screenshot(base), output };
  const pageHeight = await page.evaluate(() => Math.ceil(Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0)));
  const height = Math.max(viewport.height, Math.min(pageHeight, MAX_FULL_PAGE_HEIGHT));
  const image = await page.screenshot({ ...base, fullPage: true, clip: { x: 0, y: 0, width: viewport.width, height } });
  return { image, output: { ...output, pageHeight, truncated: pageHeight > height } };
}
