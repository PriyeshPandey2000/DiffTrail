import type { BrowserContextOptions } from 'playwright';
import type { CaptureOptions, CapturePage, EmulationMetadata, Viewport } from './types.ts';

import { devices } from 'playwright';

export const MAX_SCALE = 5;

// DiffTrail preset ids (named like other screenshot APIs) mapped to Playwright's
// device descriptors. Sizes, touch, and user agents come from the installed Playwright.
const PRESETS = {
  iphone_se: 'iPhone SE',
  iphone_13: 'iPhone 13',
  iphone_14_pro_max: 'iPhone 14 Pro Max',
  iphone_15: 'iPhone 15',
  iphone_15_pro_max: 'iPhone 15 Pro Max',
  iphone_16: 'iPhone 16',
  iphone_16_plus: 'iPhone 16 Plus',
  pixel_5: 'Pixel 5',
  galaxy_s8: 'Galaxy S8',
  'galaxy_s9+': 'Galaxy S9+',
  ipad_mini: 'iPad Mini',
  ipad_pro_11: 'iPad Pro 11',
  galaxy_tab_s4: 'Galaxy Tab S4',
} as const;

export interface DevicePreset {
  id: string;
  viewport: Viewport;
  // Native device pixel ratio. Captures use at most MAX_SCALE.
  deviceScale: number;
  mobile: boolean;
  touch: boolean;
  landscape: boolean;
  userAgent: string;
}

function buildDevices() {
  const result: Record<string, DevicePreset> = {};
  for (const [id, name] of Object.entries(PRESETS)) {
    for (const landscape of [false, true]) {
      const descriptor = devices[landscape ? `${name} landscape` : name];
      if (!descriptor) throw new Error(`Playwright has no device descriptor named "${name}${landscape ? ' landscape' : ''}".`);
      const key = landscape ? `${id}_landscape` : id;
      result[key] = Object.freeze({
        id: key, viewport: { ...descriptor.viewport }, deviceScale: descriptor.deviceScaleFactor,
        mobile: descriptor.isMobile, touch: descriptor.hasTouch, landscape, userAgent: descriptor.userAgent,
      });
    }
  }
  return Object.freeze(result);
}
export const DEVICES = buildDevices();

type EmulationOptions = Pick<CaptureOptions, 'viewport' | 'scale' | 'device' | 'userAgent' | 'locale' | 'timezone' | 'colorScheme' | 'reducedMotion' | 'media'>;

// The single owner of browser-context settings. Both the plain browser and the
// AdGuard persistent context are created from this, so they cannot drift apart.
export function contextOptions(options: EmulationOptions): BrowserContextOptions {
  const device = options.device === undefined ? undefined : DEVICES[options.device];
  return {
    viewport: { ...options.viewport },
    deviceScaleFactor: options.scale,
    ...(device ? { isMobile: device.mobile, hasTouch: device.touch, userAgent: device.userAgent } : {}),
    ...(options.userAgent === undefined ? {} : { userAgent: options.userAgent }),
    ...(options.locale === undefined ? {} : { locale: options.locale }),
    ...(options.timezone === undefined ? {} : { timezoneId: options.timezone }),
    ...(options.colorScheme === undefined ? {} : { colorScheme: options.colorScheme }),
    ...(options.reducedMotion ? { reducedMotion: 'reduce' as const } : {}),
  };
}

// Print media is a page-level setting in Playwright, so it is applied before navigation.
export async function emulatePage(page: CapturePage, options: EmulationOptions) {
  if (options.media === undefined) return;
  if (!page.emulateMedia) throw new Error('This page cannot emulate media.');
  await page.emulateMedia({ media: options.media });
}

// null means "not set": the browser or host default applies.
export function emulationMetadata(options: EmulationOptions): EmulationMetadata {
  const device = options.device === undefined ? undefined : DEVICES[options.device];
  return {
    device: options.device ?? null,
    ...(device ? { deviceScale: device.deviceScale } : {}),
    mobile: device?.mobile ?? false,
    touch: device?.touch ?? false,
    userAgent: options.userAgent ?? device?.userAgent ?? null,
    locale: options.locale ?? null,
    timezone: options.timezone ?? null,
    colorScheme: options.colorScheme ?? null,
    reducedMotion: options.reducedMotion === true,
    media: options.media ?? 'screen',
  };
}

export function listDevices() {
  return Object.values(DEVICES).map(({ id, viewport, deviceScale, mobile, touch, landscape, userAgent }) => ({
    id, viewport, deviceScale, scale: Math.min(deviceScale, MAX_SCALE), mobile, touch, landscape, userAgent,
  }));
}
