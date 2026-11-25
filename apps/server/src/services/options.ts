import type { CaptureOptions, CleanupCategories, CleanupCategory, Viewport } from './types.ts';

import { DEFAULT_FORMAT, DEFAULT_QUALITY, DEFAULT_VIEWPORT, OUTPUT_FORMATS, VIEWPORT_LIMITS } from './output.ts';

export class CaptureError extends Error {
  declare code: string;
  declare status: number;
  declare details: Record<string, unknown> | undefined;
  constructor(code: string, message: string, status: number, details?: Record<string, unknown>) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function normalizeOptions(input: unknown): CaptureOptions {
  function invalid(message: string): never { throw new CaptureError('INVALID_OPTIONS', message, 400); }
  if (!input || typeof input !== 'object' || Array.isArray(input)) invalid('Provide a JSON object.');
  const options = input as Record<string, unknown>;
  if (Object.hasOwn(options, 'clean')) invalid('clean was replaced. Use cleanup:"standard" or cleanup:"none". No AI is called.');
  if (Object.keys(options).some(key => !['url', 'cleanup', 'consent', 'ai', 'format', 'quality', 'fullPage', 'viewport'].includes(key))) {
    invalid('Unknown option. Supported options: url, cleanup, consent, ai, format, quality, fullPage, viewport.');
  }
  let target;
  try { target = new URL(typeof options.url === 'string' ? options.url : ''); } catch { /* handled below */ }
  if (typeof options.url !== 'string' || !target || !['http:', 'https:'].includes(target.protocol) || target.username || target.password) {
    throw new CaptureError('INVALID_URL', 'Provide an absolute HTTP or HTTPS URL without credentials.', 400);
  }
  const categories: CleanupCategories = { cookies: false, popups: false, ads: false, tracking: false, social: false, widgets: false, appBanners: false, otherAnnoyances: false };
  const cleanup = options.cleanup ?? 'none';
  if (options.cleanup === null) invalid('cleanup must be "none", "standard", "all", or an object of boolean categories.');
  if (cleanup === 'standard') Object.assign(categories, { cookies: true, popups: true });
  else if (cleanup === 'all') { for (const key of Object.keys(categories)) categories[key as CleanupCategory] = true; }
  else if (cleanup !== 'none') {
    if (typeof cleanup !== 'object' || !cleanup || Array.isArray(cleanup)) invalid('cleanup must be "none", "standard", "all", or an object of boolean categories.');
    for (const [key, value] of Object.entries(cleanup)) {
      if (key === 'chat' && value === false) continue;
      if (!Object.hasOwn(categories, key) || typeof value !== 'boolean') invalid('Cleanup categories must be cookies, popups, ads, tracking, social, widgets, appBanners, or otherAnnoyances with boolean values.');
      categories[key as CleanupCategory] = value;
    }
  }
  if (options.consent !== undefined && options.consent !== 'none') invalid('Only consent:"none" is available: no additional consent-rejection automation. Upstream cookie rules can interact with banners.');
  if (options.ai !== undefined && options.ai !== false) invalid('Only ai:false is available in this iteration. Cleanup uses maintained rules without AI.');
  return { url: target.href, cleanup: categories, consent: 'none', ai: false, ...normalizeOutput(options, invalid) };
}

function normalizeOutput(options: Record<string, unknown>, invalid: (message: string) => never) {
  const requested = options.format === undefined ? DEFAULT_FORMAT : options.format === 'jpg' ? 'jpeg' : options.format;
  if (typeof requested !== 'string' || !Object.hasOwn(OUTPUT_FORMATS, requested)) invalid('format must be "png", "jpeg" (or "jpg"), or "webp".');
  const format = requested as keyof typeof OUTPUT_FORMATS;
  let quality: number | undefined;
  if (options.quality !== undefined) {
    if (!OUTPUT_FORMATS[format].lossy) invalid('quality applies only to jpeg and webp.');
    if (!Number.isInteger(options.quality) || (options.quality as number) < 1 || (options.quality as number) > 100) invalid('quality must be an integer from 1 to 100.');
    quality = options.quality as number;
  } else if (OUTPUT_FORMATS[format].lossy) quality = DEFAULT_QUALITY;
  if (options.fullPage !== undefined && typeof options.fullPage !== 'boolean') invalid('fullPage must be true or false.');
  const input = options.viewport === undefined ? {} : options.viewport;
  if (typeof input !== 'object' || input === null || Array.isArray(input) || Object.keys(input).some(key => key !== 'width' && key !== 'height')) {
    invalid('viewport must be an object with optional integer width and height.');
  }
  const viewport: Viewport = { ...DEFAULT_VIEWPORT };
  for (const key of ['width', 'height'] as const) {
    const value = (input as Record<string, unknown>)[key];
    if (value === undefined) continue;
    const [min, max] = VIEWPORT_LIMITS[key];
    if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) invalid(`viewport.${key} must be an integer from ${min} to ${max}.`);
    viewport[key] = value as number;
  }
  return { format, ...(quality === undefined ? {} : { quality }), fullPage: options.fullPage === true, viewport };
}
