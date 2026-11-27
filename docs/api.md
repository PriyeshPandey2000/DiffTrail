# Screenshot API

`POST /api/screenshot` accepts a JSON object and returns image bytes, PNG by default. The server listens at `http://127.0.0.1:3000` by default.

## Request

```json
{"url":"https://example.com","cleanup":"standard"}
```

`url` must be an absolute HTTP or HTTPS URL without embedded credentials.

`cleanup:"standard"` enables cookie and popup filters. `cleanup:"all"` enables all supported filter categories, including ads and tracking filters. `cleanup:"none"`, or omitting cleanup, gives raw capture. Cleanup observes the page for about 4.5 seconds after load; raw mode does not add that wait, so dynamic pages can differ between requests.

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

`consent:"none"` and `ai:false` are the only currently supported values and are defaults. This means no additional Autoconsent rejection and no AI fallback. **AdGuard's own cookie rules can interact with banners, including choosing consent.** Cookie cleanup is not a promise of hide-only behavior. `cookieRulesMayInteract` records that in metadata.

## Image options

All options are optional. Defaults reproduce the original behavior: a 1920×1080 viewport captured as a PNG.

| Option | Values | Default | Notes |
| --- | --- | --- | --- |
| `format` | `"png"`, `"jpeg"` (alias `"jpg"`), `"webp"` | `"png"` | Sets the response `Content-Type`. |
| `quality` | integer 1–100 | `80` | JPEG and WebP only. Sending it with PNG is rejected. |
| `viewport` | `{"width": 200–3840, "height": 200–4320}` | `1920` × `1080` | Either field may be omitted. |
| `scale` | number from 1 to 5 | `2`, or the device preset's density | Output pixel density; preserves the CSS viewport layout. Fractional values such as `2.75` are allowed. |
| `maxHeight` | integer 1–100,000 CSS px | omitted | Requires `fullPage:true`; caps the capture height. |
| `fullPage` | `true` or `false` | `false` | Captures the whole page height, up to the limit below. |

```json
{"url":"https://example.com","format":"webp","quality":75,"fullPage":true,"viewport":{"width":1440,"height":900}}
```

Pixel density defaults to **2×**: the default output is 3840×2160. Explicit `scale:1` produces one image pixel per CSS pixel and reduces image size and rendering work.

The image must fit the format and the pixel budget below. For viewport captures, `viewport.width × scale` by `viewport.height × scale` must fit; for full-page captures, only the width must fit, and the height is truncated as described below. A request that cannot fit returns 400 rather than a reduced image. For example, the largest viewport (3840×4320) works at `scale:2` but not at `scale:3`.

Full-page captures are bounded by the smallest of the requested `maxHeight`, the format limit, and the server's output-pixel budget. WebP supports at most 16,383 device pixels per side; JPEG is capped at the bundled Chromium encoder's measured 65,500-pixel boundary. PNG uses the pixel budget rather than inheriting WebP's height limit.

The pixel budget is **125,813,760 output pixels**, retaining the former largest allowed image area. At density `scale`, the budget bounds CSS height to `floor(budget / (width × scale²))`, where `width` is the captured CSS width (normally `viewport.width`). This is an output-area bound, not a guaranteed RAM allowance; deployment memory and concurrency still require measurement. No format, density, or page layout is silently changed to fit.

When limited, the response includes `X-DiffTrail-Truncated: true`, `output.truncated`, and `output.truncationReasons` (`max-height`, `format-limit`, or `pixel-budget`). A short full-page capture is one viewport tall unless `maxHeight`, the format limit, or the pixel budget is smaller. At high density the pixel budget alone can make it shorter than the viewport: a 3840 px wide viewport at `scale:5` allows 1,310 CSS px.

Full-page requests scroll by default to trigger lazy-loaded content, stopping once the capturable region is reached or the step limit is exhausted. Use `scroll:false` to opt out. Viewport requests do not scroll unless explicitly requested.

Two limits of full-page capture:

