# Implementation Plan

Screenshot / PDF rendering API. Open source (AGPL-3.0 + CLA), self-hostable with `docker compose up`, with a hosted paid tier.

This document is the source of truth for architecture decisions and build order. Each phase ends in a working, deployable state.

---

## 0. Decisions (locked)

| Area | Decision | Why |
|---|---|---|
| Browser (normal mode) | Playwright + `chrome-headless-shell` | Real Chromium rendering (pixel fidelity is the product), lighter than full Chrome |
| Browser (stealth mode, later) | Patchright + full Google Chrome (`channel: "chrome"`, new headless) | Fewer automation leaks; same API as Playwright |
| Rejected | Lightpanda (no renderer), Obscura / h5i (own layout engine → fidelity risk) | Revisit Obscura later only as a fast path, behind the engine interface |
| Language | Node.js (ESM), TypeScript optional later | Playwright/Patchright first-class; Ghostery adblocker has Playwright bindings |
| Queue | Redis + BullMQ | Stateless workers, horizontal scaling by adding boxes |
| Storage | Cloudflare R2 (S3 API) | Zero egress |
| Hosting | Hetzner dedicated vCPU (x86). No Kubernetes / GKE | Cheapest compute, no egress trap; scale by adding worker boxes |
| Proxies | None at launch. `proxy` param (BYO) from day one; managed proxies only when paid users are blocked | Proxies are the only real per-request cost risk |
| License | AGPL-3.0 core + CLA Assistant | Open source credibility, deters closed hosted clones, keeps dual-licensing option |
| Cookie/popup handling | Layered: Ghostery → autoconsent → DOM detector → opt-in LLM fallback → per-domain memory | Deterministic and ~free for most sites; LLM only for leftovers |

Pin exact Playwright version (no `^`). Upgrade deliberately with a visual regression check.

---

## 1. Target structure

```
apps/
  server/                     # API + worker (same image, different entrypoints)
    src/
      server.js               # API entrypoint
      worker.js               # worker entrypoint (Phase 4)
      app.js
      config.js               # env parsing + defaults, single place
      api/
        routes/screenshot.routes.js
        validate.js           # request schema (zod)
      engine/
        index.js              # render(options) -> { buffer, contentType, meta }
        pool.js               # browser pool: launch, recycle, health
        chromium.js           # normal engine (headless shell)
        stealth.js            # Patchright engine (Phase 7)
      security/
        ssrf.js               # URL + IP validation, request-level guard
      cleanup/
        adblock.js            # Ghostery
        autoconsent.js        # @duckduckgo/autoconsent
        detectOverlay.js      # DOM detector (runs in page)
        llmFallback.js        # Groq, opt-in, safe button-picking
        domainMemory.js       # Redis: domain -> known fix
      services/
        groq.js
        storage.js            # R2 / S3 upload (Phase 5)
      utils/
    test/
      unit/
      e2e/                    # renders local fixture pages
      fixtures/               # static HTML pages: banners, modals, sticky nav, etc.
docker/
  Dockerfile
docker-compose.yml
docs/
LICENSE                       # AGPL-3.0
SECURITY.md
```

---

## Phase 1 — Render core (make it correct)

Goal: one box, safe, returns the image, no leaks.

### Tasks
- [ ] Add `playwright` as a real dependency, pinned exact version. Remove `@playwright/test` boilerplate (`playwright.config.js`, `tests/example.spec.js`, `apps/server/.github/`). Add `.turbo/` to `.gitignore`, delete committed turbo log.
- [ ] Install only the headless shell: `npx playwright install --with-deps chromium --only-shell`.
- [ ] `engine/pool.js`
  - N browsers per process (`BROWSERS_PER_WORKER`, default 1), `MAX_CONTEXTS_PER_BROWSER` (default 4–6).
  - Recycle browser after `RECYCLE_AFTER_JOBS` (default 300) or on disconnect.
  - Semaphore for concurrency; queue waits instead of over-launching.
  - Graceful shutdown: stop accepting, drain in-flight, close browsers (SIGTERM).
