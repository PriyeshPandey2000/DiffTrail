# Filter snapshot

These are maintained **AdGuard** filter lists, processed by DiffTrail's generic
action policy. No website-specific rules have been added by DiffTrail.

- `upstream/*.txt.gz`: exact downloaded source, including original attribution.
- `*.txt.gz`: filtered rules used by the experimental library adapter.
- `manifest.json`: upstream URLs, versions, dates, source/output SHA-256 hashes,
  policy inventory and combined version.
- `LICENSE-AdGuard.txt`: upstream GNU GPL version 3 license. Attribution and
  license apply to the bundled upstream lists and filtered derivatives.

Sources: [AdGuardFilters](https://github.com/AdguardTeam/AdguardFilters), published
Chromium filters 18 (cookies), 19 (popups), 22 (widgets/chat) and 2 (ads).
The widget list includes more than chat, so a future `chat` API option still
needs a scope/coverage decision before exposing this mapping to users.

`filter-policy.js` keeps plain cosmetic hides and their exceptions. It drops
scriptlets, arbitrary styles, procedural/extended selectors and HTML filtering.
Cookie, popup and widget categories drop network rules. The ads category also
keeps ordinary network rules, excluding response/URL rewriting modifiers.
This is intentionally a smaller action set than the full extensions.

Run `npm run filters:rebuild` to reproduce the filtered output offline from the
included sources. Run `npm run filters:update` to explicitly download new
versions; review the manifest and rerun tests afterward. No request-time fetch
or automatic background update exists. The library adapter validates hashes
before parsing the selected snapshots.

These filtered snapshots now belong to the retained Ghostery experiment, not the default API runtime. The API uses the pinned official AdGuard assets built by `npm run setup:adguard`. See `docs/adguard-headless.md` for current implementation status.
