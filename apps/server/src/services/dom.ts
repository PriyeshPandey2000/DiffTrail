import type { Residual } from './types.ts';

// Runs in a document. The rule engine supplies selectors; this code supplies
// geometry checks and a generic content guard, never website-specific rules.
export function inspectDOM(options: { selectors?: string[]; apply?: boolean } | void = {}) {
  const { selectors = [], apply = false } = options || {};
  const roots: (Document | ShadowRoot)[] = [document];
  const elements: Element[] = [];
  for (let index = 0; index < roots.length && elements.length < 20_000; index++) {
    for (const element of roots[index].querySelectorAll('*')) {
      elements.push(element);
      if (element.shadowRoot) roots.push(element.shadowRoot);
      if (elements.length === 20_000) break;
    }
  }
  const visible = (element: Element) => {
    const box = element.getBoundingClientRect();
    return box.width > 0 && box.height > 0 && box.bottom > 0 && box.right > 0
      && box.top < innerHeight && box.left < innerWidth
      && element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
  };
  const parent = (element: Element): Element | null => {
    const root = element.getRootNode();
    return element.parentElement || (root instanceof ShadowRoot ? root.host : null);
  };
  const textLength = Math.max(1, document.body?.textContent?.length || 0);
  const protectedElement = (element: Element) => {
    if (['HTML', 'BODY', 'MAIN', 'ARTICLE', 'NAV', 'HEADER', 'FOOTER'].includes(element.tagName)) return true;
    if (element.querySelector('main,article,nav,[role="main"],input[type="password"],input[autocomplete^="cc-"]')) return true;
    if (element.matches('[role="main"],[role="navigation"],[role="application"],input[type="password"],input[autocomplete^="cc-"]')) return true;
    for (let ancestor = parent(element); ancestor; ancestor = parent(ancestor)) {
      if (ancestor.matches('main,article,nav,[role="main"],[role="navigation"]')) return true;
    }
    const text = element.textContent || '';
    if (text.length > 500 && text.length / textLength > 0.65) return true;
    // Safety checks only: these expressions never select elements to hide.
    if (/verify your age|date of birth|age verification|sign in to continue|log in to continue|subscribe to (read|continue)|consent or pay/i.test(text.slice(0, 3000))) return true;
    return false;
  };
  let hidden = 0;
  let guarded = 0;
  let invalid = 0;
  if (apply) {
    for (const selector of selectors) {
      for (const root of roots) {
        let matches;
        try { matches = root.querySelectorAll(selector); } catch { invalid++; break; }
        for (const element of matches) {
          // CMP wrappers often have zero height while their fixed descendants
          // cover the viewport. The upstream selector still targets the wrapper.
          const visibleTargets = visible(element) ? [element]
            : Array.from(element.querySelectorAll('*')).slice(0, 1000).filter(visible);
          if (!visibleTargets.length) continue;
          if (protectedElement(element)) { guarded++; continue; }
          (element as HTMLElement | SVGElement).style.setProperty('display', 'none', 'important');
          if (visibleTargets.every(target => !visible(target))) hidden++;
        }
      }
    }
  }
  const features: Record<'classes' | 'ids' | 'hrefs', string[]> = { classes: [], ids: [], hrefs: [] };
  for (const element of elements) {
    features.classes.push(...element.classList);
    if (element.id) features.ids.push(element.id);
    const href = element.getAttribute('href');
    if (href !== null) features.hrefs.push(href);
  }
  for (const key of Object.keys(features) as (keyof typeof features)[]) features[key] = [...new Set(features[key])];
  const scrollLocked = [document.documentElement, document.body].some(element => element
    && (['hidden', 'clip'].includes(getComputedStyle(element).overflowY) || getComputedStyle(element).position === 'fixed'))
    && Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight || 0) > innerHeight;
  const hits = new Map<Element, { count: number; center: boolean }>();
  for (let row = 0; row < 9; row++) for (let col = 0; col < 9; col++) {
    const top = document.elementFromPoint(innerWidth * (col + 0.5) / 9, innerHeight * (row + 0.5) / 9);
    for (let element = top; element && element !== document.documentElement; element = parent(element)) {
      const style = getComputedStyle(element);
      if (['fixed', 'sticky'].includes(style.position) || element.matches('dialog[open],[aria-modal="true"]')) {
        const hit = hits.get(element) || { count: 0, center: false };
        hit.count++;
        hit.center ||= row === 4 && col === 4;
        hits.set(element, hit);
      }
    }
  }
  const candidates = [];
  for (const [element, hit] of hits) {
    if (!visible(element)) continue;
    const style = getComputedStyle(element);
    const box = element.getBoundingClientRect();
    const ratio = Math.min(box.width, innerWidth) * Math.min(box.height, innerHeight) / (innerWidth * innerHeight);
    const dialog = element.matches('dialog[open],[role="dialog"],[aria-modal="true"]');
    const signature = `${element.id} ${element.className} ${element.getAttribute('src') || ''}`;
    const cmp = /cookie|consent|onetrust|cybot|sp_message|didomi|usercentrics|trustarc/i.test(signature);
    const alpha = style.backgroundColor.match(/rgba\([^)]*,\s*([\d.]+)\)$/)?.[1];
    const backdrop = ratio > 0.5 && (style.backdropFilter !== 'none'
      || (alpha !== undefined && Number(alpha) > 0 && Number(alpha) < 1));
    const reasons = [];
    if (dialog) reasons.push('dialog');
    if (cmp) reasons.push('cmp-signature');
    if (backdrop) reasons.push('backdrop');
    if (scrollLocked) reasons.push('scroll-lock');
    if (!((hit.center && (dialog || cmp || backdrop || scrollLocked)) || (cmp && hit.count >= 3) || (dialog && hit.count >= 3))) continue;
    const protectedTarget = protectedElement(element);
    candidates.push({ id: `overlay-${candidates.length + 1}`, element, reasons, ratio,
      text: (element.textContent || '').slice(0, 500), protected: protectedTarget,
    });
  }
  const title = document.title || '';
  const blocked = /just a moment|attention required|access denied|verify you are human|security check|captcha/i.test(title);
  const signals = [...new Set(candidates.flatMap(candidate => candidate.reasons))];
  if (scrollLocked) signals.push('scroll-lock');
  if (elements.length >= 20_000) signals.push('scan-limit');
  const residual: Residual['state'] = blocked ? 'blocked' : candidates.length ? 'suspected'
    : signals.length ? 'unknown' : 'none-detected';
  return { features, hidden, guarded, invalid, residual, signals,
    candidates: candidates.map(({ element, ...candidate }) => candidate) };
}
