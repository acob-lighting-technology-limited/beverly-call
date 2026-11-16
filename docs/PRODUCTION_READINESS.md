# Beverly Call: production readiness audit

Audit date: 2026-11-16. Scope: code review, black-box probes of the running API, automated crawl of every screen and admin section (local mock, seeded test admin), dependency audit, deployment configuration.

## Verdict
Safe to start operating **once the go-live blockers below are done**. The two high-severity findings from the audit are fixed and covered by tests. Nothing found was a data-exposure bug in the code paths exercised; the open items are configuration, external services and things that cannot be verified from a development machine.

## Fixed in this pass
| # | Severity | Finding | Fix |
|---|---|---|---|
| 1 | High | Login rate limit could be bypassed: the API trusted any `X-Forwarded-For`, so 12 spoofed attempts all reached Beverly sign-in. | Trust only the proxies we run: `TRUST_PROXY_HOPS` (default 1). Test proves spoofing no longer dodges the limit. |
| 2 | High | `zod` 3.x advisory (GHSA-mrhx-c7xc-m3w5, memory exhaustion on oversized collections). | Upgraded to zod 4.6.x. `pnpm audit --prod` is clean and CI now fails on high advisories. |
| 3 | Medium | Session cookie was signed, not encrypted: the Beverly bearer token inside could be read by the cookie holder. | Cookie is now A256GCM-encrypted. Existing sessions are invalidated once at deploy. |
| 4 | Medium | 5xx replies could carry internal error text. | Global error handler returns a fixed message for 5xx and logs the detail. |
| 5 | Medium | Carrier webhook secret (`?secret=`) was written to request logs. | Logger redacts `secret`, `token`, `key`, `apikey` query values. |
| 6 | Low | Request bodies capped at the 1 MB default. | 256 KB cap (all bodies here are small). |
| 7 | Functional | Admin console got HTTP 403 on `GET /api/callbacks`. | Admin may now read the queue (read-only); matrix test updated. |
| 8 | Config | CSP lacked `base-uri`, `object-src`, `form-action`; no HSTS or COOP/CORP. | Added in `vercel.json`. |
| 9 | Config | `vercel.json` pointed `/api` at a placeholder host. | The API now runs as a Vercel Function in the same project (no external host). Production builds fail until the required environment variables are set (`scripts/check-deploy.mjs`). |

## Go-live blockers (need your input or access)
1. **Vercel project environment (Production).** Set `DATABASE_URL`, `BEVERLY_AUTH_URL`, `BEVERLY_AUTH_ANON_KEY`, `BEVERLY_API_URL`, `SESSION_SECRET` and `CRON_SECRET`. The production build refuses to run until they exist. `ALLOWED_ORIGIN` and `API_PUBLIC_URL` default to the production host; set them only for a custom domain.
3. **Production hardening.** The Vercel Function forces `NODE_ENV=production` (Secure cookies). Keep `SESSION_TTL_MINUTES=480` and `TRUST_PROXY_HOPS=1` (the defaults) unless the topology changes, and use a fresh random `SESSION_SECRET` that is not reused anywhere else.
3. **Production environment.** `NODE_ENV=production` (enables Secure cookies), exact `ALLOWED_ORIGIN`, a fresh random `SESSION_SECRET` (32+ chars, not reused), `TRUST_PROXY_HOPS` equal to the proxies in front of the API (Vercel rewrite = 1), `SESSION_TTL_MINUTES=480`.
4. **Carrier.** `AT_WEBHOOK_SECRET`, Africa's Talking credentials and virtual number, callback URLs registered. The carrier sends the secret in the query string, so rotate it on a schedule.
5. **Recordings.** Create the `call-recordings` bucket and set `RECORDINGS_STORAGE_URL` / `RECORDINGS_STORAGE_KEY`.
6. **Scheduler.** Vercel runs `purge` and `verify-audit` daily from `vercel.json` through `GET /api/cron/:job`. `ingest` and `sweep` need to run every minute: use Vercel Pro cron, Supabase Cron or any scheduler calling the same endpoint with the `CRON_SECRET` bearer token. Without them recordings are not ingested and alerts are not raised.
7. **Super admin sign-in.** Confirm on the real project: the user's `public.users` row has `role_key = super-admin` and `portal_access` includes `call`. The API now logs the exact refusal reason.

## Decisions to make
- **Station scope.** `CALL_STATION_SCOPE` defaults to `off`: every agent can find any customer. If agents should only see their own stations, set it to `on` (data-minimisation under NDPA).
- **8-hour sessions have no server-side revocation.** Logout clears the cookie, but a stolen cookie works until it expires. Acceptable for a locked-down desk; for admins consider a shorter lifetime or a revocation list.
- The Beverly access token held in the session may expire before 8 hours (set by Beverly). The default database read mode does not depend on it.

## What was checked
- Typecheck and production build pass. 214 API tests (including the route access matrix and the new hardening tests) and 19 web tests pass (re-run 2026-11-16 after restoring the suite).
- Black-box probes of the running API: security headers present, every protected route returns 401 without a session, cross-origin writes return 403, webhook without secret returns 401, malformed JSON returns 400, unknown route returns 404.
- Crawl of 15 routes (all screens and admin sections) as the seeded test admin, desktop and phone width: no console errors, no failed requests (after fix 7), no horizontal overflow on phones.
- Tap targets under 34px on phones were enlarged to 40px on touch devices.

## Note on tests
The test suite and mock server are kept in the repo and run in CI (`pnpm test`), so the fixes above stay protected by regression tests. An earlier working-tree change removed them at the owner's request; it was set aside in a git stash rather than committed.

## Not verified (cannot be done from a development machine)
- Sign-in and data against the **real** Beverly project (needs a staff password). Agent and supervisor roles were covered by the API access matrix, not clicked through.
- End-to-end telephony: IVR, dialling, recordings ingest, SMS, WebRTC token. The browser softphone and supervisor media bridge are **not built**.
- Playwright e2e (needs a free port 5199 and Edge; run it in CI or locally on a clean machine).
- Docker image build and run, load test, backup and restore drill, uptime and alerting (monitor `GET /api/health`).

## Housekeeping
- CI now runs `pnpm audit --prod --audit-level=high`. Add an e2e job and a Docker build job when a runner with a browser is available.
- The Docker image installs dev dependencies too; add `--prod` to the install once the build is tested.
