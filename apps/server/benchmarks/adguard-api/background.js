// Adapter for AdGuard's official MV3 example; no demonstration/custom rules.
// SPDX-License-Identifier: GPL-3.0-only
// Upstream: AdguardTeam/tsurlfilter/packages/examples/adguard-api-mv3.
import browser from 'webextension-polyfill';
import { AdguardApi, MESSAGE_HANDLER_NAME } from '@adguard/api-mv3';
import { localScriptRules } from './local-script-rules.js';

export const fullFilters = [2, 3, 4, 17, 18, 19, 20, 21, 22, 25];
let api, handler, current, failure;
const created = (async () => {
  try {
    api = await AdguardApi.create({ localScriptRulesJs: localScriptRules });
    handler = api.getMessageHandler();
  } catch (error) { failure = String(error?.stack || error); }
})();
async function configure(filters) {
  await created;
  if (failure) throw new Error(failure);
  const configuration = { filters, filteringEnabled: true, assetsPath: 'filters', rules: [], allowlist: [] };
  current = current ? await api.configure(configuration) : await api.start(configuration);
  return current;
}
const started = (async () => {
  await created;
  if (typeof DIFFTRAIL_LAZY_START !== 'undefined' && DIFFTRAIL_LAZY_START) return;
  try {
    const { selectedFilters = fullFilters } = await browser.storage.local.get('selectedFilters');
    await configure(selectedFilters);
  } catch (error) { failure = String(error?.stack || error); }
})();
browser.runtime.onMessage.addListener(async (message, sender) => {
  if (message?.handlerName === MESSAGE_HANDLER_NAME) {
    await started;
    if (failure) throw new Error(failure);
    return handler(message, sender);
  }
  if (!sender.url?.startsWith(browser.runtime.getURL(''))) return undefined;
  if (message?.type === 'difftrail:status') {
    await started;
    return { ready: !failure && Boolean(current), error: failure, version: browser.runtime.getManifest().version,
      configuration: current, rulesCount: api?.getRulesCount(), enabled: await browser.declarativeNetRequest.getEnabledRulesets() };
  }
  if (message?.type === 'difftrail:configure') {
    await started;
    if (failure) throw new Error(failure);
    const filters = message.filters;
    if (!Array.isArray(filters) || filters.some(id => !fullFilters.includes(id))) throw new Error('Unknown filter ID');
    await configure(filters);
    await browser.storage.local.set({ selectedFilters: filters });
    return { ready: true, configuration: current, rulesCount: api.getRulesCount(), enabled: await browser.declarativeNetRequest.getEnabledRulesets() };
  }
  return undefined;
});
