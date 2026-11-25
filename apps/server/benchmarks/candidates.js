import { resolve } from 'node:path';
import { extensionDirectory, extensionVersion, root } from './config.js';

export const candidates = {
  ubol: { name: 'uBlock Origin Lite', version: extensionVersion, directory: extensionDirectory, settings: 'dashboard.html' },
  ghostery: {
    name: 'Ghostery', version: '10.6.13', directory: resolve(root, '.cache/blockers/ghostery/extension'), settings: 'pages/settings/index.html',
    archive: 'ghostery-automation-chromium-10.6.13.zip',
    url: 'https://github.com/ghostery/ghostery-extension/releases/download/v10.6.13/ghostery-automation-chromium-10.6.13.zip',
    sha256: '238972b8799d84d271ea56dc8140189a51c23e336a959f3ee4f8dc97beb49951',
  },
  adguard: {
    name: 'AdGuard', version: '5.5.4.55', directory: resolve(root, '.cache/blockers/adguard/extension'), settings: 'pages/options.html',
    archive: 'chrome-mv3.zip',
    url: 'https://github.com/AdguardTeam/AdguardBrowserExtension/releases/download/v5.5.4/chrome-mv3.zip',
    sha256: '012263305d8fdd56281aa5c2149cd9de499ba7e0abf0f379d1cb7cf799e40bba',
  },
};
