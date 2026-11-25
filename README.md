# DiffTrail

A local PNG screenshot API using headless Playwright and AdGuard's official MV3 API. Maintained upstream filters handle recurring banners and popups. No custom website rules or AI calls are used.

## Setup

Use Node.js 22.18+, npm 10.9.11 and `unzip`. npm 10 is pinned because npm 11 can
ignore workspace dependency overrides. From the repository root:

```sh
npm ci
npm run setup:adguard
cp .env.example .env
npm start
```

`setup:adguard` installs Playwright Chromium, verifies the pinned AdGuard archive, and builds the official API integration with its bundled filters, scriptlets and redirect assets. It does not install anything in your personal browser. No API key, browser-store account or Docker is needed. Runtime captures do not download filter lists. On Linux, install browser system dependencies with `npm exec --workspace=server -- playwright install --with-deps chromium` if needed. Windows contributors can use WSL2.

The server binds to `http://127.0.0.1:3000`; set `PORT` in `.env` to change it. `npm start` compiles TypeScript into `apps/server/dist` and runs the compiled server. `npm run dev` runs the TypeScript source directly with Node’s watch mode. For raw captures alone, `npm run setup:browser` is sufficient.

## Capture and view an image

In another terminal:

```sh
curl --fail-with-body http://127.0.0.1:3000/api/screenshot \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://www.onetrust.com/","cleanup":"standard"}' \
  -D screenshot-headers.txt \
  --output screenshot.png
open screenshot.png
```

`open` uses the macOS image viewer. Elsewhere, use your normal image viewer. The body is PNG bytes. Errors return JSON, so check curl's exit status before opening output from a failed request.

`cleanup:"standard"` enables cookie and popup filters. `cleanup:"all"` enables the full tested preset, including ads and tracking filters. `cleanup:"none"`, or omitting cleanup, gives raw capture. Cleanup observes the page for about 4.5 seconds after load; raw mode does not add that wait, so dynamic pages can differ between requests.

For category controls, use an object; omitted categories are false:

```json
{"url":"https://example.com","cleanup":{"cookies":true,"popups":true,"ads":false,"widgets":false}}
```

| Category | Upstream AdGuard filters |
| --- | --- |
| `cookies` | Cookie Notices (18) |
| `popups` | Popups (19) |
| `ads` | Base (2) |
| `tracking` | Tracking, URL and mail protection (3, 17, 25) |
| `social` | Social Media (4) |
| `widgets` | Widgets (22), including chat and other widgets |
| `appBanners` | Mobile App Banners (20) |
| `otherAnnoyances` | Other Annoyances (21) |

These are upstream category boundaries, not guarantees that every matching type is removed. There is no precise chat-only category. `chat:true` is rejected; use `widgets:true` if that broader scope is intended. The old `clean` field is rejected with migration guidance.

`consent:"none"` and `ai:false` are the only currently supported values and are defaults. This means no additional Autoconsent rejection and no AI fallback. **AdGuard's own cookie rules can interact with banners, including choosing consent.** Cookie cleanup is not a promise of hide-only behavior. `cookieRulesMayInteract` records that in metadata. Full capabilities and the earlier strict hide-only policy are different behaviors; the former is used here following the updated product direction.

Images are 3840×2160 PNGs from a 1920×1080 viewport at 2× density. Full-page capture and other formats are not implemented yet.

## Visible-browser debugging

To run the API’s own browser with a visible window:

```sh
DIFFTRAIL_HEADLESS=false npm start
```

Use the same curl requests. Each cleanup request opens a fresh AdGuard browser and closes it after capture. Plain `npm start` uses headless mode again. This is a local debugging option, not an automatic fallback or a guarantee of access.

Product Hunt was checked through this API in both modes: the headless request received Cloudflare HTTP 403 with `cf-mitigated: challenge` and remained on verification after ten seconds; the headful request loaded the real page and returned PNG. Upstream failures now include `upstreamStatus` and, when explicitly identified by the response header, `reason:"browser-verification"`. Error bodies remain JSON.

## Result headers

Responses use `Content-Type: image/png` and `Cache-Control: no-store`.

