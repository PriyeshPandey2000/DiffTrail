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
// Preserve the existing default; callers may explicitly request 1x.
export const SCALE = 2;
// Keep the former WebP-derived bound available to define the legacy area budget.
export const MAX_IMAGE_DIMENSION = 16_383;
export const MAX_FULL_PAGE_HEIGHT = Math.floor(MAX_IMAGE_DIMENSION / SCALE);

export const MAX_OUTPUT_PIXELS = VIEWPORT_LIMITS.width[1] * SCALE * MAX_FULL_PAGE_HEIGHT * SCALE;
// Measured JPEG encoder boundary in the bundled Chromium, below the format's nominal limit.
const MAX_FORMAT_SIDE = { png: Infinity, jpeg: 65_500, webp: MAX_IMAGE_DIMENSION };
type RenderOptions = Pick<CaptureOptions, 'format' | 'quality' | 'fullPage' | 'viewport' | 'scale' | 'maxHeight'>;

export function captureHeightLimit({ format, viewport, scale, maxHeight }: RenderOptions) {
  const limits = [
    { height: Math.floor(MAX_FORMAT_SIDE[format] / scale), reason: 'format-limit' as const },
    { height: Math.floor(MAX_OUTPUT_PIXELS / (viewport.width * scale * scale)), reason: 'pixel-budget' as const },
    ...(maxHeight === undefined ? [] : [{ height: maxHeight, reason: 'max-height' as const }]),
  ];
  return { height: Math.min(...limits.map(limit => limit.height)), limits };
}

// Full-page output is clipped to viewport width and the smallest applicable bound.
// Optional scrolling is handled by the loading stage; rendering reports any cutoff.
export async function renderImage(page: CapturePage, options: RenderOptions, timeout: number): Promise<{ image: Buffer; output: ImageOutput }> {
  const { format, quality, fullPage, viewport, scale, maxHeight } = options;
  const base = { type: format, timeout, ...(quality === undefined ? {} : { quality }) } as const;
  const output: ImageOutput = { format, ...(quality === undefined ? {} : { quality }), scale,
    ...(maxHeight === undefined ? {} : { maxHeight }), fullPage, viewport, truncated: false };
  if (!fullPage) return { image: await page.screenshot(base), output };
  const pageHeight = await page.evaluate(() => Math.ceil(Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0)));
  const naturalHeight = Math.max(viewport.height, pageHeight);
  const { height: limit, limits } = captureHeightLimit(options);
  const height = Math.min(naturalHeight, limit);
  const image = await page.screenshot({ ...base, fullPage: true, clip: { x: 0, y: 0, width: viewport.width, height } });
  const truncated = naturalHeight > height;
  return { image, output: { ...output, pageHeight, truncated,
    ...(truncated ? { truncationReasons: limits.filter(item => item.height === height).map(item => item.reason) } : {}) } };
}
