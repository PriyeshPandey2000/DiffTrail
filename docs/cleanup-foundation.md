# Cleanup implementation status

The initial foundation and restricted Ghostery/AdGuard-list experiment are retained for regression testing. That candidate supported ordinary cosmetic rules, protected-content checks, visible frames, open shadow DOM and a residual detector. It was not proven equivalent to the AdGuard extension.

Following the updated direction, the screenshot API now uses **AdGuard’s official MV3 API in headless Chromium** for requested cleanup. It uses the pinned extension’s full compiled assets, including maintained scriptlets and extended CSS. No custom website rules were added.

The endpoint supports raw capture, the `standard` cookie/popup preset, the `all` preset and individual upstream categories. AI and separate consent-rejection automation remain off. Native cookie rules may interact with consent dialogs; strict hide-only semantics are no longer claimed.

Cleanup workers start on demand with a fresh persistent profile per capture and are destroyed afterward. One active capture is allowed by default. There is no idle pool. Raw captures retain their reusable browser and fresh-context model.

Implementation and reproducible measurements are described in [headless AdGuard findings](adguard-headless.md). [README](../README.md) has setup and curl instructions.

Remaining product work includes dedicated consent rejection, optional bounded AI fallback, additional screenshot formats/options, and production hosting protections. The live sample is one desktop host/IP and does not establish broad reliability or a universal blocker ranking.