- `X-DiffTrail-Cleanup`: `skipped` for raw capture; `enabled` when AdGuard was initialized and no residual signal was detected; `partial` when filtering ran but suspected/unknown/blocked UI remains.
- `X-DiffTrail-Residual`: `not-checked` in raw mode; otherwise `none-detected`, `suspected`, `unknown` or `blocked`.
- `X-DiffTrail-Rules-Version`: the verified local build fingerprint, or `none`.
- `X-DiffTrail-Metadata`: JSON containing the engine, categories, filter IDs, SDK/reference versions, setup/capture times, residual signals, consent behavior and `aiUsed`.

`enabled` does not mean every banner was removed. The official SDK does not supply a verified count of hidden elements; `hidden`, `guarded` and `blockedRequests` are `null` rather than invented counts. Residual detection is read-only, bounded and heuristic. Legitimate dialogs can be flagged. No detector output guarantees a clear page.

AdGuard's native content scripts handle the upstream rule syntax, frames, CSS and scriptlets. The API adds no second set of site selectors. Some cases remain, including Cookiebot's own homepage, Independent's membership popup, and some chat launchers in the tested sample. Ads and annoyance filtering can change layout and hide notices that some callers want preserved. Use raw capture when fidelity is the priority.

## Errors and resource limits

Invalid URLs/options/JSON return 400; JSON over 16 KB returns 413. Target HTTP errors or capture failures return 502. Missing, invalid or failed AdGuard setup returns 503 (`CLEANUP_UNAVAILABLE`), with no silent raw fallback. Capacity exhaustion returns 503. The capture deadline is 30 seconds, browser launch at most 10 seconds and navigation at most 15 seconds; timeouts return 504.

The default service permits one active capture. Raw captures reuse a browser with a fresh context per request. Cleanup uses a new persistent profile and browser per request, and closes/removes them afterward. No AdGuard worker is kept idle or reused after visiting a website. This trades cold startup for predictable isolation and zero idle worker cost. An idle pool is deferred until traffic and memory budgets justify it.

This is a trusted local development API, not public hosting: authentication, outbound network isolation and abuse controls are not implemented. SDK dependency audit findings are recorded in the [integration notes](docs/adguard-headless.md); development-only npm placement does not remove dependencies from the generated browser bundle.

## Verify and reproduce

```sh
npm run typecheck
npm run build
npm test
# Also run the real AdGuard runtime fixture checks after setup:
npm run test:adguard
# Exercise the HTTP route and save images/metadata:
npm run smoke:api -- onetrust cookiebot guardian booking
```

The server and tests use strict TypeScript. Node 22.18+ runs the test and development source with native type stripping; `typecheck` is a separate required check. The build emits JavaScript with relative imports rewritten for Node. Benchmark and filter-update scripts remain JavaScript.

The normal suite includes the retained cosmetic-candidate regressions; that candidate is not the API default. Real native-runtime tests are explicit because they require the generated extension assets. Tests need no AI key or credits. Live checks are not CI gates.

GitHub Actions checks strict TypeScript types, compiles the server, installs
Chromium with Linux dependencies, builds the pinned AdGuard runtime and runs `test:adguard`, including native path and isolation checks.
`npm run audit:dependencies` fails for new advisories while displaying the
reviewed, unresolved Zod finding described in [dependency review](docs/dependency-audit.md).

To reproduce the matched full-extension/API experiment:

```sh
npm run setup:blockers
npm run build:adguard-reference
BENCH_WORKERS=2 npm run benchmark:adguard -- cookiebot onetrust guardian booking
node apps/server/benchmarks/report-adguard.js artifacts/adguard-headless/<timestamp>
```

The reference and adapted example use the same pinned compiled assets. See [headless AdGuard findings](docs/adguard-headless.md) for the completed corpus, measurements, scope and limitations. Filter snapshots and original sources from the earlier restricted Ghostery experiment remain for comparison; `filters:rebuild` and `filters:update` affect those experimental resources, not the AdGuard runtime.

## Experimental blocker benchmark

These earlier full-extension experiments are separate from the current official AdGuard API integration. They install no extension in your personal browser.

From a fresh clone on macOS or Linux (Node.js 22.18+, and `unzip` available):

```sh
npm ci
npm run setup:benchmark
npm run benchmark:overlays
# Or select sites from apps/server/benchmarks/sites.json:
npm run benchmark:overlays -- onetrust cookiebot
# Test only the annoyance lists, without the standard ad/tracker lists:
BENCH_FILTERS=overlays npm run benchmark:overlays -- onetrust ikea bbc
```

