# ITAM: AWS staging readiness report

Branch `security-fixes-on-main` (built on `main` at `580c0e0`; see `git log` for the exact commits). AWS infrastructure and deployment are handled by DevOps; this report covers the application code and what DevOps needs.
Nothing was deployed. No AWS resource was created. No existing database was touched: every database test used a
throw-away `postgres:16-alpine` container, and every test script now refuses a database whose name does not contain
`test`, `check`, `scratch`, `tmp` or `disposable`.

Status words: **VERIFIED** = a command ran in this work and its output is quoted. **NOT VERIFIED** = no evidence yet.

## 1. Final decision

**CONDITIONAL GO.** No application-code blocker is known. What remains is infrastructure and verification work that DevOps owns, listed in section 9 and in the checklist (section 11). Do not call it a full GO: the static site, the CloudFront function and the live-update sockets have been proven against a local stand-in for CloudFront, not against CloudFront itself, and Amazon RDS has not been tested.

| # | Question | Answer |
|---|---|---|
| 1 | Independently deployable without Authify? | **Yes, VERIFIED.** No Authify/SSO code exists in the repository; the API starts, signs in and runs workflows with no Authify configuration (`deploy_readiness_test.py`). |
| 2 | Frontend compatible with S3 + CloudFront? | **Yes in code, VERIFIED locally.** `npm run build:static` produces a valid static site (26 automated checks) and 23 browser checks pass against it behind a stand-in for CloudFront. Real CloudFront behaviours are NOT VERIFIED (section 5). |
| 3 | FastAPI ready for EC2 + Uvicorn + systemd? | **Yes in code and scripts, VERIFIED by simulation** (real process, SIGTERM, restart, release switch, rollback). The unit has not been run under real systemd. |
| 4 | PostgreSQL on Amazon RDS verified? | **PostgreSQL 16 VERIFIED. Amazon RDS itself NOT VERIFIED** (TLS to RDS, parameter group and network path need a real instance). |
| 5 | Critical security issues fixed? | **Yes, VERIFIED** with regression tests, with the limits in section 9. |
| 6 | Existing modules preserved and tested? | **Yes.** No file, route, migration or workflow was removed; all existing suites pass on SQLite and PostgreSQL, and the Docker server mode passes the same 23 browser checks as the static site. |
| 7 | File uploads and persistent storage ready? | **Yes, VERIFIED.** Files are stored in the database (no filesystem path, nothing in release directories). They survive a restart (test). |
| 8 | Environment variables and secrets safe? | **Yes, VERIFIED** (section 7): production refuses unsafe config; no `.env`, AWS key or private key is committed; the static output contains no backend secret or URL. |
| 9 | Critical automated tests passing? | **Yes**, section 3. |
| 10 | Can the AWS staging deployment start? | **Yes, DevOps can start**, following `deploy/ec2/README.md` and `deploy/cloudfront/README.md`, on the conditions in section 9. |

## 2. What changed, by stage

| Stage | Result | Main files |
|---|---|---|
| 1 Discovery | Baseline recorded (section 8). Files in the database; no SSO code; 2 Next.js route handlers and 5 dynamic routes found. | n/a |
| 2 Security | Reporting-user read restriction; Super Admin-only unassigned users; sign-up closed by default (IT Admin, user and Super Admin); health 503. Super Admin key removal (separate commit `ce8b1b8`, droppable). | `access_guard.py`, `users.py`, `auth.py`, `config.py`, `main.py`, register/login/dashboard pages |
| 3 Backend | Production refuses SQLite, unset DATABASE_URL/CORS_ORIGINS, `*`, CHANGE_ME; liveness (`/api/health/live`) vs readiness (`/api/health/ready`, 503 when the database is down; `/api/health` kept as an alias); start/stop logged; background task awaited and pool closed on shutdown. | `config.py`, `main.py`, `access_guard.py` |
| 4 PostgreSQL | `postgres_checks.py`; every suite can run on PostgreSQL; disposable-database guard. | `scripts/postgres_checks.py`, `scripts/_dbguard.py`, `security_test.py` |
| 5 Frontend | **Implemented (approved).** Static build for S3 + CloudFront; Docker and `next dev` unchanged. | `next.config.ts`, `scripts/build-static.mjs`, 5 detail pages (+ `page-client.tsx`), `src/lib/route-id.ts`, `deploy/cloudfront/*` |
| 6 Config | Staging template with placeholders only; template cannot be started as is; committed-secret scan. | `deploy/ec2/itam.env.example`, `deploy_readiness_test.py` |
| 7 EC2 | systemd unit, deploy and rollback scripts, simulated end to end. | `deploy/ec2/*`, `scripts/release_flow_test.py` |
| 8-9 Tests / audit | New suites below; this report. | `scripts/*` |

