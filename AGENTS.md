# Repository instructions

## Pull requests and commits

- Never add model, AI assistant, or coding-agent attribution to PR titles,
  descriptions, comments, or commit messages. Do not add generated-by footers,
  agent signatures, or AI co-author trailers.
- Use a short, specific PR title describing the final change. Start with an
  imperative verb; avoid vague titles, hype, and unnecessary prefixes. Follow
  any established repository convention when one exists.
- Keep the description brief and concrete: explain the problem, resulting
  behavior, relevant checks, and material limitations. Scale detail to the
  change and follow a repository PR template when present.
- Describe the final implementation. Omit conversational history, abandoned
  approaches, generic claims, filler, and AI-style boilerplate.
- Do not claim validation that was not run. Keep local screenshots, response
  headers, generated browser profiles, secrets, and benchmark artifacts out of
  commits. Commit only intended source, tests, configuration, and documentation.

## Verification

- Run `npm test` for local fixture checks.
- Changes to the native AdGuard integration also require `npm run setup:adguard`
  and `npm run test:adguard`; the normal test command skips the native checks.
- Live-site benchmarks are manual evidence, not deterministic CI gates.
