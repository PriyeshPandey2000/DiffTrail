# Overlay blocker experiment — 24 November 2026

## Decision

uBlock Origin Lite is useful as a maintained, non-AI first layer. This experiment does not justify advertising guaranteed popup removal, replacing all cleanup with uBOL, or enabling its entire ad/tracker configuration under an ambiguous `clean` flag. No extension integration was added to the API by this experiment.

## Setup and evidence

- Real Chromium 159.0.8154.6, Playwright 1.65.1, uBOL 2026.1122.1948.
- Extension release downloaded from the upstream GitHub release, pinned and SHA-256 verified by `benchmarks/setup-extension.js`.
- 16 distinct live websites; fresh temporary profile for every baseline and filtered visit. No personal browser state, consent clicks, AI calls, or custom blocking rules.
- Browser operations performed through Chrome DevTools Protocol on an ephemeral loopback port.
- Main comparison: standard uBOL ad/tracker lists plus existing cookie, overlay, chat, and other annoyance lists; complete filtering mode verified before navigation.
- 1280×800 desktop, en-GB locale, Europe/London timezone, host network. IP geography was not changed. Locale/timezone do not simulate a European IP.
- Timed samples at approximately 1, 3, 8, and 15 seconds from navigation start, with another sample after scrolling and waiting 5 seconds. Screenshots at 1, 3, 15 seconds and after scrolling. Slow navigation can delay the nominal early samples; actual times are logged.
- Screenshots visually reviewed alongside DOM/iframe observations, console errors, failed requests, response status, and scroll/overflow state. Findings are screenshot outcomes, not a full site functionality audit.
- Initial main run: `artifacts/overlay-benchmark/2026-11-24T10-20-11.155Z/`. Cookiebot and Guardian use the complete paired repeat `2026-11-24T10-25-45.772Z/`; originals are retained.
- Full review and paired screenshots: main run's `report.html` and `review.json`. Raw JSON and images stay in ignored `artifacts/`, not in source control.

## Reviewed outcomes

| Site | Cookie-dialog outcome | Other observations |
| --- | --- | --- |
| OneTrust | Removed | Backdrop disappeared; content remained visible |
| TrustArc | Removed | Bottom consent panel disappeared |
| IKEA | Removed | Retail content remained visible |
| Samsung | Removed | Location bar and WhatsApp widget remained |
| Cookiebot | Remained | Reproduced in pilot, repeat, and Linux container |
| Guardian | Remained | Iframe consent dialog persisted; scrolling stayed locked |
| Usercentrics | No cookie dialog observed | Ask AI widget remained; navigation content caused a false positive in the detector |
| BBC | No cookie dialog observed | Broad filtering removed the large ad area and changed layout |
| CNN | No cookie dialog observed | Broad filtering removed top ad; DRM warning appeared in both captures |
| Microsoft | No cookie dialog observed | Chat solicitation remained |
| Booking | No cookie dialog observed | Real page rendered despite HTTP 202; sign-in promotion remained and locked scrolling |
| Wikipedia | No cookie dialog observed | Broad annoyance filtering removed the Wiki Loves Food notice |
| GitHub | No cookie dialog observed | Control case, not evidence of cleanup success |
| Reuters | Untestable | HTTP 401 / restricted page in both modes |
| Adobe | Untestable | HTTP 403 / access-denied page in both modes |
| Stack Overflow | Untestable | HTTP 403 / security-verification page in both modes |

Four of the six sites with visually confirmed cookie dialogs in their baselines lost those dialogs under the tested configuration. Seven sites had no observed cookie dialog; they are not counted as successes. Three sites were inaccessible and excluded. This deliberately varied but small, single-network sample cannot establish an internet-wide success rate.

Cookie dialogs were not necessarily present immediately: the original per-second DOM observations first detected OneTrust at about 3.2 seconds, TrustArc at 1.3 seconds, IKEA at 3.8 seconds, and Samsung at 2.5 seconds. These are observation times in those visits, not universal appearance times. Guardian demonstrates why iframe/screenshot review is necessary: the initial positioned-element detector missed the visible dialog entirely. Later observations include frame text/actions and open shadow roots, but still cannot certify the absence of overlays or inspect closed shadow roots.

## Additional experiments

- Linux ARM64 Docker image built from Node 22 with a clean `npm ci`, browser system dependencies, browser download, and checksum-verified extension download. No host browser profile or API keys were copied. OneTrust removal and Cookiebot non-removal reproduced.
- Final readiness approach also passed an additional OneTrust baseline/filtered pair inside the rebuilt Linux image (`2026-11-24T10-26-07.309Z`). This verifies that path-derived extension identification works in both tested macOS and Linux environments; native Windows and Linux AMD64 have not been exercised.
- Annoyance-only configuration tested separately on OneTrust, IKEA, and BBC. Cookie removal reproduced on OneTrust and IKEA. The BBC ad slot remained but the ad creative differed/was absent, so this run cannot establish that annoyance-only filtering preserves every ad. The slots, networks, and dynamic content differ between visits.
- Three prototype benchmark runs timed out waiting for a background-worker event. Investigation showed the unpacked extension could be installed with no active worker. The final harness opens the extension settings page by its Chromium path-derived ID, sends its configuration, and verifies actual enabled rules, filtering mode, and content-script registration. Successful corrected reruns are kept separately rather than silently overwriting the failures.

## Recommended next changes

1. Keep the maintained blocker as an explicit option, with cookie banners, promotional popups, chat widgets, and ads represented separately. Do not imply a cookie-only switch also enables every ad/tracker/annoyance list.
2. Use verified extension readiness and a fresh temporary profile per capture initially. Close and delete it on every exit path; optimize startup after measuring it.
3. Return a status such as `filtering-applied`, not `removed`, unless a specific removal was verified. No-rule-match or zero heuristic detections does not prove the screenshot is clear.
4. Evaluate an existing consent-automation library against the missed consent cases before adding custom site rules. Keep AI as a separately requested fallback. The Groq cleanup used at the time examined only the main frame and bounded fixed/sticky overlays; it could not be assumed to fix Guardian's iframe dialog. See [current implementation status](cleanup-foundation.md).
5. Validate delayed and scroll-triggered dialogs, iframe handling, mobile viewports, and multiple IP regions before making broad reliability claims.
6. Leave Docker optional at this stage. It is a clean-environment reproduction tool, not a commitment to the API's hosting architecture.

## Reproduce

See the [benchmark guide](benchmarks.md). Setup uses public release assets, not an extension-store session. No customer or contributor has to install anything in their personal browser. Ordinary local execution requires Node 22.18+, unzip, and Playwright's OS dependencies; the optional Dockerfile supplies a Linux environment.

```sh
npm ci
npm run setup:benchmark
npm run benchmark:overlays
# Optional: generate an evidence gallery from a run directory.
node apps/server/benchmarks/report.js artifacts/overlay-benchmark/<timestamp>
```

The report generator labels results unreviewed unless that run contains a manually authored `review.json`. The benchmark itself does not fabricate a cleanup success score from heuristics. Its roughly 20-second observation window is intentional and is not a production capture-latency measurement.
