# DiffTrail — Website Screenshot API

Capture website screenshots as PNG, JPEG, or WebP through a local HTTP API. DiffTrail supports full-page screenshots, CSS element capture, rectangle cropping, and configurable cookie-banner, popup, and ad blocking.

Built with TypeScript, Playwright, and AdGuard. Runs in headless Chromium by default.

## Features

- Viewport, full-page, element, and rectangle screenshots.
- PNG, JPEG, and WebP output with quality controls for JPEG and WebP.
- Custom viewport sizes and pixel density from 1× to 5×.
- Mobile and tablet device presets, dark mode, custom user agent, locale, and time zone.
- Cookie-banner, popup, ad, and other filtering categories.
- Page readiness controls: selector waits, delays, and lazy-load scrolling.
- Capture and cleanup metadata in response headers.

## Quick start

Requires Node.js 22.18+, npm 10.9.11, and `unzip`.

```sh
git clone https://github.com/PriyeshPandey2000/DiffTrail.git
cd DiffTrail
npm ci
npm run setup:adguard
cp .env.example .env
npm start
```

The API listens at `http://127.0.0.1:3000`. Set `PORT` in `.env` to change the port. For captures without filtering, replace `setup:adguard` with `setup:browser`.

On Linux, install Chromium's system dependencies before starting:

```sh
npm exec --workspace=server -- playwright install --with-deps chromium
```

Windows users can run these commands in WSL2.

## Take a website screenshot

Send a JSON body to `POST /api/screenshot`. The response contains the image bytes.

```sh
curl --fail-with-body http://127.0.0.1:3000/api/screenshot \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://example.com","cleanup":"standard"}' \
  --output screenshot.png
```

Open `screenshot.png` in your image viewer. On macOS, run `open screenshot.png`. Errors return JSON; only open the output as an image if curl succeeds.

Defaults: PNG, a 1920×1080 CSS viewport, 2× density, and a 30-second request deadline. Cleanup is off unless requested. The default output size is 3840×2160 pixels.

Use the following JSON bodies with the same endpoint. Match the output filename to the requested format.

### Full-page screenshots

```json
{"url":"https://example.com","fullPage":true,"maxHeight":6000,"cleanup":"standard"}
```

Full-page mode scrolls automatically to trigger lazy-loaded content. Use `scroll:false` to disable it. `maxHeight` caps the height in CSS pixels; format and output-pixel limits also apply. A limited capture reports `X-DiffTrail-Truncated: true`.

### Capture an element

```json
{"url":"https://example.com","selector":"h1","cleanup":"standard"}
```

`selector` captures the first matching CSS element, scrolling it into view if needed. Use a selector from the page source or browser DevTools. Missing or hidden targets return an error instead of a viewport screenshot.

### Crop a rectangle

```json
{"url":"https://example.com","clip":{"x":100,"y":100,"width":600,"height":400}}
```

Coordinates are CSS pixels from the document's top-left. This rectangle produces a 1200×800 image at the default 2× density. `selector`, `clip`, and `fullPage:true` cannot be combined.

See [element and rectangle capture](docs/api.md#element-and-rectangle-capture) for bounds, nested scrolling, and selector support.

### Choose format, size, and density

```json
{"url":"https://example.com","format":"webp","quality":75,"viewport":{"width":1280,"height":720},"scale":1}
```

Use `format:"jpeg"` for JPEG output. `quality` applies only to JPEG and WebP. `scale:1` produces one image pixel per CSS pixel; `scale:2` (the default) doubles each output dimension without changing the CSS viewport. `scale` accepts any number from 1 to 5.

### Take a mobile screenshot

```json
{"url":"https://example.com","device":"iphone_15","colorScheme":"dark","locale":"de-DE","timezone":"Europe/Berlin"}
```

`device` sets the viewport, pixel density, touch support, and user agent of a phone or tablet. `GET /api/devices` lists the presets. See [device and browser emulation](docs/api.md#device-and-browser-emulation) for all options.

### Wait for dynamic content

```json
{"url":"https://example.com","waitUntil":"domcontentloaded","waitForSelector":"h1","delay":500,"timeout":60000}
```

Durations are in milliseconds. `waitUntil` also accepts `load` (the default) and `networkidle`. `waitForSelector` waits for visibility but does not crop the screenshot; use `selector` to select the output area. Captures also briefly wait for relevant images. See [loading controls](docs/api.md#loading-controls) for scrolling options and timeout behavior.

## Block cookie banners, popups, and ads

Filtering uses maintained AdGuard rules and requires no API key.

| `cleanup` | Behavior |
| --- | --- |
| Omitted or `"none"` | Capture without filtering; the default. |
| `"standard"` | Enable cookie-banner and popup filters. |
| `"all"` | Enable all supported filter categories. |
| An object | Enable individual categories; omitted categories are off. |

For example, enable cookie, popup, and ad filters:

```json
{"url":"https://example.com","cleanup":{"cookies":true,"popups":true,"ads":true}}
```

| Without filtering | `cleanup:"standard"` |
| :---: | :---: |
| <img src="docs/images/trustarc-raw.png" width="400" alt="Website screenshot of TrustArc with a cookie banner"> | <img src="docs/images/trustarc-standard.png" width="400" alt="Website screenshot of TrustArc with the cookie banner removed by DiffTrail"> |

Filtering varies by site and can change page content or layout. AdGuard's cookie rules can interact with consent banners. See the [API reference](docs/api.md) for all categories and response metadata.

## Documentation

- [API reference](docs/api.md): request options, defaults, headers, errors, and limits.
- [Element and rectangle capture](docs/api.md#element-and-rectangle-capture).
- [Loading controls](docs/api.md#loading-controls).
- [Device and browser emulation](docs/api.md#device-and-browser-emulation).
- [Deployment notes](docs/api.md#errors-and-resource-limits): the server currently binds to loopback for local use.

## Development

```sh
npm run dev              # Run TypeScript source with file watching
npm run typecheck        # Check source and test types
npm run build            # Compile the server
npm test                 # Run local fixture tests
npm run test:adguard      # Run fixtures including native AdGuard checks
npm run audit:dependencies
```

Run `npm run setup:adguard` before native integration tests. To inspect captures in a visible browser:

```sh
DIFFTRAIL_HEADLESS=false npm start
```

Contributions are welcome. Follow [AGENTS.md](AGENTS.md) for checks and pull request conventions.
