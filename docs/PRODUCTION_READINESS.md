# Beverly Call: production readiness

Last verified: 2026-11-16, at commit `8db7c82` plus the commit that adds this file. Everything under "Verified" was run or observed on that date; everything under "Not verified" was not, and is listed so nobody assumes it was.

## Verdict
The code is in good shape and the checks below pass. It is **not yet proven live**: production configuration, scheduled jobs and the carrier cannot be verified from a development machine, and three features are not built. Do the blockers, then run the smoke test at the bottom on the deployed site.

## Verified
| Check | Result |
|---|---|
| Typecheck (`pnpm typecheck`) | 0 errors |
| Production build (`pnpm build`: serverless API bundle and web) | passes |
| Tests (`pnpm test`) | 228 API tests (13 files, including the route access matrix and hardening tests) and 19 web tests pass |
| Dependency audit (`pnpm audit --prod`) | no known vulnerabilities |
| Real database over the read views | all views installed, including `tariffs`: 7,607 customers, 111 linked meters, 160 wallets, 12,999 purchases, 19 staff, 11 roles; 24 `call_centre` tables |
| Real API | `/api/health` ok; a real super admin signed in and the live audit log (32 entries) pages, searches and resizes correctly |
| API probes (earlier run) | security headers present; every protected route 401 without a session; cross-origin writes 403; webhook without secret 401; malformed JSON 400; unknown route 404 |
| UI crawl (earlier run, seeded admin on a mock) | 15 routes, no console errors, no failed requests, no horizontal overflow at phone width |

## Fixed during the audit
| Severity | Finding | Fix |
|---|---|---|
| High | Login rate limit could be bypassed: any `X-Forwarded-For` was trusted (12 spoofed attempts all got through). | Only the proxies we run are trusted: `TRUST_PROXY_HOPS`, default 1. Test covers it. |
| High | `zod` 3.x advisory (GHSA-mrhx-c7xc-m3w5). | Upgraded to zod 4.6.x. |
| Medium | Session cookie was signed, not encrypted, so the Beverly token inside was readable by the cookie holder. | A256GCM-encrypted session. |
| Medium | 5xx replies could carry internal error text. | Fixed message for 5xx, detail goes to the log only. |
| Medium | Carrier webhook secret (`?secret=`) was written to request logs. | Query secrets are redacted in logs. |
| Low | 1 MB default body limit. | 256 KB. |
| Functional | Admin console got 403 on `GET /api/callbacks`. | Admins may read the queue (read-only). |
| Config | Weak CSP, no HSTS or COOP/CORP. | Tightened in `vercel.json`. |
| Config | Half-configured production deploys. | `scripts/check-deploy.mjs` now refuses a production build unless `DATABASE_URL`, `BEVERLY_AUTH_URL`, `BEVERLY_AUTH_ANON_KEY`, `BEVERLY_API_URL`, `SESSION_SECRET` (32+ chars) and `CRON_SECRET` (16+ chars) are set. |
| Operations | Audit log showed only the latest 50 rows. | Server-side pagination and search (`GET /api/audit?page&pageSize&q`), shown as a table or cards. |

## Deployment shape (as built)
Static web app plus the API as one Vercel Function (`api/index.mjs`, 30 s limit) in the same project, so the session cookie is first-party. `/api/*` is rewritten to the function. `ALLOWED_ORIGIN` and `API_PUBLIC_URL` default to the Vercel URL unless set; set them explicitly if you use a custom domain.

