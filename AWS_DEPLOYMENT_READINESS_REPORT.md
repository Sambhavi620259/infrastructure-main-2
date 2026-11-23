# ITAM: AWS staging readiness report

Branch `security-fixes-on-main` (built on `main` at `580c0e0`; this report covers commits up to `a5b0ebb`).
Nothing was deployed. No AWS resource was created. No existing database was touched: every database test used a
throw-away `postgres:16-alpine` container, and every test script now refuses a database whose name does not contain
`test`, `check`, `scratch`, `tmp` or `disposable`.

Status words: **VERIFIED** = a command ran in this work and its output is quoted. **NOT VERIFIED** = no evidence yet.

## 1. Final decision

**NO-GO for the full S3 + CloudFront + EC2 + RDS architecture as specified, today.** One application-code blocker remains
and it needs your approval (Stage 5, section 5). Everything on the backend and database side is ready for staging.
After Stage 5 is approved and implemented, and RDS-specific checks are done on a real RDS instance, the decision becomes
**CONDITIONAL GO**.

| # | Question | Answer |
|---|---|---|
| 1 | Independently deployable without Authify? | **Yes, VERIFIED.** No Authify/SSO code exists in the repository; the API starts, signs in and runs workflows with no Authify configuration (`deploy_readiness_test.py`). |
| 2 | Frontend compatible with S3 + CloudFront? | **Not as it stands.** Static export fails twice (section 5). It works with a small set of changes, proven only in a throw-away copy. Not implemented: needs your approval. |
| 3 | FastAPI ready for EC2 + Uvicorn + systemd? | **Yes in code and scripts, VERIFIED by simulation** (real process, SIGTERM, restart, release switch, rollback). The systemd unit itself has **not** been run on a real server. |
| 4 | PostgreSQL on Amazon RDS verified? | **PostgreSQL 16 VERIFIED. Amazon RDS itself NOT VERIFIED** (no RDS instance; TLS to RDS, parameter group and network path are untested). |
| 5 | Critical security issues fixed? | **Yes, VERIFIED** with regression tests, with the limits in section 9. |
| 6 | Existing modules preserved and tested? | **Yes.** No file, route, migration or workflow was removed; all existing suites pass on SQLite and PostgreSQL. |
| 7 | File uploads and persistent storage ready? | **Yes, VERIFIED.** Files are stored in the database (no filesystem path, nothing in release directories). They survive a restart (test). |
| 8 | Environment variables and secrets safe? | **Yes, VERIFIED** (section 7): production refuses unsafe config; no `.env`, AWS key or private key is committed. |
| 9 | Critical automated tests passing? | **Yes**, section 3. |
| 10 | Can the AWS staging deployment start? | **Backend + RDS side: yes after the checklist. Frontend hosting: not until Stage 5 is approved.** |

## 2. What changed, by stage

