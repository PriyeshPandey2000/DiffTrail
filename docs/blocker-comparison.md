# Three-blocker comparison — 24 November 2026

## Result

Among the **configured full cleanup presets tested**, AdGuard produced the broadest visible cleanup. This is a provisional product-preset result, not a ranking of isolated filtering engines or an internet-wide reliability estimate. The API's behavior and defaults have not been changed based on this experiment or the separate Opus review.

| Reviewed category | uBlock Origin Lite | Ghostery | AdGuard |
| --- | ---: | ---: | ---: |
| Cookie/privacy notices removed | 5 / 7 | 6 / 7 | 6 / 7 |
| Promotional modals removed | 0 / 2 | 0 / 2 | 1 / 2 |
| Chat prompts/launchers removed | 0 / 3 | 0 / 3 | 1 / 3 |

Chat cases comprise Microsoft's open chat solicitation, Usercentrics' Ask AI launcher, and Samsung's WhatsApp launcher. The latter two remained under every preset. A launcher is not a consent dialog, and category counts are obstruction cases rather than a percentage of all sites.

## Scope and evidence

- 20 distinct live sites, four modes per site: baseline plus three blockers, for 80 captures.
- 17 sites rendered usable target pages in all modes. Reuters, Adobe, and Stack Overflow returned access restrictions/challenges and were excluded from removal scoring.
- Zero extension setup failures in the final run; all candidates' actual installed versions and enabled settings were verified before navigating.
- Same Chromium 159.0.8154.6 / Playwright 1.65.1, 1280×800 viewport, en-GB, Europe/London timezone, and host network on macOS ARM64. Locale/timezone do not change IP geography.
- Every mode used a fresh temporary profile and actual browser operations over a loopback CDP connection. Baseline ran first; candidate order rotated across sites.
- Samples at nominal 1, 3, 8, and 15 seconds after navigation started, followed by a scroll and 5-second wait. Actual elapsed times are recorded. Screenshot outcomes were visually reviewed at 15 seconds and after scrolling, alongside frame observations and scroll/overflow state.
- Main evidence: `artifacts/blocker-comparison/2026-11-24T10-40-57.310Z/` contains `report.html`, `run.json`, `review.json`, `summary.json`, per-capture JSON, and screenshots. Evidence stays out of Git.
- A clean Linux ARM64 container also completed a baseline and all three candidate captures on OneTrust: `artifacts/blocker-comparison/2026-11-24T10-45-42.191Z/`. This verifies the installation/configuration path in that environment, not all sites on Linux or other architectures.

## Configurations

| Candidate | Pinned build | Enabled behavior |
| --- | --- | --- |
| uBlock Origin Lite | 2026.1122.1948 | Complete filtering; default ads/trackers plus cookie, overlay, widget and other-annoyance lists |
| Ghostery Automation | 10.6.13 | Ads, trackers, Never-Consent `optOut`, GPC, and all bundled distraction categories |
| AdGuard MV3 | 5.5.4.55 (release v5.5.4) | Base, tracking, social and cookie/popup/app-banner/other-annoyance/widget filters; search-ad exceptions disabled; recommended URL/mail tracking filters also enabled by the privacy group |

The public release archives are pinned and SHA-256 verified by the setup scripts. Per-capture metadata records effective configuration and, where exposed, filter versions. Products can use upstream resource updates; pinning an extension archive does not guarantee identical future website or remote-resource behavior.

These presets differ. In particular, Ghostery has explicit automatic rejection and GPC in this comparison. Filter lists can also contain scriptlets, so neither filter-driven preset is certified to be cosmetic-only or free of consent side effects. We did not audit every acceptance/rejection event or CMP cookie state. No custom site rules or AI calls were used.

## Findings that affect the choice

- **Cookiebot's own homepage:** Ghostery cleared the consent dialog; uBOL and AdGuard left it visible. This is one Cookiebot deployment, not a claim about every site using Cookiebot.
- **Guardian:** AdGuard cleared the iframe consent dialog and restored scrolling. Baseline, uBOL, and Ghostery stayed at scrollY 0; AdGuard reached 650. The original DOM heuristic missed the visible iframe dialog, so its absence of detections was not treated as success.
- **OneTrust, TrustArc, IKEA, Samsung, and The Verge:** all three cleared the observed cookie/privacy notices. Samsung's location selector and WhatsApp launcher remained.
- **Booking:** AdGuard cleared the Genius sign-in promotion and restored scrolling; uBOL and Ghostery retained both the dialog and scroll lock. HTTP 202 still rendered the actual website and was not misclassified as a blocked page.
- **Microsoft:** only AdGuard removed the observed chat solicitation.
- **Independent:** every candidate retained the membership subscription modal and backdrop.
- **Usercentrics:** every candidate retained Ask AI. A text match on navigation content is not counted as a cookie banner.
- **BBC, CNN, Wired, and TechRadar:** broad presets changed ad regions and the resulting layout. No cookie-removal success is inferred from these sites. CNN's DRM video warning also appeared in the baseline.
- **Wikipedia:** uBOL and AdGuard removed the Wiki Loves Food notice; Ghostery retained it. This additional difference is not scored as an obstructing cookie/promo dialog.
- **GitHub:** a control, not a removal success.

## Timing and limits

Median fresh-profile setup in this harness was roughly 1.3 seconds for uBOL, 4.5 seconds for Ghostery, and 24.5 seconds for AdGuard (baseline 0.3 seconds). These include browser startup and our version-specific initialization/configuration calls. AdGuard's adapter enables filters sequentially and triggers engine updates. These values are **not intrinsic engine-speed measurements or production request-latency estimates**, and should not select the core library by themselves. Each visit also deliberately spends about 20 seconds observing delayed UI.

Only one host network, desktop viewport, and one final visit per mode/site were used. Site content, ad delivery and experiments vary between visits. Additional pilot/reproduction runs exist, but are not silently pooled into these counts. We did not test full application functionality, mobile behavior, multiple IP regions, all category combinations, or AI quality. Visual inspection did not establish a numeric collateral-damage rate. Extension adapters use private/version-specific APIs and are benchmark tools, not a stable production integration.

## Recommendation from the experiment

Use AdGuard's tested behavior as the leading **full-preset reference** for the next integration decision. Retain Cookiebot and Independent as explicit unsolved cases; Ghostery's success on Cookiebot shows that maintained consent automation deserves a separate evaluation. Do not claim that any candidate guarantees a clear screenshot or that the best full preset proves the best hide-only engine.

The separate Opus advice was relayed to the user without applying it. Its proposed product defaults, library architecture and AI escalation thresholds are not implemented or validated by this run. At the time of that experiment the API still used optional Groq cleanup. The subsequent library integration is described in [cleanup implementation status](cleanup-foundation.md).

## Reproduce

```sh
npm ci
npm run setup:blockers
npm run benchmark:compare
node apps/server/benchmarks/comparison-report.js artifacts/blocker-comparison/<timestamp>
```

No extension-store login, personal browser installation, API key, or manual remote-debugging setup is required. Native macOS and the optional Linux container path were exercised. See README for Linux dependencies, WSL/Docker guidance, selected-site runs, exact preset differences, and the optional Docker benchmark command. New runs are unscored until their screenshots are reviewed and a `review.json` is authored.