- Cleanup residual checks only inspect the initial capture viewport (the first viewport for full-page mode). For a full-page capture, `X-DiffTrail-Residual` describes that first viewport, so an overlay lower on the page can remain even when it reports `none-detected`.
- The page height is read from the document. Pages that scroll inside an inner container instead of the document are captured at one viewport tall and are not reported as truncated.

## Element and rectangle capture

Use `selector` to capture the **first matching element in DOM order**, including elements in open shadow roots. This is separate from `waitForSelector`, which only controls readiness and does not select the output area.

```sh
curl --fail-with-body http://127.0.0.1:3000/api/screenshot \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://example.com","selector":"h1","cleanup":"standard"}' \
  --output heading.png
```

`selector` accepts non-empty CSS of at most 1,000 characters. Both browser CSS and Playwright parser validation run before navigation; unsupported syntax returns 400. XPath, Playwright selector engines, frame traversal, and closed shadow roots are not supported. Get a CSS selector from your page source or browser DevTools. If the first match is hidden, a later visible match is not substituted.

DiffTrail waits up to five seconds for that first match to become visible and stable enough to scroll into view, including scrolling nested containers. The total request deadline still applies. It then runs the requested cleanup and bounded image-readiness check. Final bounds are resolved again before capture, with another target wait of at most five seconds. A missing/hidden/unstable target returns `422 TARGET_NOT_VISIBLE` when this target wait expires; the overall request deadline still returns 504. There is no fallback to a viewport image.

To capture a rectangle, supply all four `clip` fields:

```json
{"url":"https://example.com","clip":{"x":100,"y":200,"width":600,"height":400}}
```

Coordinates are **CSS pixels from the document's top-left**, not output-image pixels or coordinates relative to the current viewport. `x` and `y` must be integers from 0–100,000; `width` and `height` must be integers from 1–100,000. DiffTrail scrolls the document toward the rectangle to trigger nearby lazy content, then captures the exact region. It does not traverse all content inside a tall rectangle or nested scroll containers. At the default `scale:2`, a 600×400 CSS rectangle produces a 1200×800 image; `scale:1` produces 600×400.

Rules for both modes:

- `selector`, `clip`, and `fullPage:true` are mutually exclusive. Conflicts and malformed options return 400. `maxHeight` remains full-page-only.
- Existing format, quality, viewport, density, loading controls, and cleanup options remain available. Omit both target options for the existing viewport/full-page behavior.
- Cleanup runs before final target measurement. It can change layout, hide, or remove the requested target; a target absent or hidden at measurement returns `422 TARGET_NOT_VISIBLE` without another wait for it to appear.
- A region extending outside the document returns `422 TARGET_OUT_OF_BOUNDS`. Format-side and output-pixel limits apply to both dimensions; oversized targets return `422 TARGET_TOO_LARGE` rather than being silently truncated or downscaled.
- The response remains image bytes. `output.target` in `X-DiffTrail-Metadata` records `mode` (`selector` or `clip`) and measured document-relative CSS `bounds`. The selector string is not echoed into headers. `output.fullPage` and `output.truncated` are false for targeted output.

Element screenshots crop what the browser renders: overlapping UI can still cover a target, a scrollable element includes only its currently visible internal content, and targeting does not bypass access challenges. CSS backgrounds, canvas, iframe content, and images in shadow roots are outside the main-document image-readiness check. Rapid layout changes can still affect the screenshot after bounds are measured. Cleanup residual metadata describes the viewport inspected after initial target scrolling, not a guarantee about every pixel of a large target.

## Loading controls

All durations are in milliseconds. Viewport captures do not scroll by default; full-page captures scroll automatically unless disabled.

