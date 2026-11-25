declare global {
  interface Window { accepts: number; }
}

const banner = '<div id="cookie-banner" role="dialog"><p>Cookie preferences</p><button onclick="document.cookie=\'optional=yes\'; localStorage.setItem(\'optional\',\'yes\'); window.accepts++">Accept optional cookies</button></div>';
const style = `<style>
body { margin:0; background:white; } main { min-height:2200px; background:#cdf; }
#cookie-banner { position:fixed; bottom:0; left:0; width:100%; height:120px; background:#f33; z-index:20; }
.modal { position:fixed; top:25%; left:25%; width:50%; height:40%; background:white; z-index:30; }
</style>`;
const setup = '<script>window.accepts=0; document.cookie="essential=yes"; localStorage.setItem("essential","yes");</script>';
const content = '<main><h1>Keep this page content</h1><p>A deterministic fixture.</p></main>';
const wrap = (body: string) => `<!doctype html><html><head><title>Cleanup fixture</title>${style}</head><body>${setup}${content}${body}</body></html>`;

// These selectors deliberately exercise existing upstream generic rules. They
// are test data, not extra production rules or examples of broad CMP coverage.
export const cases: Record<string, { html: string; expected: string }> = {
  banner: { html: wrap(banner), expected: 'hidden' },
  wrapper: { html: wrap('<div id="cookie-banner" style="position:static;height:0"><section role="dialog" style="position:fixed;bottom:0;width:100%;height:120px;background:red">Cookie preferences</section></div>'), expected: 'hidden-with-fixed-descendant' },
  delayed: { html: wrap(`<script>setTimeout(()=>document.body.insertAdjacentHTML('beforeend',${JSON.stringify(banner)}),3000)</script>`), expected: 'hidden-after-observation' },
  scroll: { html: wrap(`<script>addEventListener('scroll',()=>document.body.insertAdjacentHTML('beforeend',${JSON.stringify(banner)}),{once:true})</script>`), expected: 'hidden-after-scroll' },
  shadow: { html: wrap(`<div id="host"></div><script>document.querySelector('#host').attachShadow({mode:'open'}).innerHTML=${JSON.stringify(style + banner)}</script>`), expected: 'hidden-in-open-shadow' },
  closed: { html: wrap(`<div id="closed-cookie-host" style="position:fixed;bottom:0;width:100%;height:150px;z-index:50"></div><script>document.querySelector('#closed-cookie-host').attachShadow({mode:'closed'}).innerHTML=${JSON.stringify(style + banner)}</script>`), expected: 'residual-suspected' },
  locked: { html: wrap(`<style>body{overflow:hidden}#cookie-banner{inset:0;height:100%;background:rgba(0,0,0,.5)}</style>${banner}`), expected: 'hidden-but-scroll-lock-unknown' },
  navigation: { html: wrap('<nav style="position:sticky;top:0;height:80px">Ordinary navigation with cookie policy link</nav>'), expected: 'preserved' },
  map: { html: wrap('<section role="application" style="position:fixed;top:25%;left:25%;width:50%;height:50%;background:green">Interactive map</section>'), expected: 'preserved' },
  login: { html: wrap('<div id="cookie-banner" class="modal" role="dialog"><form>Sign in to continue<input type="password"></form></div>'), expected: 'guarded' },
  age: { html: wrap('<div id="cookie-banner" class="modal" role="dialog">Verify your age<input type="date"></div>'), expected: 'guarded' },
  main: { html: wrap('<script>document.querySelector("main").id="cookie-banner"</script>'), expected: 'guarded' },
  none: { html: wrap(''), expected: 'preserved' },
};

export function iframeFixture(origin: string, crossOrigin = false) {
  const source = crossOrigin ? origin.replace('127.0.0.1', 'localhost') : origin;
  return wrap(`<iframe id="cookie-frame" src="${source}/banner" style="position:fixed;bottom:0;width:100%;height:160px;border:0;z-index:50"></iframe>`);
}
