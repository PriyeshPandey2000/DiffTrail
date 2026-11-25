# DiffTrail

DiffTrail is a local screenshot API built with TypeScript, Playwright, and AdGuard. Capture a webpage as a PNG, with optional filtering for cookie banners, popups, ads, and other recurring UI.

## Features

- Capture URLs as 3840×2160 PNGs.
- Choose raw screenshots, cleanup presets, or individual filter categories.
- Run headless or open a visible browser for debugging.
- Inspect cleanup status, residual UI signals, and timings in response headers.
- Isolate cookies and storage between captures.

Cleanup uses bundled, maintained AdGuard filters. No API key is required.

## Getting started

Requirements: Node.js 22.18+, npm 10.9.11, and `unzip`.

```sh
npm ci
npm run setup:adguard
cp .env.example .env
npm start
```

The API runs at `http://127.0.0.1:3000`. Set `PORT` in `.env` to change the port. Setup installs Chromium and builds the bundled filtering runtime. For raw screenshots only, use `npm run setup:browser` instead.

On Linux, install Chromium’s system dependencies with:

```sh
npm exec --workspace=server -- playwright install --with-deps chromium
```

Windows contributors can use WSL2.

## Take a screenshot

```sh
curl --fail-with-body http://127.0.0.1:3000/api/screenshot \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://example.com","cleanup":"standard"}' \
  --output screenshot.png
```

Open `screenshot.png` in your image viewer (`open screenshot.png` on macOS). Errors return JSON, so check that curl succeeded before opening the file.

### Cleanup options

| `cleanup` | Behavior |
| --- | --- |
| Omitted or `"none"` | Raw screenshot; this is the default. |
| `"standard"` | Cookie-banner and popup filters. |
| `"all"` | All supported filter categories. |
| An object | Enable specific categories; omitted categories are off. |

```json
{"url":"https://example.com","cleanup":{"cookies":true,"popups":true,"ads":false}}
```

Filtering can change page content and layout. AdGuard’s cookie rules can interact with consent banners. Coverage varies by website.

See the [API reference](docs/api.md) for all categories, response headers, errors, and resource limits.

## Development

```sh
npm run dev              # Watch and run TypeScript source
npm run typecheck        # Check source and test types
npm run build            # Compile the server into apps/server/dist
npm test                 # Build and run local fixture tests
npm run test:adguard     # Include native AdGuard integration tests after setup
npm run audit:dependencies
```

`npm start` builds and runs the compiled server. GitHub Actions runs type checking, compilation, the dependency audit, and fixture and native integration tests.

To debug captures in a visible browser:

```sh
DIFFTRAIL_HEADLESS=false npm start
```

Use [the benchmark guide](docs/benchmarks.md) for manual comparison tooling. Live-site benchmarks are separate from the automated test suite.

## Current scope

DiffTrail currently supports viewport PNG screenshots. Full-page capture, other formats, consent-rejection automation, and AI cleanup are not implemented.

The server binds to loopback and is intended for local development. Public hosting still requires authentication, outbound network isolation, abuse controls, and resolution of the advisory in the [dependency review](docs/dependency-audit.md).

## Contributing

Use TypeScript for server changes, include relevant fixture checks, and follow [AGENTS.md](AGENTS.md) for verification and pull request conventions. Keep generated browser profiles, screenshots, and benchmark artifacts out of commits.