| Option | Default | Behavior |
| --- | --- | --- |
| `waitUntil` | `"load"` | `"load"`, `"domcontentloaded"`, or `"networkidle"`. The latter requires 500 ms without network connections and can time out on busy sites. |
| `delay` | `0` | Extra wait before cleanup and capture; integer 0–10,000. |
| `waitForSelector` | omitted | Wait for the first matching CSS element to be visible. Non-empty CSS selector, at most 1,000 characters. A missing or hidden element waits until the capture deadline, then returns 504. Invalid CSS returns 400. |
| `timeout` | `30000` | Total request deadline, including browser setup, navigation, scroll, waits, cleanup and image encoding; integer 1,000–90,000. |
| `scroll` | `true` for full page, otherwise `false` | `true` or an object with `step`, `delay`, and `maxSteps`. Scrolls the document, then returns to the top before selector waits, extra delay, cleanup, and capture. |

```json
{"url":"https://example.com","fullPage":true,"waitUntil":"domcontentloaded","scroll":true,"waitForSelector":"main","delay":1000,"timeout":60000}
```

Scroll defaults: step = 80% of viewport height (at most 800 CSS px), delay = 200 ms between steps, and maxSteps = 30. Custom bounds: step 100–2,000 CSS px, delay 0–1,000 ms, maxSteps 1–100. For example, `"scroll":{"step":500,"delay":300,"maxSteps":20}`. Infinite pages stop at the step limit; scroll locks are reported without attempting to unlock the page. Inner scrolling containers are not traversed. Reaching the bottom of the capturable region does not guarantee every image finished loading. Format, pixel-budget, and requested height limits still apply.

The metadata header includes `loading`: effective wait event, delay, total timeout, selector state (`matched` or `not-requested`), and `scroll.status` (`completed`, `limited`, `blocked`, or `not-requested`) with step count. Raw mode still skips cleanup and residual inspection even when loading controls are requested.

Timeouts remain strict: DiffTrail returns a 504 JSON error rather than silently capturing an incomplete page. `domcontentloaded` is useful when slow images or trackers prevent `load`. Choosing an earlier event can capture unfinished content. These options do not bypass HTTP errors or access challenges.

### Automatic image readiness

After cleanup and before capture, DiffTrail waits up to 1,500 ms for relevant main-document `img` elements, exiting early when there are no pending or untriggered images. The shared request deadline still applies. HTTP image failures are recorded without waiting for them to recover; permanently pending requests cannot extend this budget. Images outside the capturable region are ignored.

`loading.images` reports `state` (`ready`, `incomplete`, or `unknown`), loaded/failed/pending/untriggered counts, and elapsed time. Inspection is limited to 10,000 main-document images. This is not a guarantee for CSS backgrounds, iframe/shadow images, videos, or canvas content. Missing images do not turn an otherwise successful capture into an error. There is no additional fixed delay when relevant images are already ready.

## Device and browser emulation

These options change how the browser presents itself to the page. All are optional. **Options that are not sent are not passed to the browser**, so it keeps its own defaults: a desktop Chromium user agent, and the locale and time zone of the machine running DiffTrail.

| Option | Values | Notes |
| --- | --- | --- |
| `device` | preset id, such as `"iphone_15"` or `"ipad_pro_11_landscape"` | Sets the viewport, pixel density, mobile layout, touch support, and user agent of the device. |
| `colorScheme` | `"light"` or `"dark"` | Sets `prefers-color-scheme`. Only pages that support dark mode change. |
| `reducedMotion` | `true` or `false` | Sets `prefers-reduced-motion: reduce`. It does not pause animations the page runs regardless. |
| `media` | `"screen"` or `"print"` | `"print"` renders the page with its print styles. |
| `userAgent` | 1–512 printable ASCII characters | Overrides the browser's user agent, including a device preset's. |
| `locale` | language tag, such as `"de-DE"` | Sets `navigator.language` and the `Accept-Language` header. |
| `timezone` | IANA time zone, such as `"Europe/Berlin"` or `"UTC"` | Sets the time zone the page sees. |

```json
{"url":"https://example.com","device":"iphone_15","colorScheme":"dark","locale":"de-DE","timezone":"Europe/Berlin"}
```