## Blockers (need your access or input)
1. **Production environment variables in Vercel.** The five required by the build guard above plus `CRON_SECRET`, and the optional ones you use: `AT_WEBHOOK_SECRET`, `AT_API_KEY`, `AT_USERNAME`, `AT_VIRTUAL_NUMBER`, `RECORDINGS_STORAGE_URL`, `RECORDINGS_STORAGE_KEY`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `TRUST_PROXY_HOPS` (1 behind Vercel). Your local `.env` still has `NODE_ENV=development` and lacks `CRON_SECRET`, `API_PUBLIC_URL` and the three `AT_*` carrier keys; production values live in Vercel and were not checked.
2. **Scheduled jobs (done).** `vercel.json` runs `ingest` and `sweep` every minute and `purge` (02:00) and `verify-audit` (02:30) daily through `GET /api/cron/:job`. The Vercel team is on the Pro plan, which allows per-minute crons. Crons only run on production deployments.
3. **Carrier.** Africa's Talking credentials, virtual number, and callback URLs pointing at the production `API_PUBLIC_URL`.
4. **Recordings in SharePoint (done in code, verified live).** Recordings are stored in the SharePoint site in `SHAREPOINT_SITE_ID` (library folder `call-recordings`), through Microsoft Graph with `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`. A real upload, download and delete, including a 9 MB file through an upload session, passed against the site. Download links are Microsoft pre-authenticated links of about an hour, not 5 minutes. The Supabase bucket is only a fallback when the four settings are absent. Confirm with your Microsoft admin that the app has the narrowest permission (`Sites.Selected` with write access to this one site) rather than `Sites.ReadWrite.All`.

## Install and push (built and verified)
- **Installable.** Web manifest, 192, 512 and maskable icons, Apple touch icon and a service worker registered at start-up. Real Edge's own installability audit reports no problems; the Settings panel's App section shows Install, Installed, or the exact steps for iPhone and iPad.
- **Alerts with the app closed.** Web Push with server VAPID keys (set in Vercel Production). Each device's mute and sound choices are saved on the server, so muted categories and silenced devices are honoured while the app is not running. A person's alerts stop on a device at sign-out and are not given to the next person who signs in there.
- **Incoming calls.** A ringing call is pushed as an urgent alert: it cannot be muted, lives for 30 seconds, stays on screen until tapped, vibrates, replaces the previous ring, and opens the call screen. Verified by delivering real pushes to the service worker in Edge.
- **Not possible yet: audio in the background.** The call itself is dialled to a browser WebRTC client, and the browser softphone is not built. A closed or backgrounded app can alert and open the call screen, but cannot carry the audio. That needs the softphone built against Africa's Talking's browser SDK and a sandbox test, or forwarding calls to the agent's own phone number.
- **Needs applying:** `db/baseline/20261117110000_call_centre_push_prefs.sql` (adds per-device mute and sound columns to `push_subscriptions`) must be applied in the Beverly project before push preferences can be saved.

## Decisions and risks
- **Rate limiting is per function instance.** `@fastify/rate-limit` uses its in-memory store. On Vercel each instance counts separately, so the 8 per minute login limit is approximate. For a hard limit use a shared store (for example Upstash Redis).
- **Station scope.** `CALL_STATION_SCOPE` is unset, so it defaults to `off`: every agent can search every customer. Set `on` if agents should only see their own stations.
- **8-hour sessions cannot be revoked server-side.** Logout clears the cookie, but a stolen cookie works until it expires. Consider a shorter lifetime for admins.
- **Beverly token lifetime.** The Beverly access token inside the session may expire before 8 hours. The default database read mode does not depend on it.

## Not built (per `ARCHITECTURE.md`)
- Browser softphone bound to the carrier SDK.
- Supervisor listen, whisper and barge media bridge (recorded and audited only).
- Real queue routing and agent dialling: inbound calls get a hold message until calls are assigned to agents.
- Load test.

## Not verified
- The deployed production site (no production URL was exercised).
- Calls, SMS, recordings and ratings end to end through the carrier.
- Agent and supervisor screens against real data (the click-through used a seeded admin on a mock).
- The Dockerfile in `apps/api` (the Vercel deployment does not use it), backups and restore, uptime monitoring.

## Smoke test after deploy
1. `GET /api/health` returns `{"status":"ok"}`.
2. Sign in as the super admin, an agent and a supervisor; each lands on its own screen and cannot open the others' routes.
3. Admin → System: connections show Connected, retention shows On schedule, the audit log loads and Verify reports an intact chain.
4. Place a test call and confirm it appears in the pipeline, then check the recording appears (needs the `ingest` schedule).
5. Trigger `GET /api/cron/purge` with the bearer secret and confirm a 200 with a result.
