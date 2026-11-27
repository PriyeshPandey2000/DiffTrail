import type { CaptureOptions, CleanupCategories, CleanupCategory, Viewport, WaitUntil, ResolvedScroll, Clip, ColorScheme, MediaType } from './types.ts';
import type { DevicePreset } from './emulation.ts';

import { DEFAULT_FORMAT, DEFAULT_QUALITY, DEFAULT_VIEWPORT, OUTPUT_FORMATS, VIEWPORT_LIMITS, SCALE, MAX_FORMAT_SIDE, MAX_OUTPUT_PIXELS } from './output.ts';
import { DEVICES, MAX_SCALE } from './emulation.ts';

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
  if (Object.keys(options).some(key => !['url', 'cleanup', 'consent', 'ai', 'format', 'quality', 'fullPage', 'viewport', 'waitUntil', 'delay', 'waitForSelector', 'timeout', 'scroll', 'scale', 'maxHeight', 'selector', 'clip', ...EMULATION_KEYS].includes(key))) {
    invalid(`Unknown option. Supported options: url, cleanup, consent, ai, format, quality, fullPage, viewport, waitUntil, delay, waitForSelector, timeout, scroll, scale, maxHeight, selector, clip, ${EMULATION_KEYS.join(', ')}.`);
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
  const { emulation, device } = normalizeEmulation(options, invalid);
  const output = normalizeOutput(options, invalid, device);
  return { url: target.href, cleanup: categories, consent: 'none', ai: false, ...output, ...emulation, ...normalizeLoading(options, invalid, output.viewport), ...normalizeTarget(options, invalid) };
}

function normalizeTarget(options: Record<string, unknown>, invalid: (message: string) => never): Pick<CaptureOptions, 'selector' | 'clip'> {
  const { selector, clip } = options;
  if (selector !== undefined && (typeof selector !== 'string' || !selector.trim() || selector.length > 1000)) invalid('selector must be a non-empty CSS selector of at most 1000 characters.');
  if ((selector !== undefined && clip !== undefined) || ((selector !== undefined || clip !== undefined) && options.fullPage === true)) invalid('selector, clip, and fullPage:true are mutually exclusive.');
  if (clip !== undefined) {
    if (!clip || typeof clip !== 'object' || Array.isArray(clip) || Object.keys(clip).some(key => !['x', 'y', 'width', 'height'].includes(key))) invalid('clip requires x, y, width, and height in document CSS pixels.');
    for (const key of ['x', 'y', 'width', 'height'] as const) {
      const value = (clip as Record<string, unknown>)[key];
      const min = key === 'x' || key === 'y' ? 0 : 1;
      if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > 100_000) invalid(`clip.${key} must be an integer from ${min} to 100000 CSS pixels.`);
    }
  }
  return { ...(selector === undefined ? {} : { selector: selector as string }), ...(clip === undefined ? {} : { clip: { ...clip as Clip } }) };
}

function normalizeOutput(options: Record<string, unknown>, invalid: (message: string) => never, device: DevicePreset | undefined) {
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
  // A device preset supplies the starting viewport; explicit fields override it.
  const viewport: Viewport = { ...(device?.viewport ?? DEFAULT_VIEWPORT) };
  for (const key of ['width', 'height'] as const) {
    const value = (input as Record<string, unknown>)[key];
    if (value === undefined) continue;
    const [min, max] = VIEWPORT_LIMITS[key];
    if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) invalid(`viewport.${key} must be an integer from ${min} to ${max}.`);
    viewport[key] = value as number;
  }
  const scale = options.scale === undefined ? (device ? Math.min(device.deviceScale, MAX_SCALE) : SCALE) : options.scale;
  if (typeof scale !== 'number' || !Number.isFinite(scale) || scale < 1 || scale > MAX_SCALE) invalid(`scale must be a number from 1 to ${MAX_SCALE}.`);
  // Viewport and full-page images are viewport.width × scale wide; viewport images are also
  // viewport.height × scale tall. Element and clip sizes are checked against the target instead.
  if (options.selector === undefined && options.clip === undefined) {
    const width = Math.ceil(viewport.width * (scale as number));
    const height = options.fullPage === true ? 1 : Math.ceil(viewport.height * (scale as number));
    if (width > MAX_FORMAT_SIDE[format] || height > MAX_FORMAT_SIDE[format] || width * height > MAX_OUTPUT_PIXELS) {
      invalid(`viewport × scale gives a ${width}×${height} image, over the ${format} side limit or the ${MAX_OUTPUT_PIXELS}-pixel budget. Use a smaller viewport or scale.`);
    }
  }
  const maxHeight = options.maxHeight;
  if (maxHeight !== undefined && (options.fullPage !== true || typeof maxHeight !== 'number' || !Number.isInteger(maxHeight) || maxHeight < 1 || maxHeight > 100_000)) invalid('maxHeight requires fullPage:true and must be an integer from 1 to 100000 CSS pixels.');
  return { scale: scale as number, ...(maxHeight === undefined ? {} : { maxHeight: maxHeight as number }), format, ...(quality === undefined ? {} : { quality }), fullPage: options.fullPage === true, viewport };
}