- [ ] `engine/index.js` → `render(options)`:
  - `browser.newContext({ viewport, deviceScaleFactor, userAgent?, locale?, timezoneId?, proxy? })` per job.
  - `page.goto(url, { waitUntil, timeout })` then optional `delay`, `wait_for_selector`.
  - `page.screenshot({ type, quality, fullPage, clip? })` → **buffer, never disk**.
  - `try { ... } finally { await context.close() }` always.
  - Hard job timeout (`JOB_TIMEOUT_MS`, default 30s) via `AbortController`/`Promise.race`; on timeout close context; if context close hangs, mark browser for recycle.
- [ ] Route `POST /api/screenshot` and `GET /api/screenshot?url=...`:
  - Returns image bytes with correct `Content-Type`, or JSON `{ url }` when `response_type=json` (after storage exists).
  - Errors return JSON `{ error: { code, message } }` with proper status (400 validation, 422 navigation failed, 504 timeout).
- [ ] Remove Groq from default path (keep file; wired in Phase 3 as opt-in).
- [ ] Remove hardcoded `/Users/...` path and shared `screenshot.png`.

### Request options (v1)
| Param | Type | Default |
|---|---|---|
| `url` | string (http/https) | required (or `html`) |
| `format` | `png` \| `jpeg` \| `webp` | `png` |
| `quality` | 1–100 (jpeg/webp) | 80 |
| `viewport_width` / `viewport_height` | 100–3840 / 100–10000 | 1280 / 800 |
| `device_scale_factor` | 1–3 | 1 |
| `full_page` | bool | false |
| `wait_until` | `load` \| `domcontentloaded` \| `networkidle` | `load` |
| `delay` | ms, 0–10000 | 0 |
| `wait_for_selector` | string | — |
| `timeout` | ms, ≤ 30000 | 30000 |
| `block_ads` | bool | true |
| `block_cookie_banners` | bool | true |

Note: WebP is not native in `page.screenshot`; capture PNG and convert with `sharp`.

### Done when
- 50 concurrent requests on a 4 vCPU box complete without zombie `chrome` processes (`ps aux | grep chrome` count returns to baseline).
- Killing a page mid-render does not leak memory over 1,000 jobs (RSS stable).

---

## Phase 2 — Input validation + SSRF protection

Goal: nobody can use the service to reach internal networks.

### Tasks
- [ ] `api/validate.js` with `zod`: types, ranges, unknown keys rejected.
- [ ] `security/ssrf.js`:
  - Allow only `http:` / `https:`. Reject `file:`, `chrome:`, `data:`, `javascript:`, `ftp:`, `ws:` for top-level URL.
  - Resolve DNS **before** navigation; reject if any resolved IP is private/reserved: `127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16`, `100.64.0.0/10`, `0.0.0.0/8`, `::1`, `fc00::/7`, `fe80::/10`, IPv4-mapped IPv6, multicast, broadcast. Use `ipaddr.js`.
  - Reject numeric/obfuscated hosts that resolve to the above (decimal `2130706433`, hex, octal) — handled by resolving, not by regex.
  - **Request-level guard**: `context.route('**/*')` → for every request (subresources, redirects, iframes), resolve host and abort if private. Cache resolutions per job.
  - DNS rebinding: rely on the per-request guard + short-lived cache; document residual risk. (Stronger option later: run workers in a network namespace / egress firewall that drops RFC1918 + metadata IPs — do this on the hosted infra regardless.)
- [ ] Host firewall on workers: drop outbound to `169.254.169.254` and private ranges (iptables/nftables) as defense in depth.
- [ ] `SECURITY.md` with disclosure contact.

### Done when
- Unit tests cover every blocked range, IPv6 forms, decimal/hex IPs, redirect to private IP, iframe to private IP, `<img src="http://127.0.0.1">` subresource.

---

## Phase 3 — Ads, cookie banners, popups (layered)

Goal: clean screenshots for most sites at ~zero marginal cost, and **know** when it failed.

### Layer 1 — Ghostery adblocker
- [ ] `@ghostery/adblocker-playwright`, engine built once per worker from prebuilt ads + tracking + cookie lists (EasyList, EasyPrivacy, EasyList Cookie). Serialize to disk cache for fast startup.
- [ ] Enable per context when `block_ads` / `block_cookie_banners`.

