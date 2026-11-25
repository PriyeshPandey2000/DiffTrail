import { rulesets } from './config.js';

export async function configureCandidate(page, name, { ubolRulesets = rulesets } = {}) {
  if (name === 'ubol') {
    const state = await page.evaluate(async desired => {
      await chrome.runtime.sendMessage({ what: 'applyRulesets', enabledRulesets: desired });
      const level = await chrome.runtime.sendMessage({ what: 'setDefaultFilteringMode', level: 3 });
      return { version: chrome.runtime.getManifest().version, level, enabled: await chrome.declarativeNetRequest.getEnabledRulesets(), scripts: (await chrome.scripting.getRegisteredContentScripts()).length };
    }, ubolRulesets);
    if (state.level !== 3 || !ubolRulesets.every(id => state.enabled.includes(id)) || state.scripts === 0) throw new Error('uBOL readiness failed');
    return state;
  }
  if (name === 'ghostery') {
    await page.evaluate(async () => {
      const deadline = Date.now() + 45_000;
      while (Date.now() < deadline) {
        try { if (await chrome.runtime.sendMessage({ action: 'e2e:idle' }) === 'done') return; } catch {}
        await new Promise(resolve => setTimeout(resolve, 250));
      }
      throw new Error('Ghostery startup timed out');
    });
    const state = await page.evaluate(async () => {
      const { default: store } = await import(chrome.runtime.getURL('npm/hybrids/src/store.js'));
      const { default: Options } = await import(chrome.runtime.getURL('store/options.js'));
      const available = await (await fetch(chrome.runtime.getURL('background/rule_resources/distractions.json'))).json();
      const distractions = Object.fromEntries(Object.keys(available).map(key => [key, true]));
      await store.set(Options, {
        terms: true, onboarding: true, sync: false, feedback: false,
        blockAds: true, blockTrackers: true, blockAnnoyances: true, distractions,
        autoconsent: { autoAction: 'optOut', gpc: true },
      });
      await chrome.runtime.sendMessage({ action: 'e2e:idle' });
      const { options } = await chrome.storage.local.get('options');
      return { version: chrome.runtime.getManifest().version, options, enabled: await chrome.declarativeNetRequest.getEnabledRulesets(), scripts: (await chrome.scripting.getRegisteredContentScripts()).map(script => script.id) };
    });
    if (!state.options?.blockAnnoyances || state.options.autoconsent.autoAction !== 'optOut' || !['ads','tracking','annoyances'].every(id => state.enabled.includes(id))) throw new Error('Ghostery readiness failed');
    return state;
  }
  if (name === 'adguard') {
    await page.evaluate(async () => {
      const deadline = Date.now() + 45_000;
      while (Date.now() < deadline) {
        try { if (await chrome.runtime.sendMessage({ handlerName: 'app', type: 'getIsAppInitialized' }) === true) return; } catch {}
        await new Promise(resolve => setTimeout(resolve, 250));
      }
      throw new Error('AdGuard startup timed out');
    });
    const state = await page.evaluate(async () => {
      const send = (type, data = {}) => chrome.runtime.sendMessage({ handlerName: 'app', type, data });
      const desired = [2, 3, 4, 18, 19, 20, 21, 22];
      await send('setConsentedFilters', { filterIds: [18, 19, 20, 21, 22] });
      for (const groupId of [1, 2, 3, 4]) await send('enableFiltersGroup', { groupId });
      for (const filterId of desired) await send('addAndEnableFilter', { filterId });
      await send('disableFilter', { filterId: 10 });
      await send('changeUserSetting', { key: 'adguard-disabled', value: false });
      await send('changeUserSetting', { key: 'allow-anonymized-usage-data', value: false });
      const metadata = await send('getCategoriesFilters');
      const data = await send('getOptionsData');
      return { version: chrome.runtime.getManifest().version, desired,
        filters: metadata.filter(filter => filter.enabled).map(({ filterId, name, groupId, version, loaded }) => ({ filterId, name, groupId, version, loaded })),
        groups: data.filtersMetadata.groups, enabled: await chrome.declarativeNetRequest.getEnabledRulesets(),
        disabled: data.settings.values['adguard-disabled'], limits: data.runtimeInfo.areFilterLimitsExceeded,
        scripts: (await chrome.scripting.getRegisteredContentScripts()).map(script => script.id) };
    });
    if (state.disabled || state.limits || !state.desired.every(id => state.filters.some(filter => filter.filterId === id && filter.loaded))) throw new Error('AdGuard filters are not ready');
    return state;
  }
  throw new Error(`Unknown candidate: ${name}`);
}
