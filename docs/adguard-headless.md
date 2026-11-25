# Headless AdGuard integration — 25 November 2026

## Decision

Use **AdGuard’s official MV3 API**, adapted from its example, in Playwright’s bundled headless Chromium. Keep the complete pinned AdGuard extension as the reference benchmark. The restricted Ghostery cosmetic adapter is retained for experiments and regressions; it is no longer the screenshot endpoint’s default.

The consumer extension and official API are distinct integrations. The latter reproduced the reviewed recurring-UI outcomes in this sample while avoiding the consumer extension’s settings adapter. No DiffTrail website-specific rules, AI calls or additional consent-rejection automation were used.

## Matched experiment

Evidence: `artifacts/adguard-headless/2026-11-25T04-34-33.346Z/`.

- 17 previously reachable live sites, three modes each: baseline, pinned consumer extension, official API. All 51 visits returned usable HTTP responses; there were no setup failures. Booking returned 202 in some visits while rendering its real page.
- Actual headless Chromium 159.0.8154.6, Playwright 1.65.1, macOS ARM64, 1280×800 desktop, en-GB, Europe/London timezone, one host network/IP. Two concurrent workers, fresh persistent profiles, candidate order reversed on alternating sites.
- Pinned AdGuard 5.5.4.55 / release v5.5.4, archive SHA-256 `012263305d8fdd56281aa5c2149cd9de499ba7e0abf0f379d1cb7cf799e40bba`.
- `@adguard/api-mv3@3.0.0` with lockfile-resolved dependencies. Its generated extension uses the consumer archive’s exact compiled filter, redirect and local-script assets. Both enabled filters **2, 3, 4, 17, 18, 19, 20, 21, 22, 25**. The runtime does not use our earlier reduced filter snapshots.
- Observations at nominal 1, 3, 8 and 15 seconds; screenshots at 3 and 15 seconds, then scroll 650 px and wait five more seconds. Delayed navigation can shift early observations. Cleanup was reviewed visually at 15 seconds and after scrolling, with frame/scroll observations checked. No pixel-equality or numeric collateral-damage rate is claimed.

Both filtering integrations removed six of the seven observed cookie/privacy notices: OneTrust, TrustArc, Guardian, IKEA, Samsung and The Verge. Cookiebot’s own homepage retained its dialog. Both removed Booking’s Genius promotion but retained Independent’s membership modal. Both removed Microsoft’s chat solicitation but retained the Usercentrics Ask AI and Samsung WhatsApp launchers.

Guardian and Booking reached scrollY 650 after filtering, compared with 0 in their baselines. BBC, CNN, Wired and TechRadar had changed ad regions/layouts under both presets. Wikipedia’s Wiki Loves Food notice was removed by both; it is not counted as a scored obstructing dialog. GitHub was a control. Dynamic hero/ad content can differ between visits independently of filtering.

The corpus was Cookiebot, OneTrust, Usercentrics, TrustArc, BBC, Guardian, CNN, IKEA, Samsung, Microsoft, Booking, Wikipedia, GitHub, The Verge, Wired, Independent and TechRadar. Three prior access-restricted sites were not reintroduced or counted as successes.

## Resource measurements and worker choice

For the 17 visits per mode, median cold readiness including configuration was **0.352 s baseline, 23.580 s consumer extension, 3.176 s official API**. Median of each capture’s sampled peak process RSS sum was **1157 MiB baseline, 2244 MiB consumer extension, 1998 MiB official API**. Median ready-state RSS sums were approximately 600, 1862 and 1532 MiB respectively.

These are integration measurements, not intrinsic engine speed. The consumer adapter enables settings/filters sequentially; the official API initializes its selected set in one public call. They are one exploratory run, with differing websites, browser caches and some concurrent development activity. Repeated controlled load tests are still needed for capacity planning.

Memory is sampled every 500 ms after CDP connection by summing RSS for Chromium-reported process IDs. Shared pages can be counted more than once. These figures are **not private memory, proportional memory, kernel peak or exact VPS RAM requirements**. Every live visit deliberately includes about 20 seconds of observation; that wait is not the API’s production latency.

The default API therefore starts **one fresh cleanup worker on demand**, closes it after the capture and retains no idle AdGuard pool. It permits one active request by default. This avoids paying for idle browsers and avoids passing website or extension-profile state between callers. Prewarming/reusing workers is deferred until measured traffic and isolation requirements justify it. Raw captures retain a reusable browser with fresh contexts.

