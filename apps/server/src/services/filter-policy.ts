import { CosmeticFilter, NetworkFilter } from '@ghostery/adblocker-playwright';

// Keep the website knowledge in upstream lists. This policy only limits actions.
export function selectRule(line: string, category: string): { rule: string; kind: 'cosmetic' | 'network'; reason?: never } | { reason: string; rule?: never; kind?: never } {
  line = line.trim();
  if (!line || line.startsWith('!') || line.startsWith('[')) return { reason: 'comment' };
  if (/#[@?$%]*#/.test(line)) {
    if (!/^[^#]*#@?#/.test(line)) return { reason: 'script-or-extended-syntax' };
    const filter = CosmeticFilter.parse(line);
    if (!filter) return { reason: 'unsupported' };
    if (filter.isScriptInject() || filter.isExtended() || filter.isHtmlFiltering()) return { reason: 'script-or-extended-syntax' };
    if (filter.hasCustomStyle()) return { reason: 'custom-style' };
    // A CSS selector cannot execute code. Browser-validity is checked at application time.
    return { rule: line, kind: 'cosmetic' };
  }
  if (category !== 'ads') return { reason: 'network-disabled' };
  const filter = NetworkFilter.parse(line);
  if (!filter) return { reason: 'unsupported' };
  if (filter.isCSP() || filter.isRedirect() || filter.isRedirectRule() || filter.isReplace()
    || filter.isRemoveParam() || filter.isHtmlFilteringRule()) return { reason: 'network-modifier' };
  return { rule: line, kind: 'network' };
}
