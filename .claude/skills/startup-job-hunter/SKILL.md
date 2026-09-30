---
name: startup-job-hunter
description: Find and vet software-engineering jobs at startups (recently funded or not) that are open to a full-stack engineer in India (remote, hybrid, or office). Verifies live openings and India eligibility, tracks a pipeline, and finds product friction/OSS contributions to strengthen applications. Use when asked to find startup jobs, run the daily job report, vet a company or job link, or follow up the pipeline.
---

# Startup Job & Contribution Hunter

## Objective
Build and maintain a large pipeline of **realistic, verified** engineering openings for a ~2.5-year full-stack engineer in India, then convert a subset into applications backed by proof of ability (bug report, PR, prototype, sharp product observation).

Breadth first, depth only after qualification. Volume matters, but **never pad the list with unverified or ineligible jobs to hit a number.** If only 4 real jobs exist today, report 4.

## Candidate profile
- 2.5+ years, full-stack.
- Core: TypeScript, JavaScript, React, Next.js, Node.js, NestJS, PostgreSQL, Redis, Docker, Kubernetes, GCP.
- Also: Rust, Tauri, desktop apps, AI products, scraping/distributed systems, queues/workers, browser automation, SaaS.
- Target roles: Full Stack, Software Engineer, Product Engineer, Frontend, Backend, Developer Tools; AI Engineer / Platform Engineer only if the experience bar is realistic.
- Experience fit: ideal 1–4 yrs; 2–5 yrs fine; 0–2 yrs OK if the stack matches strongly; 4–5 yrs OK for a strong match. Reject roles needing substantially more (roughly 6+) unless the company is unusually relevant.

## Rule 1: India eligibility (most important filter)
Read the **actual current job posting**. It overrides the careers-page blurb, old LinkedIn posts, blog posts, tweets, and job-board copies.

Classify every job as exactly one:
| Label | Meaning | Pipeline |
|---|---|---|
| **India remote** | Says India remote / remote in India / APAC incl. India / global incl. India | Main |
| **India hybrid/office** | Names an India city (Bengaluru, Delhi NCR, Mumbai, Hyderabad, Pune, Chennai, etc.) | Main |
| **India relocation** | Company explicitly offers relocation/visa support to a non-India location | Separate list |
| **India eligibility unclear** | "Global remote" or "remote" with no country/timezone detail | P3 only. Never assume yes. |
| **Excludes India** | US/Canada/EU/UK/Americas-only, or timezone/legal-entity requirements India can't meet | Reject |

Also check: required timezone overlap, whether the company can legally employ in India (EOR/entity) when stated, and salary currency/range if shown.

## Rule 2: Verify the job is live
Every actionable job needs: company, exact title, exact URL, status, India label, experience requirement, key tech requirements, remote/hybrid/office.

- Prefer the company's own ATS or careers page: Greenhouse, Lever, Ashby, Workable, Rippling, Recruitee, Notion/careers pages.
- Fetch the posting itself. If it 404s, says closed, has no apply button, or the only evidence is a third-party aggregator, mark **`Stale / verify before applying`** and do not put it in "Apply Now".
- Record the date you verified. If you could not open the page, say so. **Never invent or guess URLs, funding amounts, team sizes, or dates.** Unknown = write `Unknown`.

## Company filters (need a plausible combination, not all)
Real opening · India eligibility · stack match · testable product · sane experience bar · small/mid team · evidence of active hiring · founder/engineer access · OSS or contribution angle · interesting problem · recent funding.

- **Funding** is a positive signal, not a requirement. Prefer raised in last 12–18 months (seed/A/B) or announced hiring/expansion. Also include bootstrapped, profitable, older-funded, and undisclosed. Never drop a good job only because funding can't be verified. Cite the source for any funding claim.
- **Size** is a prioritization factor. Best: 5–50. Also good: 50–250. OK: 250–500. Lower priority: 500+.
- **Fame**: favor lesser-known, niche, founder-led, technical companies over YC/LinkedIn household names. Do not claim "low competition" without evidence; say "lesser-known", "small team", "early-stage", "niche" instead. Famous companies are fine when India eligibility is confirmed and the fit is strong.

## Where to search
Use several sources; no single source is trusted alone.
1. Official careers pages and ATS boards (Greenhouse, Lever, Ashby, Workable). Search e.g. `site:jobs.ashbyhq.com "India" "full stack"`, `site:boards.greenhouse.io "Bangalore" "Node.js"`, `site:jobs.lever.co India engineer`.
2. Wellfound, YC Work at a Startup, Hacker News "Who is hiring" threads, Peerlist, Cutshort, Instahyre, LinkedIn Jobs, Himalayas, Remotive, Remote-first boards filtered to India/APAC.
3. Funding news: Entrackr, Inc42, YourStory, TechCrunch, Crunchbase News, company blog/press posts. Use these to find *recently funded* companies, then go to their real careers page.
4. GitHub: org repos with `good first issue` / `help wanted`, recent commit activity, "we're hiring" in READMEs.
5. X/Twitter and LinkedIn posts by founders/CTOs announcing hiring or funding. Note: these are often **not fetchable** by the agent. Use web search to surface them (e.g. `"we're hiring" founding engineer India site:x.com`) and treat any post as a lead only. Always confirm on the actual job page. If a post can't be opened, say so.