On Linux, install browser system dependencies if needed with `npm exec --workspace=server -- playwright install --with-deps chromium`. Windows contributors can use WSL2 or the optional Docker route below.

The extension download is pinned and SHA-256 verified. Its upstream license is preserved in the extracted package. The benchmark configures existing upstream rules; it adds no custom blocking rules. Run setup again to restore the verified extension files. Use the committed lockfile with `npm ci` for the same Playwright version.

Each baseline and filtered capture gets a fresh temporary profile. Browser operations run through a loopback-only CDP connection. Filtered captures verify complete filtering mode, enabled rulesets, and registered content scripts before navigation. Runs record timed observations, iframe data, console/network diagnostics, and screenshots at roughly 1, 3, and 15 seconds, plus after scrolling and waiting 5 seconds. Actual elapsed times are recorded: slow navigation can delay the early samples. Automated overlay observations are heuristics; inspect screenshots before scoring outcomes.

Evidence is written to `artifacts/overlay-benchmark/<timestamp>/` and excluded from Git. The default configuration includes ad/tracker blocking as well as cookie, overlay, chat, and other annoyance lists; `BENCH_FILTERS=overlays` selects only the four annoyance lists. Geography depends on the host network, even though locale is en-GB and timezone is Europe/London. A successful HTTP response does not prove the desired page rendered or that every dialog disappeared.

Optional clean Linux benchmark environment (not the API's deployment configuration):

```sh
docker build -f Dockerfile.benchmark -t difftrail-overlay-benchmark .
docker run --rm --init --shm-size=1g \
  -v "$PWD/artifacts:/app/artifacts" \
  difftrail-overlay-benchmark onetrust cookiebot
```

Browser installation and extension download happen at image build time. No API key, extension-store login, manual permission grant, or remote-debugging setup is required. The Linux container route was exercised on ARM64; other architectures and network regions require their own verification.

Read [the reviewed experiment findings](docs/overlay-benchmark.md) before choosing a cleanup default. To generate a screenshot gallery, run `node apps/server/benchmarks/report.js artifacts/overlay-benchmark/<timestamp>`. Gallery outcomes stay unreviewed unless you add a manually reviewed `review.json`.

### Compare uBlock Lite, Ghostery, and AdGuard

```sh
npm ci
npm run setup:blockers
npm run benchmark:compare
# Select a smaller set:
npm run benchmark:compare -- cookiebot guardian ikea booking
node apps/server/benchmarks/comparison-report.js artifacts/blocker-comparison/<timestamp>
```

All three extension archives are pinned and checksum-verified. The comparison uses the same browser, viewport, network, observation schedule, and fresh-profile procedure. The baseline runs first; candidate order rotates across sites. Failed extension readiness is recorded as a setup failure, never as successful cleanup. Each candidate's actual version and enabled settings are stored with its capture.

These are **configured product presets**, not an isolated engine benchmark. uBOL enables its default ad/tracker lists plus cookie, overlay, chat, and other annoyance lists. Ghostery enables ads, trackers, Never-Consent with `optOut`/GPC, and all bundled distraction categories. AdGuard enables its base, tracking, social, cookie, popup, app-banner, other-annoyance and widget filters, with search-ad exceptions disabled. Features and consent behavior differ; read the per-site evidence before choosing a default. No custom site rules or AI calls are involved.

The adapters use version-specific extension internals and, for installed-extension discovery, Chromium's internal extension registry. They are experimental benchmark tooling, not stable application APIs. Ghostery's adapter uses its automation build. The production endpoint has not been switched to any of these extensions.

The optional Docker benchmark image now includes all three candidates. To compare them inside it:

```sh
docker build -f Dockerfile.benchmark -t difftrail-overlay-benchmark .
docker run --rm --init --shm-size=1g -e BENCH_COMPARE=1 \
  -v "$PWD/artifacts:/app/artifacts" difftrail-overlay-benchmark onetrust
```

The completed 20-site comparison and its limitations are documented in [the three-blocker findings](docs/blocker-comparison.md). Adapters remain separate from the API; no defaults were changed by that experiment.
