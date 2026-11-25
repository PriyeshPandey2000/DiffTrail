import { resolve } from 'node:path';

export const root = resolve(import.meta.dirname, '../../..');
export const extensionVersion = '2026.1122.1948';
export const archiveSha256 = '7cd72ae78fe6fa007193de633d2dec085a0da50f53283e821918a77978d105fb';
export const extensionDirectory = resolve(root, '.cache/ubol', extensionVersion, 'extension');
export const rulesets = [
  'ublock-filters', 'easylist', 'easyprivacy', 'pgl', 'ublock-badware', 'urlhaus-full',
  'annoyances-cookies', 'annoyances-overlays', 'annoyances-widgets', 'annoyances-others',
];