| Stage | Result | Main files |
|---|---|---|
| 1 Discovery | Baseline recorded (section 8). Files in the database; no SSO code; 2 Next.js route handlers and 5 dynamic routes found. | n/a |
| 2 Security | Reporting-user read restriction; Super Admin-only unassigned users; sign-up closed by default (IT Admin, user and Super Admin); health 503. Super Admin key removal (separate commit `ce8b1b8`, droppable). | `access_guard.py`, `users.py`, `auth.py`, `config.py`, `main.py`, register/login/dashboard pages |
| 3 Backend | Production refuses SQLite, unset DATABASE_URL/CORS_ORIGINS, `*`, CHANGE_ME; liveness (`/api/health/live`) vs readiness (`/api/health/ready`, 503 when the database is down; `/api/health` kept as an alias); start/stop logged; background task awaited and pool closed on shutdown. | `config.py`, `main.py`, `access_guard.py` |
| 4 PostgreSQL | `postgres_checks.py`; every suite can run on PostgreSQL; disposable-database guard. | `scripts/postgres_checks.py`, `scripts/_dbguard.py`, `security_test.py` |
| 5 Frontend | **Investigated, not changed** (section 5). | none |
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
npx next build (standalone)                 Compiled successfully
```
Failed: none in the final run. Skipped: none. Two Python "Traceback" blocks appear in the output of `security_test.py` and `deploy_readiness_test.py`; they are the server's own log of the deliberate "database unavailable" tests, and both scripts finish passing.
Not covered by an automated test: browser-level checks were done by hand for the Reporting-user dashboard, unassigned sign-ups and the register page (0 failed API calls); they are not part of a repeatable suite.

Each security fix was checked to fail without the fix (Reporting scope: 12 checks fail; unassigned users: 10; sign-up defaults: 6 with the old defaults; health: the 503 test fails with a 500).

## 4. PostgreSQL migration verification (VERIFIED on PostgreSQL 16.16, disposable container)
27 migrations: one base, one head, no forks, no gaps. `alembic upgrade head` on an empty database; `alembic check` reports no differences between models and migrations; `downgrade base` leaves no application tables; `upgrade head` again works; every model table and foreign key exists; every table has a primary key; `users.email` is unique in the database; a duplicate is refused and rolled back; a multi-row transaction is all-or-nothing; deleting a company that has users is refused; 8 simultaneous sign-ups with one email: exactly one wins; the API in production mode starts against PostgreSQL, the seeded Super Admin signs in, and writes and reads reach it; with PostgreSQL unreachable, production start-up fails instead of using SQLite. Migration history was not edited.
Info: 50 of 113 foreign-key columns have no index. Reads work; index them (additive migration) as tables grow.
**NOT VERIFIED:** Amazon RDS (TLS: use `?sslmode=require` or `verify-full` with the RDS CA bundle; parameter groups; the EC2 to RDS network path; a snapshot/restore drill).

## 5. Frontend: S3 + CloudFront (decision needed)
Tried in a throw-away copy, not in the repository.
1. `output: "export"` as is: build **fails**: the two route handlers (`/api/[...path]` proxy, `/api/health`) cannot be exported.
2. Without them: build **fails**: five dynamic pages (`tickets/[id]`, `agent/tickets/[id]`, `assets/[id]`, `users/[id]`, `super-admin/work/[id]`) need `generateStaticParams`, and the ids are database ids unknown at build time.
3. With a placeholder id, a CloudFront rewrite and the page reading `useParams()`: the build passes but the page asks the API for `/api/asset-requests/_` (the placeholder): **broken**.
4. With the page reading the id from the browser path instead (`usePathname()`): VERIFIED in headless Chrome against the running API that `/tickets/abc-123`, `/users/u-777` and `/assets/a-42` request exactly those ids.

Minimum changes this needs (about 8 files): keep the proxy and health route for Docker/local use but exclude them from the static build; wrap the 5 dynamic pages (server `page.tsx` with `generateStaticParams`, existing page as a client file) and read the id from the path; set `NEXT_PUBLIC_WS_URL` at build time; and configure CloudFront (below).
Decisions for you, because they change the architecture:
- **`/api/*` through CloudFront to the EC2 origin** (same domain, no CORS, the frontend code keeps calling `/api`). CloudFront reaches EC2 over HTTP unless the instance has TLS; without an ALB that means either accepting HTTP between CloudFront and EC2 inside AWS's network (not recommended) or putting a TLS terminator (nginx/caddy + certificate) on the instance. Pick one.
- **A CloudFront Function** rewriting the five dynamic paths to their `_` page.
- **Security headers** (CSP, HSTS, frame options) currently come from `next.config.ts`; static hosting needs the same as a CloudFront response-headers policy.
- **Client address for rate limits:** with CloudFront the API should use `TRUSTED_PROXY_COUNT=1` and the instance should accept port 8000 only from CloudFront. The `PROXY_SHARED_SECRET` mechanism is unchanged and still works if you keep the Next proxy.
- **Live updates (WebSocket):** need a CloudFront behaviour that allows them and `NEXT_PUBLIC_WS_URL=wss://<domain>/api`; not tested.
Alternative that needs no code change: run the existing Next.js server (Node) on the EC2 instance behind CloudFront. It departs from S3 hosting, so it is your call.

## 6. Backend on EC2 + systemd (VERIFIED by simulation)
`deploy/ec2/itam-backend.service` (one worker, `EnvironmentFile`, journal logging, `SuccessExitStatus=143`), `deploy.sh`, `rollback.sh`, tested in `release_flow_test.py`: fresh deploy; migrations run; configuration outside the release; second deploy keeps the first; `rollback.sh`; a release that does not start rolls itself back and the old one is healthy again; an unsafe configuration is refused (exit 3) before anything changes; the logs hold no secret. SIGTERM ends the process after a graceful shutdown (uvicorn re-raises SIGTERM, so the exit status is -15/143, which the unit treats as success). **Not run:** the unit under real systemd, `journalctl`, Amazon Linux package versions.

## 7. Required staging environment variables (placeholders only; see `deploy/ec2/itam.env.example`)
Required: `ENVIRONMENT=production`, `DATABASE_URL` (PostgreSQL, RDS), `JWT_SECRET` (32+ chars), `CORS_ORIGINS` (the CloudFront domain).
Needed in practice: `TRUSTED_PROXY_COUNT=1` behind CloudFront, `SEED_SUPER_ADMIN_EMAIL` / `SEED_SUPER_ADMIN_PASSWORD` (12+ chars) for the first Super Admin.
Optional: `ALLOW_PUBLIC_IT_ADMIN_SIGNUP`, `ALLOW_PUBLIC_AGENT_SIGNUP`, `ALLOW_PUBLIC_SUPER_ADMIN_SIGNUP` (all default `false`), `PROXY_SHARED_SECRET`, `LOG_LEVEL`, `AUTH_RATE_LIMIT_PER_MINUTE`, `LOGIN_FAILURE_LIMIT`, `ACCESS_TOKEN_EXPIRE_MINUTES`, `MAX_REQUEST_BODY_BYTES`, `DB_POOL_SIZE`, `DB_MAX_OVERFLOW`, `WEB_CONCURRENCY` (keep 1).
Frontend build: `NEXT_PUBLIC_WS_URL` (build time), `BACKEND_API_URL` and `BACKEND_PROXY_KEY` (only if the Next server is used).

## 8. Baseline (Stage 1)
Branch `security-fixes-on-main`, commit `ca68a16`, clean working tree, before the readiness work: security 297, smoke pass, workflow 113, tickets 114, delete paths 16 (PostgreSQL). Static-export experiments were done in a separate directory and left the repository untouched.

## 9. Known limitations and remaining blockers
Blockers: (a) Stage 5 frontend changes and the CloudFront/TLS decisions; (b) RDS not verified.
Limitations:
- **One instance, one worker.** Sign-in rate limits and WebSocket updates live in process memory; the daily warranty/licence alert job runs inside the API process. More than one instance or worker multiplies limits and sends updates to only some viewers (duplicate alerts are suppressed).
- **No server-side logout.** Tokens are stateless; they stop working on password change, deactivation or expiry (12 hours by default).
- **Reporting users can read `/api/dashboard`** (aggregate counts) so their dashboard works.
- **Super Admin key removed** at your request: Super Admin now signs in with password only. Revert commit `ce8b1b8` if your reviewer wants the key back.
- **Self-signed-up users** wait for the Super Admin (only the Super Admin can place them).
- **Rollback does not undo migrations** (section "Roll back" in `deploy/ec2/README.md`).
- **Case-insensitive email uniqueness** is enforced in code, not by a database index (an index would need a migration; not added).
- Not tested: load, `psycopg2` TLS to RDS, CloudFront behaviours, real systemd.

## 10. Deployment and rollback procedure
See `deploy/ec2/README.md`. Order: RDS (private) and security groups; `/etc/itam/itam.env`; unit file; `deploy.sh <tarball>`; verify `/api/health/ready`; sign in; frontend (after Stage 5); CloudFront. Take an RDS snapshot before any release with a migration. Roll back with `rollback.sh`.

## 11. Deployment checklist
- [ ] Stage 5 decisions made and implemented; static build passes; dynamic pages tested through the CloudFront rewrite
- [ ] CloudFront to EC2 transport decided (TLS terminator or accepted risk); EC2 port 8000 limited to CloudFront
- [ ] RDS PostgreSQL private, security group from EC2 only, `sslmode=require` in `DATABASE_URL`, automated backups on
- [ ] `/etc/itam/itam.env` filled (mode 600, owner root); `JWT_SECRET` random 48+ chars; no sign-up switch on unless intended
- [ ] RDS snapshot taken; `deploy.sh` run; `/api/health/ready` returns 200; `journalctl -u itam-backend` clean
- [ ] Sign in as the seeded Super Admin; create the IT Admin; IT Admin creates users
- [ ] All suites re-run against the staging database copy (never production)
- [ ] CloudWatch agent or journal forwarding for `itam-backend`; alarm on `/api/health/ready`
- [ ] Rollback rehearsed once on staging
