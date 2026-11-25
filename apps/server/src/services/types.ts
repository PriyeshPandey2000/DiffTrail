import type { BrowserContext, BrowserContextOptions, LaunchOptions, Page } from 'playwright';

export type CleanupCategory = 'cookies' | 'popups' | 'ads' | 'tracking' | 'social'
  | 'widgets' | 'appBanners' | 'otherAnnoyances';
export type CleanupCategories = Record<CleanupCategory, boolean>;
export interface CaptureRequest {
  url: string;
  cleanup?: 'none' | 'standard' | 'all' | (Partial<CleanupCategories> & { chat?: false });
  consent?: 'none';
  ai?: false;
}
export interface CaptureOptions {
  url: string;
  cleanup: CleanupCategories;
  consent: 'none';
  ai: false;
}
export interface Residual {
  state: 'not-checked' | 'none-detected' | 'suspected' | 'unknown' | 'blocked';
  signals: string[];
}

// Only the browser operations used by captures are required of injected workers.
export type CapturePage = Pick<Page, 'frames' | 'goto' | 'screenshot' | 'waitForTimeout'
  | 'setDefaultTimeout' | 'setDefaultNavigationTimeout'>;
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
  elapsedMs: number;
}
export interface CaptureResult {
  image: Buffer;
  cleanup: CleanupStatus;
  metadata: CaptureMetadata;
}
export interface CaptureService {
  (input: CaptureRequest): Promise<CaptureResult>;
  close(): Promise<void>;
}
export type CaptureHandler = ((input: CaptureRequest) => Promise<CaptureResult>) & { close?: () => Promise<void> };
