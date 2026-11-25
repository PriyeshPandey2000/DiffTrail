# Dependency audit — 25 November 2026

The AdGuard SDK dependency graph initially produced nine high-severity npm
audit entries. Those entries included transitive reports of the same underlying
advisories; they were not nine independent flaws.

## Fixed: JS-YAML

AdGuard's scriptlet dependencies pinned JS-YAML 3.14.1. The root package override
selects **3.15.2**, the patched release in the same major version. The lockfile
records it. Rebuild the generated extension after changing dependencies so the
browser bundle also picks up fixes.

The project pins npm 10.9.11. npm 11 can ignore workspace overrides or report
the correctly installed replacement as invalid. CI uses the pinned npm version;
use it when updating the lockfile. The full audit check detects a regression
to the affected JS-YAML version.

Reference: [GHSA-2883-xcg3-v3hh](https://github.com/advisories/GHSA-2883-xcg3-v3hh).

## Unresolved: Zod

AdGuard's published SDK pins **Zod 3.24.4**. Its oversized-array validation issue
is reported fixed in **4.6.6**. Replacing the SDK's validator with a different
major version without upstream compatibility support is not treated as a safe
dependency update.

The HTTP API caps JSON input at 16 KB, accepts only known boolean categories,
and passes a bounded filter-ID list to the extension. The extension restricts
its configuration messages to its own pages and accepts no custom website
rules. These constraints reduce the configuration input exposed by our code;
they do not prove every upstream SDK validation path is unreachable.

The generated browser bundle includes SDK dependencies despite their npm
development-only classification. This advisory remains a **public-deployment
blocker** and is disclosed in the draft PR. It must be revisited when an
upstream SDK fix or a tested compatible migration is available.

Reference: [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5).

## CI policy

`npm run audit:dependencies` checks the full dependency graph. The exact Zod
advisory has a dated, expiring record in `dependency-audit-exceptions.json`.
Any other advisory, an expired exception, or a failed audit request fails the
check. Known unresolved findings remain visible in the output; the check does
not claim the dependencies are vulnerability-free.