### Layer 2 — Autoconsent
- [ ] `@duckduckgo/autoconsent` (MPL-2.0) injected into each page; run in `optOut` mode by default (reject), fall back to `optIn` if configured.
- [ ] Wire its messaging (content script ↔ Node via `page.exposeFunction`) per its Playwright integration docs.
- [ ] Wait for autoconsent result with a cap (e.g. 2s) — never block the job longer.

### Layer 3 — DOM overlay detector (`cleanup/detectOverlay.js`)
- [ ] Runs in page via `page.evaluate` after load + autoconsent.
- [ ] Grid-sample `document.elementFromPoint`, walk up to nearest `position: fixed|sticky` ancestor, dedupe.
- [ ] Flag overlay if: consent/newsletter keyword match (multi-language list) **or** covers > 40% of viewport. Ignore small `HEADER`/`NAV` sticky bars.
- [ ] Flag `scrollLocked` if `overflow: hidden` on `html` or `body`.
- [ ] Check `page.frames()` for known consent iframe hosts (`consent`, `cmp`, `sp_message`, `privacy-mgmt`, `cookiebot`, `onetrust`, `didomi`, `usercentrics`).
- [ ] Output `{ blocked, scrollLocked, overlays: [{ areaPct, keyword, tag, textSample }] }`.
- [ ] Tune against fixture pages in `test/fixtures/` (banner, modal, sticky nav, chat widget, full-screen hero — the last three must NOT be flagged).

### Layer 4 — LLM fallback (opt-in: `ai_cleanup=true`, paid plans only)
- [ ] Only runs if Layer 3 says `blocked`.
- [ ] Collect `button, a, [role=button]` **inside detected overlays only**; build `[{ id, text, ariaLabel }]` (max ~40, text truncated).
- [ ] Text-only prompt to Groq: pick the id that dismisses/rejects/accepts. Structured output `{ id: number | null }`. Validate with zod.
- [ ] Click `candidates[id]` with 2s timeout. Re-run Layer 3.
- [ ] Never accept selectors from the model. Never click outside detected overlays.

### Layer 5 — Last resort + memory
- [ ] If still blocked: hide detected overlays via injected CSS (`display:none !important`), restore `overflow` on `html`/`body`.
- [ ] `domainMemory.js` (Redis): on success of LLM or CSS-hide, store `{ domain → { buttonText | hideSelectors }, hits, lastOk }`. On next job for that domain, apply stored fix before Layer 4. Expire / invalidate if it stops working.

### Metrics (log per job)
- `cleanup.layer_resolved` (0 none needed / 1 / 2 / 4 / 5), `cleanup.blocked_after` (bool), `cleanup.ms`.
- These numbers decide what to improve next. Target: `blocked_after` < 5% on a 200-site benchmark list.

### Done when
- Benchmark script renders a fixed list of ~200 popular sites (EU + US news, e-commerce, SaaS) and reports blocked-after rate and p50/p95 latency per layer.

---

## Phase 4 — Queue + workers (scaling design)

Goal: API never renders; add capacity by adding boxes.

### Tasks
- [ ] BullMQ queue `render`. API validates → enqueues → waits for result (sync mode, with timeout) or returns job id (async mode + webhook later).
- [ ] `worker.js`: pulls jobs, concurrency = pool capacity, graceful drain on SIGTERM.
- [ ] Separate queues ready for: `render` (normal), `render-stealth` (Phase 7).
- [ ] Per-API-key concurrency limit in Redis (not just per-minute rate), so one customer can't starve the fleet.
- [ ] Metrics: queue depth, wait time, job duration, failures, browser recycles. Expose Prometheus `/metrics` (worker + API).
- [ ] Scaling signal: queue wait p95 > 2s → add a worker box.

### Done when
- Two worker processes on different machines consume the same queue; killing one mid-job causes the job to retry on the other.

---

## Phase 5 — Docker, storage, caching, formats

