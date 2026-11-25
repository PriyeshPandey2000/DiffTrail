// Read-only benchmark observations, shared across full-extension runs.
export function observe() {
  const visible = element => {
    const style = getComputedStyle(element);
    const box = element.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) !== 0 && box.width > 0 && box.height > 0 && box.top < innerHeight && box.left < innerWidth && box.bottom > 0 && box.right > 0;
  };
  const elements = [];
  const visit = root => {
    for (const element of root.querySelectorAll('*')) {
      if (elements.length >= 10_000) return;
      elements.push(element);
      if (element.shadowRoot) visit(element.shadowRoot);
    }
  };
  if (document.body) visit(document.body);
  const overlays = [];
  for (const element of elements) {
    const style = getComputedStyle(element);
    const dialog = element.matches('dialog[open], [role="dialog"], [aria-modal="true"]');
    if (!dialog && !['fixed', 'sticky'].includes(style.position)) continue;
    if (!visible(element)) continue;
    const text = (element.innerText || '').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const box = element.getBoundingClientRect();
    const cookie = /cookie|consent|privacy preferences|tracking technologies/i.test(text) && /accept|reject|agree|preferences|manage|allow|use|settings/i.test(text);
    const popup = dialog || /subscribe|newsletter|sign up|special offer|notifications/i.test(text);
    overlays.push({ tag: element.tagName, id: element.id, role: element.getAttribute('role'), text: text.slice(0, 1000), cookie, popup, box: { x: box.x, y: box.y, width: box.width, height: box.height } });
    if (overlays.length >= 30) break;
  }
  return {
    time: Math.round(performance.now()), title: document.title,
    bodyCookieSignal: /cookie|consent/i.test(document.body?.innerText || ''),
    consentActions: elements.filter(element => element.matches('button, [role=button]') && visible(element) && /accept|reject|agree|manage cookies|necessary|no, thank|yes, i accept/i.test(element.innerText || '')).map(element => element.innerText.slice(0, 150)).slice(0, 12),
    iframes: [...document.querySelectorAll('iframe')].filter(visible).map(element => ({ src: element.src.slice(0, 300), box: { x: element.getBoundingClientRect().x, y: element.getBoundingClientRect().y, width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height } })).slice(0, 15),
    text: (document.body?.innerText || '').slice(0, 15_000),
    textLength: document.body?.innerText.length || 0,
    headings: [...document.querySelectorAll('h1,h2')].filter(visible).slice(0, 8).map(element => element.innerText),
    images: { total: document.images.length, loaded: [...document.images].filter(image => image.complete && image.naturalWidth > 0).length },
    scrollY, scrollHeight: document.documentElement.scrollHeight,
    overflow: { html: getComputedStyle(document.documentElement).overflowY, body: document.body ? getComputedStyle(document.body).overflowY : null },
    overlays,
  };
}