Presets: `iphone_se`, `iphone_13`, `iphone_14_pro_max`, `iphone_15`, `iphone_15_pro_max`, `iphone_16`, `iphone_16_plus`, `pixel_5`, `galaxy_s8`, `galaxy_s9+`, `ipad_mini`, `ipad_pro_11`, and `galaxy_tab_s4`. Each also has a `_landscape` variant. `GET /api/devices` returns every preset with its viewport, density, and user agent. Device sizes and user agents come from the bundled Playwright and can change when it is upgraded.

Explicit options override the preset: `viewport` (either field), `scale`, and `userAgent`. Presets capture at their native density, such as `galaxy_s9+` at 4.5×.

On a mobile preset, pages without a mobile viewport tag, or with content wider than the device, are laid out wider (often 980 CSS px) and zoomed out, as on a phone. A viewport capture shows that zoomed-out view. A full-page capture covers the same width at the requested density, so the image is wider than `viewport.width × scale`; `output.captureWidth` reports the captured CSS width when it differs from the viewport.

This is emulation in Chromium, not a real device. iPhone and iPad presets send a Safari user agent but still render with Chromium. Higher density makes larger images and reduces the full-page height that fits in the format and pixel limits.

The metadata header includes `emulation`: the preset, native `deviceScale`, `mobile`, `touch`, the user agent sent, `locale`, `timezone`, `colorScheme`, `reducedMotion`, and `media`. A `null` value means the browser default was used.

## Result headers

Responses use the `Content-Type` of the requested format (`image/png`, `image/jpeg` or `image/webp`) and `Cache-Control: no-store`.

- `X-DiffTrail-Cleanup`: `skipped` for raw capture; `enabled` when AdGuard was initialized and no residual signal was detected; `partial` when filtering ran but suspected/unknown/blocked UI remains.
- `X-DiffTrail-Residual`: `not-checked` in raw mode; otherwise `none-detected`, `suspected`, `unknown` or `blocked`.
- `X-DiffTrail-Rules-Version`: the verified local build fingerprint, or `none`.
- `X-DiffTrail-Truncated`: `true`, present only when a full-page capture was cut at the height limit.
- `X-DiffTrail-Metadata`: JSON containing the image `output` (format, quality, scale, maxHeight, viewport, `fullPage`, `truncated`, truncation reasons, and the measured `pageHeight` for full-page captures), the engine, categories, filter IDs, SDK/reference versions, setup/capture times, residual signals, consent behavior, `aiUsed`, `loading`, and `emulation`.

`enabled` does not mean every banner was removed. The official SDK does not supply a verified count of hidden elements; `hidden`, `guarded` and `blockedRequests` are `null` rather than invented counts. Residual detection is read-only, bounded and heuristic. Legitimate dialogs can be flagged. No detector output guarantees a clear page.

Filtering can change layouts and hide notices that a caller wants to preserve. Use raw capture when preserving page content takes priority.

## Errors and resource limits

Invalid URLs/options/JSON return 400; JSON over 16 KB returns 413. Target HTTP errors or capture failures return 502. Missing, invalid or failed AdGuard setup returns 503 (`CLEANUP_UNAVAILABLE`), with no silent raw fallback. Capacity exhaustion returns 503. The capture deadline defaults to 30 seconds (configurable with `timeout` up to 90 seconds). Browser launch is at most 10 seconds and navigation at most 15 seconds, both bounded by the total deadline; timeouts return 504.

The default service permits one active capture. Raw captures reuse a browser with a fresh context per request. Cleanup uses a new persistent profile and browser per request, and closes/removes them afterward. No AdGuard worker is kept idle or reused after visiting a website.

This is a trusted local development API, not public hosting: authentication, outbound network isolation and abuse controls are not implemented. The remaining dependency advisory and deployment limitations are documented in the [dependency review](dependency-audit.md).

## Error responses

Errors return JSON instead of an image:

```json
{"error":{"code":"UPSTREAM_HTTP_ERROR","message":"The target page returned HTTP 403.","upstreamStatus":403}}
```

Upstream HTTP failures include `upstreamStatus`. Explicitly identified browser-verification challenges also include `reason:"browser-verification"`. Check the HTTP status or curl exit status before opening the saved body as an image.
