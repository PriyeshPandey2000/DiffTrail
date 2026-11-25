# Official AdGuard MV3 API experiment

This is a small adaptation of AdGuard's official
[MV3 example](https://github.com/AdguardTeam/tsurlfilter/tree/master/packages/examples/adguard-api-mv3),
based on upstream commit `7f665f06297dfaf9609512952970895729afcaa2`,
using the published `@adguard/api-mv3@3.0.0` and the pinned AdGuard 5.5.4.55
extension's own compiled filter/redirect/local-script assets.

The example's demo custom rules, allowlists, assistant UI and two-minute stop
are omitted. Our code adds readiness/configuration messages, restricted to
extension pages. It adds no rules for websites and makes no AI calls.

The modified example source is GPL-3.0-only; the license is included here.
The installed AdGuard libraries and bundled assets retain their own licenses.
This is not the consumer extension and does not prove equal behavior by itself.

The official SDK is a development/experiment dependency. `npm audit` currently
reports advisories in its Zod/JS-YAML dependency graph; no automatic major-version
substitution was applied to the SDK. A browser build bundles code from those
dependencies even though the package is marked development-only. The current
loopback development API is not a production deployment/security assessment.