### Tasks
- [ ] `docker/Dockerfile`: Node LTS slim, Playwright pinned, headless shell only, fonts: `fonts-noto`, `fonts-noto-color-emoji`, `fonts-noto-cjk`, `fonts-liberation`. Non-root user, Chromium sandbox **on**.
- [ ] `docker-compose.yml`: `api`, `worker`, `redis`. `docker compose up` → working API on `localhost:3000`.
- [ ] `services/storage.js`: S3-compatible (R2, S3, MinIO). Optional; if unset, return bytes only.
- [ ] Caching: key = sha256(normalized options). `cache=true` + `cache_ttl` (default 4h, max 30d). Hit → serve from R2 (or redirect to signed URL). Hits are free / cheap for billing.
- [ ] PDF: `format=pdf` → `page.pdf({ format, printBackground, landscape, margin })` (Chromium only; real text PDF).
- [ ] HTML input: `html` param instead of `url` → `page.setContent(html, { waitUntil })`. SSRF guard still applies to subresources.
- [ ] Upload to customer S3 (`s3_*` params) — later in this phase or Phase 6.

---

## Phase 6 — Productization (hosted tier)

These can live in a private module/repo; open-source core must work without them.

- [ ] API keys (hashed in DB), plans, monthly quota, per-minute rate limit (e.g. 40 rpm Basic).
- [ ] Usage metering: count **only successful** renders; challenge pages and our errors are not billed.
- [ ] Block detection per job: status code, final URL, challenge markers (`Just a moment`, `cf-chl`, DataDome, `Access denied`, captcha iframes) → `blocked_by_bot_protection` flag. Not billed.
- [ ] Signed links: `GET /api/screenshot?...&signature=HMAC(secret, canonical_query)` so customers can embed URLs publicly.
- [ ] Webhooks: async jobs, HMAC-signed payloads, retries with backoff.
- [ ] BYO proxy param `proxy=http://user:pass@host:port` (pass to `newContext({ proxy })`).
- [ ] Dashboard (usage, keys, logs). Billing (Stripe).
- [ ] MCP server: thin wrapper exposing `screenshot` / `pdf` tools over the public API.
- [ ] Zapier / Make: simple REST fits; publish integrations once API is stable.

---

## Phase 7 — Stealth + proxies (only when data says so)

Trigger: `blocked_by_bot_protection` rate for paid users > 2–5% or repeated customer requests.

- [ ] `engine/stealth.js`: Patchright, full Chrome (`channel: "chrome"`), new headless; no fake UA/viewport overrides. Separate worker pool + `render-stealth` queue. Optional Xvfb headful mode for hardest sites.
- [ ] Managed proxies: retry-on-block strategy — first attempt direct, retry via residential proxy only if challenge detected. Per-domain memory of "needs proxy".
- [ ] Price stealth/proxy requests as multiple credits. Document as best effort.

---

## Cross-cutting

### Testing
- Unit: validation, SSRF, overlay detector logic (jsdom not enough for layout — use real browser on fixtures).
- E2E: local static fixture server (never hit the internet in CI).
- Visual regression: fixed fixture set rendered and diffed (`pixelmatch`) on every Playwright upgrade.
- Load test: `autocannon`/`k6` against a fixture server; watch RSS and chrome process count.

### CI (root `.github/workflows/`)
- Lint (ESLint + Prettier), unit, e2e in the Playwright Docker image, Docker build.

### Observability
- Structured JSON logs (`pino`) with `job_id`, `domain`, durations, cleanup layer, error codes.
- Prometheus metrics; alert on queue wait, error rate, zombie browser count.

### Repo hygiene
- `LICENSE` (AGPL-3.0), CLA Assistant GitHub App, fix `package.json` license/repo URLs, `CONTRIBUTING.md`, `SECURITY.md`, README with `docker compose up` quickstart and API reference.

---

## Build order summary

| Phase | Outcome | Rough effort |
|---|---|---|
| 1 Render core | Correct, non-leaking single-box API | 1 day |
| 2 Validation + SSRF | Safe to expose publicly | 0.5–1 day |
| 3 Cleanup layers | Clean screenshots + failure metrics | 2–4 days (tuning is ongoing) |
| 4 Queue + workers | Horizontal scaling | 1–2 days |
| 5 Docker, storage, cache, PDF, HTML | Self-hostable, feature parity with Basic plan core | 2–3 days |
| 6 Productization | Sellable hosted tier | 1–2 weeks |
| 7 Stealth + proxies | Only when blocking data justifies it | 2–4 days |

Launch-ready open-source release = end of Phase 5. First paid users = Phase 6.