## API integration

`npm run setup:adguard` installs Chromium, verifies/extracts the pinned archive and builds a small generated extension with the official SDK. It excludes the example’s demo rules, allowlists, assistant UI and auto-disable timer. It adds readiness/configuration messages restricted to extension pages. The underlying API calls and browser content filtering remain AdGuard’s maintained code.

The request selects upstream categories before navigating the target. `cleanup:"standard"` selects only cookie and popup filters 18/19; `cleanup:"all"` selects the ten-filter reference preset. Ads, tracking, social, widgets, app banners and other annoyances are separately configurable. The runtime checks its generated file hashes, waits for the selected rulesets to be enabled and fails with 503 if setup is unavailable. There is no silent raw fallback.

The standard preset was separately exercised through the HTTP endpoint on OneTrust, Guardian, Booking and Cookiebot at the API’s 1920×1080 / 2× resolution. The first three returned unobstructed detector results; Cookiebot retained a suspected obstruction. This small standard-preset check is **not** the 17-site full-preset result. Evidence: `artifacts/api-smoke/2026-11-25T04-43-19.156Z/`.

AI remains off. `consent:"none"` means no additional rejection layer; **AdGuard’s native cookie rules can themselves interact with banners and consent choices**. The API reports `cookieRulesMayInteract`. No universal no-accept guarantee or consent-state audit across the live corpus is claimed.

The SDK does not supply verified hidden-element counts. The API reports these as null and uses `enabled` to mean the engine was configured, with residual status recorded separately. Residual detection is bounded and read-only. Core native behavior is not filtered through our earlier custom safety/geometry guards.

## Visible-browser access check

Product Hunt was checked through the screenshot API in both modes. The headless request received Cloudflare HTTP 403 with `cf-mitigated: challenge` and remained on verification after ten seconds. The headful request loaded the real page and returned PNG. This is an observation from those visits, not a guarantee that visible-browser mode bypasses access restrictions.

Upstream failures include `upstreamStatus` and, when explicitly identified by the response header, `reason:"browser-verification"`. Error bodies remain JSON. See the [API reference](api.md).

## Validation and remaining limits

The normal suite covers the retained cosmetic candidate, validation, PNG delivery, isolation, deadlines and raw browser lifecycle. `npm run test:adguard` also exercises the real official headless runtime, category readiness, delayed banners and cross-request cookie/storage isolation. See README for the current commands.

The initial SDK dependency audit produced nine high-severity entries. JS-YAML is now overridden to patched 3.15.2 and the runtime rebuilt. Zod remains unresolved because the SDK pins major version 3 and the advisory fix requires major version 4. The full CI audit records that exact advisory with an expiring exception and rejects new findings. See [dependency review](dependency-audit.md). The generated browser bundle includes SDK dependencies; development-only installation is not a security fix. Resolve the remaining advisory before public deployment. This remains a trusted loopback development service without authentication or outbound network isolation.

The SDK/example adaptation and upstream assets retain their GPL licenses. No browser-store login, personal extension installation, manual rule creation or Docker is required. Fresh clones need the explicit setup command; generated assets and live evidence are excluded from Git.

Further work: repeated multi-region/mobile evaluations, measured collateral rates, public hosting protections, optional rejection automation, optional bounded AI fallback, and production capacity/load measurements. The tested tie does not prove equivalence on all websites or make any blocker universally best.

## Reproduce

```sh
npm ci
npm run setup:adguard
npm run test:adguard
npm run setup:blockers
npm run build:adguard-reference
BENCH_WORKERS=2 npm run benchmark:adguard -- cookiebot onetrust usercentrics trustarc bbc guardian cnn ikea samsung microsoft booking wikipedia github theverge wired independent techradar
node apps/server/benchmarks/report-adguard.js artifacts/adguard-headless/<timestamp>
```

Primary references: [Playwright headless extension support](https://playwright.dev/docs/chrome-extensions), [official AdGuard MV3 example](https://github.com/AdguardTeam/tsurlfilter/tree/master/packages/examples/adguard-api-mv3), [AdGuard MV3 API](https://github.com/AdguardTeam/tsurlfilter/blob/master/packages/adguard-api-mv3/README.md). Upstream example source was inspected at commit `7f665f06297dfaf9609512952970895729afcaa2`.
