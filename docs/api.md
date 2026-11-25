# Screenshot API

`POST /api/screenshot` accepts a JSON object and returns PNG bytes. The server listens at `http://127.0.0.1:3000` by default.

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

Images are 3840×2160 PNGs from a 1920×1080 viewport at 2× density. Full-page capture and other formats are not implemented yet.

## Result headers

Responses use `Content-Type: image/png` and `Cache-Control: no-store`.

- `X-DiffTrail-Cleanup`: `skipped` for raw capture; `enabled` when AdGuard was initialized and no residual signal was detected; `partial` when filtering ran but suspected/unknown/blocked UI remains.
- `X-DiffTrail-Residual`: `not-checked` in raw mode; otherwise `none-detected`, `suspected`, `unknown` or `blocked`.
- `X-DiffTrail-Rules-Version`: the verified local build fingerprint, or `none`.
- `X-DiffTrail-Metadata`: JSON containing the engine, categories, filter IDs, SDK/reference versions, setup/capture times, residual signals, consent behavior and `aiUsed`.

`enabled` does not mean every banner was removed. The official SDK does not supply a verified count of hidden elements; `hidden`, `guarded` and `blockedRequests` are `null` rather than invented counts. Residual detection is read-only, bounded and heuristic. Legitimate dialogs can be flagged. No detector output guarantees a clear page.

Filtering can change layouts and hide notices that a caller wants to preserve. Use raw capture when preserving page content takes priority.

## Errors and resource limits

Invalid URLs/options/JSON return 400; JSON over 16 KB returns 413. Target HTTP errors or capture failures return 502. Missing, invalid or failed AdGuard setup returns 503 (`CLEANUP_UNAVAILABLE`), with no silent raw fallback. Capacity exhaustion returns 503. The capture deadline is 30 seconds, browser launch at most 10 seconds and navigation at most 15 seconds; timeouts return 504.

The default service permits one active capture. Raw captures reuse a browser with a fresh context per request. Cleanup uses a new persistent profile and browser per request, and closes/removes them afterward. No AdGuard worker is kept idle or reused after visiting a website.

This is a trusted local development API, not public hosting: authentication, outbound network isolation and abuse controls are not implemented. The remaining dependency advisory and deployment limitations are documented in the [dependency review](dependency-audit.md).

## Error responses

Errors return JSON instead of an image:

```json
{"error":{"code":"UPSTREAM_HTTP_ERROR","message":"The target page returned HTTP 403.","upstreamStatus":403}}
```

Upstream HTTP failures include `upstreamStatus`. Explicitly identified browser-verification challenges also include `reason:"browser-verification"`. Check the HTTP status or curl exit status before opening the saved body as an image.