All 21 changed files: `git diff --name-only 580c0e0..HEAD`.

## 3. Tests: exact commands and results (all run after the last change)

New: `deploy_readiness_test.py` (46), `postgres_checks.py` (32), `release_flow_test.py` (17), the Reporting/unassigned/registration/health/token/CORS sections of `security_test.py`.
Existing and unchanged in meaning: `smoke_test_assets_api.py`, `workflow_test.py`, `ticket_workflow_test.py`, `delete_paths_check.py`. Three existing checks were rewritten because they asserted the old, unsafe behaviour (IT Admin claiming sign-ups; IT Admin notified of sign-ups).

```
cd backend
# SQLite (default)
python scripts/security_test.py            312/312 passed
python scripts/smoke_test_assets_api.py    ALL PASSED
python scripts/workflow_test.py            113/113 passed
python scripts/ticket_workflow_test.py     114/114 passed
python scripts/deploy_readiness_test.py     46/46 passed
# PostgreSQL 16 (empty disposable databases, migrated with `alembic upgrade head`)
SECURITY_TEST_DATABASE_URL=...  python scripts/security_test.py            312/312 passed
SMOKE_DATABASE_URL=...          python scripts/smoke_test_assets_api.py    ALL PASSED
WORKFLOW_DATABASE_URL=...       python scripts/workflow_test.py            113/113 passed
TICKET_DATABASE_URL=...         python scripts/ticket_workflow_test.py     118/118 passed
DELETE_CHECK_DATABASE_URL=...   python scripts/delete_paths_check.py        16/16 passed
POSTGRES_CHECK_DATABASE_URL=... python scripts/postgres_checks.py           32/32 passed
RELEASE_TEST_DATABASE_URL=...   python scripts/release_flow_test.py         17/17 passed
# frontend
npm run lint && npm run typecheck           clean
npx next build (Node server, as Docker)     Compiled successfully
npm run build:static                        Compiled successfully, ./out written
npm run check:static                        26/26 passed  (output, no secrets, CloudFront function vs the build, headers policy vs next.config.ts)
# browser (headless Chrome; scripts/e2e-static.mjs, same script against both modes)
static site behind a CloudFront stand-in    23/23 passed  (/api straight to the backend, no Next.js server)
Docker server mode (localhost:3000)         23/23 passed  (existing workflow unchanged)
```
Failed: none in the final run. Skipped: none. Two Python "Traceback" blocks appear in the output of `security_test.py` and `deploy_readiness_test.py`; they are the server's own log of the deliberate "database unavailable" tests, and both scripts finish passing.
Browser checks by hand (not in a repeatable suite): the Reporting-user dashboard, unassigned sign-ups and the register page (0 failed API calls). `npm run verify` (the project's route-constant check) prints "Route constant missing" lines and exits 1; it does exactly the same on the original `main` (`580c0e0`), so it is a stale check unrelated to this work and was left alone.

Each security fix was checked to fail without the fix (Reporting scope: 12 checks fail; unassigned users: 10; sign-up defaults: 6 with the old defaults; health: the 503 test fails with a 500).

## 4. PostgreSQL migration verification (VERIFIED on PostgreSQL 16.16, disposable container)
27 migrations: one base, one head, no forks, no gaps. `alembic upgrade head` on an empty database; `alembic check` reports no differences between models and migrations; `downgrade base` leaves no application tables; `upgrade head` again works; every model table and foreign key exists; every table has a primary key; `users.email` is unique in the database; a duplicate is refused and rolled back; a multi-row transaction is all-or-nothing; deleting a company that has users is refused; 8 simultaneous sign-ups with one email: exactly one wins; the API in production mode starts against PostgreSQL, the seeded Super Admin signs in, and writes and reads reach it; with PostgreSQL unreachable, production start-up fails instead of using SQLite. Migration history was not edited.
Info: 50 of 113 foreign-key columns have no index. Reads work; index them (additive migration) as tables grow.
**NOT VERIFIED:** Amazon RDS (TLS: use `?sslmode=require` or `verify-full` with the RDS CA bundle; parameter groups; the EC2 to RDS network path; a snapshot/restore drill).

## 5. Frontend: S3 + CloudFront (implemented, approved)
Why the plain export failed, and what was changed (details of each experiment are in the git history of this section):
1. The two Next.js route handlers (`/api/[...path]` proxy, `/api/health`) cannot be exported. They stay in the source (Docker and `next dev` use them); `scripts/build-static.mjs` builds in a throw-away copy without them, so `src/` is never altered. In production CloudFront sends `/api/*` to the API.
2. Five detail pages (`tickets/[id]`, `agent/tickets/[id]`, `assets/[id]`, `users/[id]`, `super-admin/work/[id]`) need pre-built pages but ids are database ids. Each now has a server `page.tsx` with `generateStaticParams()` returning one placeholder id (`_`) and the original page moved to `page-client.tsx`; `src/lib/route-id.ts` reads the real id from the browser address (`useParams()` would report the placeholder). On the Node server every other id is rendered on demand.
3. `next.config.ts`: `STATIC_EXPORT=true` selects `output: "export"` and drops `headers()` (a static host cannot send them); otherwise nothing changed.
4. `deploy/cloudfront/viewer-request.js` (CloudFront Function) maps clean URLs to the static files and every id to the placeholder page.
5. `deploy/cloudfront/response-headers-policy.json`: the exact security headers, kept equal to `next.config.ts` by an automated check.

Evidence (all local): `npm run check:static` 26/26. Browser, 23 checks each, against the static site served through the real function with `/api` going straight to the backend, and against the Docker server mode: `/` lands on sign-in; unknown address answers 404; each role lands in the right place; ticket, asset, user, own-ticket and work pages open by address and after a refresh and ask the API for the real id; `/assets/new` is the "new" page, not an asset; a user cannot open `/users`; no API call failed. Making each check fail on purpose (a removed page in the function, a changed CSP) is caught.
**NOT VERIFIED:** real CloudFront (OAC, the function in the console, response headers policy, behaviours), WebSockets through CloudFront, the TLS origin. Those are DevOps's first tasks; `deploy/cloudfront/README.md` has the exact configuration and a smoke test.
Choices made without asking, easy to revisit: no distribution-wide custom error responses (they would also rewrite the API's 403/404 JSON answers); the API origin must be HTTPS only; `TRUSTED_PROXY_COUNT=2` (CloudFront + the TLS terminator on the instance).

## 6. Backend on EC2 + systemd (VERIFIED by simulation)
`deploy/ec2/itam-backend.service` (one worker, `EnvironmentFile`, journal logging, `SuccessExitStatus=143`), `deploy.sh`, `rollback.sh`, tested in `release_flow_test.py`: fresh deploy; migrations run; configuration outside the release; second deploy keeps the first; `rollback.sh`; a release that does not start rolls itself back and the old one is healthy again; an unsafe configuration is refused (exit 3) before anything changes; the logs hold no secret. SIGTERM ends the process after a graceful shutdown (uvicorn re-raises SIGTERM, so the exit status is -15/143, which the unit treats as success). **Not run:** the unit under real systemd, `journalctl`, Amazon Linux package versions.

## 7. Required staging environment variables (placeholders only; see `deploy/ec2/itam.env.example`)
API (`/etc/itam/itam.env`)
- Required: `ENVIRONMENT=production`, `DATABASE_URL` (PostgreSQL on RDS, with `?sslmode=require`), `JWT_SECRET` (32+ chars), `CORS_ORIGINS=https://<site domain>` (also the allowed `Origin` for WebSockets).
- Needed in practice: `TRUSTED_PROXY_COUNT=2` (CloudFront + the TLS terminator on the instance), `SEED_SUPER_ADMIN_EMAIL` / `SEED_SUPER_ADMIN_PASSWORD` (12+ chars) for the first Super Admin.
- Optional: `ALLOW_PUBLIC_IT_ADMIN_SIGNUP`, `ALLOW_PUBLIC_AGENT_SIGNUP`, `ALLOW_PUBLIC_SUPER_ADMIN_SIGNUP` (all default `false`), `LOG_LEVEL`, `AUTH_RATE_LIMIT_PER_MINUTE`, `LOGIN_FAILURE_LIMIT`, `ACCESS_TOKEN_EXPIRE_MINUTES`, `MAX_REQUEST_BODY_BYTES`, `DB_POOL_SIZE`, `DB_MAX_OVERFLOW`, `WEB_CONCURRENCY` (keep 1).
Frontend build (one variable): `NEXT_PUBLIC_WS_URL=wss://<site domain>` (no path; baked in at build time; no secret belongs here).
Not used with S3 + CloudFront: `BACKEND_API_URL`, `BACKEND_PROXY_KEY`, `PROXY_SHARED_SECRET` (they belong to the Next.js proxy used by Docker and local development).

## 8. Baseline (Stage 1)
Branch `security-fixes-on-main`, commit `ca68a16`, clean working tree, before the readiness work: security 297, smoke pass, workflow 113, tickets 114, delete paths 16 (PostgreSQL). Static-export experiments were done in a separate directory and left the repository untouched.

## 9. Known limitations and remaining blockers
Application-code blockers: none known. Conditions before a real staging deployment is called done (DevOps / verification):
(a) CloudFront configured as in `deploy/cloudfront/README.md` and its smoke test passed (including live updates through CloudFront); (b) the HTTPS API origin (TLS terminator and certificate on the instance) in place; (c) RDS verified with the checks in section 4 against a disposable RDS database, with TLS; (d) the systemd unit run on the real instance and one rollback rehearsed.
Limitations:
- **One instance, one worker.** Sign-in rate limits and WebSocket updates live in process memory; the daily warranty/licence alert job runs inside the API process. More than one instance or worker multiplies limits and sends updates to only some viewers (duplicate alerts are suppressed).
- **No server-side logout.** Tokens are stateless; they stop working on password change, deactivation or expiry (12 hours by default).
- **Reporting users can read `/api/dashboard`** (aggregate counts) so their dashboard works.
- **Super Admin key removed** at your request: Super Admin now signs in with password only. Revert commit `ce8b1b8` if your reviewer wants the key back.
- **Self-signed-up users** wait for the Super Admin (only the Super Admin can place them).
- **Rollback does not undo migrations** (section "Roll back" in `deploy/ec2/README.md`).
- **Case-insensitive email uniqueness** is enforced in code, not by a database index (an index would need a migration; not added).
- Not tested: load, `psycopg2` TLS to RDS, real CloudFront, WebSockets through CloudFront, real systemd.
- `'unsafe-inline'` stays in the CSP for scripts and styles (the exported pages carry Next.js's inline bootstrap); removing it needs a nonce policy, which a static host cannot generate.
- Unknown addresses get S3's own error page (no friendly 404 page), by design: see section 5.

## 10. Deployment and rollback procedure
API: `deploy/ec2/README.md`. Frontend, CloudFront, S3 and the HTTPS origin: `deploy/cloudfront/README.md`. Order: RDS (private) and security groups; instance, TLS terminator and certificate; `/etc/itam/itam.env`; unit file; `deploy.sh <tarball>` (API healthy); S3 bucket; `NEXT_PUBLIC_WS_URL=wss://<domain> npm run build:static`, `npm run check:static`, upload; response headers policy and function; distribution and DNS; invalidation; smoke test. Take an RDS snapshot before any release with a migration. API rollback: `rollback.sh`. Frontend rollback: restore the previous S3 object versions (versioning on) and invalidate.

## 11. Deployment checklist
Application (done in this repository)
- [x] Static build, its checks and the CloudFront function (`npm run build:static`, `npm run check:static`)
- [x] Docker / local development unchanged and tested
- [x] API production safeguards, health endpoints, release scripts, all tests green on SQLite and PostgreSQL 16

DevOps (AWS)
- [ ] RDS PostgreSQL private, security group from the instance only, `sslmode=require` in `DATABASE_URL`, automated backups on; RDS snapshot before the first deploy
- [ ] Instance: Python 3.11+, TLS terminator + certificate for the API origin name, port 443 only from the CloudFront prefix list, `/etc/itam/itam.env` (mode 600) filled, unit installed
- [ ] `deploy.sh` run; `/api/health/ready` returns 200; `journalctl -u itam-backend` clean; seeded Super Admin signs in
- [ ] S3 bucket private + versioned + OAC; `NEXT_PUBLIC_WS_URL=wss://<domain> npm run build:static`; `npm run check:static` 26/26; upload with the cache headers in `deploy/cloudfront/README.md`
- [ ] CloudFront: behaviours `/api/*`, `/_next/static/*`, default; the viewer-request function on the default behaviour only; the response headers policy on the two static behaviours only; NO custom error responses; origin HTTPS only
- [ ] Smoke test (`deploy/cloudfront/README.md`, section 8), including a deep link + refresh and live updates
- [ ] `TRUSTED_PROXY_COUNT=2` confirmed (two sign-in attempts from different networks are limited separately)
- [ ] CloudWatch / journal forwarding for `itam-backend`; alarm on `/api/health/ready`
- [ ] All suites re-run against a disposable copy of the staging database (never production); API rollback rehearsed once on staging

