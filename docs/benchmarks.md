# Benchmark tooling

These manual tools compare filtering integrations and save local evidence. They are separate from the screenshot API and do not run in CI.

## Headless AdGuard comparison

To reproduce the matched full-extension/API experiment:

```sh
npm run setup:blockers
npm run build:adguard-reference
BENCH_WORKERS=2 npm run benchmark:adguard -- cookiebot onetrust guardian booking
node apps/server/benchmarks/report-adguard.js artifacts/adguard-headless/<timestamp>
```

The reference and adapted example use the same pinned compiled assets. See [headless AdGuard findings](adguard-headless.md) for the completed corpus, measurements, scope and limitations. Filter snapshots and original sources from the earlier restricted Ghostery experiment remain for comparison; `filters:rebuild` and `filters:update` affect those experimental resources, not the AdGuard runtime.

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

Read [the reviewed experiment findings](overlay-benchmark.md) before choosing a cleanup default. To generate a screenshot gallery, run `node apps/server/benchmarks/report.js artifacts/overlay-benchmark/<timestamp>`. Gallery outcomes stay unreviewed unless you add a manually reviewed `review.json`.

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

The adapters use version-specific extension internals and, for installed-extension discovery, Chromium's internal extension registry. They are experimental benchmark tooling, not stable application APIs. Ghostery's adapter uses its automation build. The screenshot API uses the official AdGuard MV3 API; these consumer-extension adapters are benchmark references.

The optional Docker benchmark image now includes all three candidates. To compare them inside it:

```sh
docker build -f Dockerfile.benchmark -t difftrail-overlay-benchmark .
docker run --rm --init --shm-size=1g -e BENCH_COMPARE=1 \
  -v "$PWD/artifacts:/app/artifacts" difftrail-overlay-benchmark onetrust
```

The completed 20-site comparison and its limitations are documented in [the three-blocker findings](blocker-comparison.md). Adapters remain separate from the API; no defaults were changed by that experiment.