function normalizeLoading(options: Record<string, unknown>, invalid: (message: string) => never, viewport: Viewport): Pick<CaptureOptions, 'waitUntil' | 'delay' | 'timeout' | 'waitForSelector' | 'scroll'> {
  const integer = (value: unknown, fallback: number, min: number, max: number, name: string): number => {
    if (value === undefined) return fallback;
    if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) invalid(`${name} must be an integer from ${min} to ${max}.`);
    return value as number;
  };
  const waitUntil = options.waitUntil === undefined ? 'load' : options.waitUntil;
  if (!['load', 'domcontentloaded', 'networkidle'].includes(waitUntil as string)) invalid('waitUntil must be "load", "domcontentloaded", or "networkidle".');
  const delay = integer(options.delay, 0, 0, 10_000, 'delay');
  const timeout = options.timeout === undefined ? undefined : integer(options.timeout, 30_000, 1000, 90_000, 'timeout');
  const selector = options.waitForSelector;
  if (selector !== undefined && (typeof selector !== 'string' || !selector.trim() || selector.length > 1000)) invalid('waitForSelector must be a non-empty CSS selector of at most 1000 characters.');
  let scroll: false | ResolvedScroll = false;
  if (options.scroll !== false && (options.scroll !== undefined || options.fullPage === true)) {
    const value = options.scroll === true || options.scroll === undefined ? {} : options.scroll;
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['step', 'delay', 'maxSteps'].includes(key))) invalid('scroll must be a boolean or an object with step, delay, and maxSteps.');
    const config = value as Record<string, unknown>;
    scroll = { step: integer(config.step, Math.min(800, Math.floor(viewport.height * 0.8)), 100, 2000, 'scroll.step'), delay: integer(config.delay, 200, 0, 1000, 'scroll.delay'), maxSteps: integer(config.maxSteps, 30, 1, 100, 'scroll.maxSteps') };
  }
  return { waitUntil: waitUntil as WaitUntil, delay, ...(timeout === undefined ? {} : { timeout }), ...(selector === undefined ? {} : { waitForSelector: selector as string }), scroll };
}

const EMULATION_KEYS = ['device', 'userAgent', 'locale', 'timezone', 'colorScheme', 'reducedMotion', 'media'];

// Unset options are not passed to the browser, so it keeps the host's own locale and time zone.
function normalizeEmulation(options: Record<string, unknown>, invalid: (message: string) => never) {
  const { device: id, userAgent, locale, timezone, colorScheme, reducedMotion, media } = options;
  let device: DevicePreset | undefined;
  if (id !== undefined) {
    if (typeof id !== 'string' || !Object.hasOwn(DEVICES, id)) invalid('device must be a preset id. GET /api/devices lists them.');
    device = DEVICES[id];
  }
  if (userAgent !== undefined && (typeof userAgent !== 'string' || !/^[\x20-\x7e]{1,512}$/.test(userAgent) || !userAgent.trim())) invalid('userAgent must be 1 to 512 printable ASCII characters.');
  let canonicalLocale: string | undefined;
  if (locale !== undefined) {
    if (typeof locale !== 'string' || locale.length > 35) invalid('locale must be a language tag such as "en-US" or "de-DE".');
    try { [canonicalLocale] = Intl.getCanonicalLocales(locale); } catch { /* handled below */ }
    if (!canonicalLocale) invalid('locale must be a language tag such as "en-US" or "de-DE".');
  }
  if (timezone !== undefined) {
    let valid = typeof timezone === 'string' && /^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+){0,2}$/.test(timezone);
    if (valid) { try { new Intl.DateTimeFormat('en-US', { timeZone: timezone as string }); } catch { valid = false; } }
    if (!valid) invalid('timezone must be an IANA time zone such as "Europe/Berlin" or "UTC".');
  }
  if (colorScheme !== undefined && colorScheme !== 'light' && colorScheme !== 'dark') invalid('colorScheme must be "light" or "dark".');
  if (reducedMotion !== undefined && typeof reducedMotion !== 'boolean') invalid('reducedMotion must be true or false.');
  if (media !== undefined && media !== 'screen' && media !== 'print') invalid('media must be "screen" or "print".');
  const emulation: Pick<CaptureOptions, 'device' | 'userAgent' | 'locale' | 'timezone' | 'colorScheme' | 'reducedMotion' | 'media'> = {
    ...(device ? { device: device.id } : {}),
    ...(userAgent === undefined ? {} : { userAgent: userAgent as string }),
    ...(canonicalLocale === undefined ? {} : { locale: canonicalLocale }),
    ...(timezone === undefined ? {} : { timezone: timezone as string }),
    ...(colorScheme === undefined ? {} : { colorScheme: colorScheme as ColorScheme }),
    ...(reducedMotion === true ? { reducedMotion: true as const } : {}),
    ...(media === undefined ? {} : { media: media as MediaType }),
  };
  return { emulation, device };
}
