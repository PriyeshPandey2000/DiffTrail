import type { BrowserContext, BrowserContextOptions, LaunchOptions, Page } from 'playwright';
import type { OutputFormat } from './output.ts';

export type CleanupCategory = 'cookies' | 'popups' | 'ads' | 'tracking' | 'social'
  | 'widgets' | 'appBanners' | 'otherAnnoyances';
export type CleanupCategories = Record<CleanupCategory, boolean>;
export interface Viewport { width: number; height: number }
export interface Clip { x: number; y: number; width: number; height: number }
export type WaitUntil = 'load' | 'domcontentloaded' | 'networkidle';
export interface ScrollOptions { step?: number; delay?: number; maxSteps?: number }
export interface ResolvedScroll { step: number; delay: number; maxSteps: number }
export interface ImageReadiness {
  state: 'ready' | 'incomplete' | 'unknown';
  loaded: number;
  failed: number;
  pending: number;
  untriggered: number;
  elapsedMs: number;
}
export interface LoadingMetadata {
  images?: ImageReadiness;
  waitUntil: WaitUntil;
  delay: number;
  timeout: number;
  selector: 'not-requested' | 'matched';
  scroll: { status: 'not-requested' | 'completed' | 'limited' | 'blocked'; steps: number };
}
export interface CaptureRequest {
  selector?: string;
  clip?: Clip;
  waitUntil?: WaitUntil;
  delay?: number;
  waitForSelector?: string;
  timeout?: number;
  scroll?: boolean | ScrollOptions;
  url: string;
  cleanup?: 'none' | 'standard' | 'all' | (Partial<CleanupCategories> & { chat?: false });
  consent?: 'none';
  ai?: false;
  format?: OutputFormat | 'jpg';
  quality?: number;
  scale?: 1 | 2;
  maxHeight?: number;
  fullPage?: boolean;
  viewport?: Partial<Viewport>;
}
// Fully resolved request. It is also a valid CaptureRequest, so normalizing it again is a no-op.
export interface CaptureOptions {
  selector?: string;
  clip?: Clip;
  waitUntil: WaitUntil;
  delay: number;
  waitForSelector?: string;
  timeout?: number;
  scroll: false | ResolvedScroll;
  url: string;
  cleanup: CleanupCategories;
  consent: 'none';
  ai: false;
  format: OutputFormat;
  quality?: number;
  scale: 1 | 2;
  maxHeight?: number;
  fullPage: boolean;
  viewport: Viewport;
}
export interface ImageOutput {
  target?: { mode: 'selector' | 'clip'; bounds: Clip };
  format: OutputFormat;
  quality?: number;
  scale: 1 | 2;
  maxHeight?: number;
  fullPage: boolean;
  viewport: Viewport;
  // CSS px height of the page; only measured for full-page captures.
  pageHeight?: number;
  truncated: boolean;
  truncationReasons?: ('max-height' | 'format-limit' | 'pixel-budget')[];
}
export interface Residual {
  state: 'not-checked' | 'none-detected' | 'suspected' | 'unknown' | 'blocked';
  signals: string[];
}

// Only the browser operations used by captures are required of injected workers.
export type CapturePage = Pick<Page, 'frames' | 'goto' | 'screenshot' | 'evaluate' | 'waitForTimeout' | 'locator'
  | 'setDefaultTimeout' | 'setDefaultNavigationTimeout'> & {
  waitForSelector(selector: string, options: { state: 'visible'; timeout: number }): Promise<unknown>;
};
export interface CaptureContext {
  newPage(): Promise<CapturePage>;
  close(): Promise<void>;
  route?: BrowserContext['route'];
}
export interface CaptureBrowser {
  newContext(options: BrowserContextOptions): Promise<CaptureContext>;
  close(): Promise<void>;
  isConnected?(): boolean;
  on?(event: 'disconnected', listener: () => void): unknown;
}
export interface BrowserLauncher {
  launch(options: LaunchOptions): Promise<CaptureBrowser>;
}
export interface AdguardMetadata {
  engine: 'adguard-api-mv3';
  package: string;
  referenceVersion: string;
  rulesVersion: string;
  filters: number[];
  rulesCount: number;
  setupMs: number;
}
export interface AdguardWorker<Context extends CaptureContext = CaptureContext> {
  context: Context;
  close(): Promise<void>;
  metadata: AdguardMetadata;
}
export type CleanupStatus = 'skipped' | 'enabled' | 'partial' | 'failed' | 'applied' | 'unchanged';
export interface CaptureMetadata {
  status: CleanupStatus;
  categories: CleanupCategories;
  engine: 'adguard-api-mv3' | 'ghostery-cosmetic-experiment' | 'none';
  rulesVersion: string | null;
  hidden: number | null;
  guarded: number | null;
  invalid: number;
  framesSkipped: number;
  blockedRequests: number | null;
  networkErrors: number;
  transientFrameErrors: number;
  residual: Residual;
  consent: 'none';
  aiUsed: false;
  filtering?: AdguardMetadata;
  cookieRulesMayInteract?: boolean;
  output: ImageOutput;
  loading: LoadingMetadata;
  elapsedMs: number;
}
export interface CaptureResult {
  image: Buffer;
  contentType: string;
  cleanup: CleanupStatus;
  metadata: CaptureMetadata;
}
export interface CaptureService {
  (input: CaptureRequest): Promise<CaptureResult>;
  close(): Promise<void>;
}
export type CaptureHandler = ((input: CaptureRequest) => Promise<CaptureResult>) & { close?: () => Promise<void> };