## Priority levels
- **P0 Apply now**: India eligibility confirmed, live posting verified, experience matches, strong stack match, product testable, contribution/outreach angle exists.
- **P1 Strong target**: India confirmed, live, good match, contribution angle not yet investigated.
- **P2 Outreach**: no perfect open role, but strong match, India presence confirmed, accessible founder/eng team.
- **P3 Watchlist**: relevant company, India unclear or role closed, future hiring plausible. Keep this a small share of the report.

Rank by objective factors only, in this order: eligibility → live opening → role/experience match → contribution opportunity → evidence quality → recency.

## Product investigation (only after a company is qualified)
Goal: understand one real user workflow and find meaningful friction. Not "find a bug".
- Pick the core workflow and complete it end to end (signup → onboarding → first success; create → edit → save → reopen; upload → process → export; connect integration → sync → disconnect; etc.).
- Use only your own free/trial account and normal product use. **No security probing, fuzzing, load testing, scraping behind auth, or accessing others' data.** If you find a real security issue, stop and report it privately per their disclosure policy; don't publish it.
- Look for: unnecessary steps, confusing state, unclear/missing error handling, data-loss risk, silent failures, stale UI, duplicate actions, bad empty states/onboarding, mobile/a11y issues, unclear docs, API/SDK mismatches. Report performance only with observable evidence.

Classify every finding:
1. **Confirmed bug**: reproduced.
2. **Workflow friction**: works, but costs effort or confuses.
3. **Improvement opportunity**: reasonable enhancement.
4. **Hypothesis**: not reproduced. Never call it a bug.

Each finding needs: expected vs actual, steps, environment (browser/OS/version), frequency, screenshot/video when useful, existing GitHub issue if any, why it matters. **Never manufacture a problem.** No finding is fine; say so.

For open-source companies also check: open issues, `good first issue`, `help wanted`, doc gaps, missing tests, small features, reproducible bugs. Read CONTRIBUTING.md and comment on the issue before opening a large PR.

Contribution preference: small useful PR > reproducible bug report > test/docs fix > small prototype > detailed product observation. Don't burn hours hunting for a PR; a good observation still counts.

## Contact strategy
| Company size | Contact |
|---|---|
| 5–30 | Founder, CTO, founding engineer |
| 30–100 | Engineering lead, hiring manager, CTO |
| 100–300 | Hiring/engineering manager, recruiter, relevant senior engineer |
| 300+ | Hiring manager, recruiter, relevant team |

Only name a contact you actually found (link the profile). Never guess emails. Don't send a tiny UI issue to a large company's CEO.

Outreach = short (under ~100 words): I used the product → I found X specifically → I reproduced it / here's the PR, report, or demo → I'm applying for [role, link]. No generic praise, no giant unsolicited audits. Apply through the official channel too; outreach supplements the application, it doesn't replace it.

## Pipeline & duplicates
Statuses (one per company): DISCOVERED → QUALIFIED → PRODUCT TO TEST → INVESTIGATING → ISSUE FOUND → PR/REPORT READY → CONTACTED → APPLIED → INTERVIEW → REJECTED / CLOSED / WATCHLIST.

- Keep the pipeline in a file (default `pipeline.md` or `pipeline.csv` in the working folder; create it if missing). Columns: company, role, URL, India label, experience, priority, status, last verified date, contact, next action, notes.
- **Read it before adding anything.** If the company exists, update its row (new jobs, eligibility change, funding, GitHub activity, new contribution angle). No duplicates.
- Each run also re-checks existing rows: job still live? reopened? eligibility changed? new roles? replies needing follow-up? Suggest a follow-up after ~5–7 days without a reply.

## Daily run targets (aims, not quotas)
- Ideal: 15–25 companies/jobs screened, 5–10 highly actionable, 3 worth deeper product investigation.
- Never lower verification standards to hit these. Report the real counts.
- Spend most effort on breadth. Don't sink a run into one company unless the opportunity is unusually strong.

## Output format
Start with a 3-line summary: new count, updated count, top action for today.

Per actionable company:
```
### Company: <name>  [P0/P1/P2/P3]  status: <STATUS>
- Website:
- Size: (source / Unknown)
- Funding: (amount, source / Unknown)   Funding date:
- India eligibility: <label>   (quote the posting's wording)
- Role: <exact title>   URL: <exact URL>   Verified: <date> / Stale
- Experience:   Stack:   Remote/hybrid/office:
- Why it qualifies: 1–2 lines
- Product to test: the key workflow
- Findings: [Confirmed bug | Friction | Improvement | Hypothesis | OSS issue] with evidence
- Contribution path: PR / issue / prototype / report
- Contact: name + link, or team
- Next action: one concrete step
```
For large batches, use a compact table for P2/P3 rows and full cards only for P0/P1.

End every report with:
- **Apply Now**: verified-live roles with confirmed India eligibility.
- **Investigate**: products worth testing.
- **Contribute**: credible PR/bug/OSS opportunities.
- **Watch**: not yet actionable.
- **Rejected today** (one line each, with reason: excludes India, stale, over-experienced). This proves the filter works and prevents re-checking.

## Core loop
DISCOVER MANY → VERIFY JOB → FILTER FOR INDIA → APPLY → USE PRODUCT → FIND REAL FRICTION → CREATE EVIDENCE → CONTACT TEAM → CONTRIBUTE IF POSSIBLE → MOVE ON.

Apply first; investigation is an accelerator, not a gate. Do not wait for a PR before applying to a P0 role.
