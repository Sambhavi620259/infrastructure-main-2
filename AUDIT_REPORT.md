# Post-fix audit report: remaining findings

Scope: application-level security fixes, PostgreSQL migration verification, Docker verification and real-browser verification.
Architecture, framework, stack, database structure and application flow are unchanged. One additive migration was added (see 3).
No AWS work was done. The existing `itam_postgres` container and its data were never connected to or modified; all
database tests used a throw-away `postgres:16-alpine` container on port 55432 and a separate compose project (`auditstack`)
with its own volume, both removed afterwards.

Status words: **VERIFIED** = a command or browser run in this session demonstrated it (evidence given).
**FIXED (not independently verified)** = changed, but no direct evidence. **OPEN** = not fixed.

## 1. Remaining findings and their resolution

| # | Finding | Resolution | Status / evidence |
|---|---|---|---|
| 1A | Any IT Admin could list every company-less user and claim them | `GET /users/unassigned` and `POST /users/{id}/add-to-organization` are Super Admin only; the latter now requires an explicit `company_id` of an ACTIVE company. IT Admins create agents in their own company with `POST /users`. `_manageable_user` returns 404 for any user outside the caller's company (and for company-less users) unless the caller is a Super Admin. | VERIFIED: security suite "Unassigned users" section; browser: IT Admin and IT Agent get 403 on `/users/unassigned`, Super Admin 200; IT Admin's Users page has no sign-up panel |
| 1A | Unauthorized password reset | Reset/deactivate/reactivate/update/activity are limited to the caller's own company (404 otherwise). Resets invalidate every older token. | VERIFIED: A's and B's admins attack each other's users and unassigned users; passwords re-checked afterwards by signing in |
| 1A | Existing test treated the unauthorized claim as success | Rewritten. Tenant-isolation attacks now require 403/404 (never 200/400/422/5xx) when they name another company's record, and the suite then re-reads the records to prove nothing changed. | VERIFIED: see 4 |
| 1B | Public employee registration | New setting `ALLOW_PUBLIC_AGENT_REGISTRATION`, default **false in every environment**. When true, agents register with no company and only a Super Admin can place them. New public `GET /auth/registration-options`; the register page hides closed account types. | VERIFIED: direct `POST /auth/register` returns 403 in the suite and in the browser run (valid email, so the 403 is the policy, not validation); no row is created; case/whitespace variants and unknown roles also refused |
| 1C | IT Admin registration public by default | `ALLOW_PUBLIC_ADMIN_REGISTRATION` now defaults to **false everywhere** (it was true in development). Provisioning path inside the existing architecture: the first Super Admin is seeded (`SEED_SUPER_ADMIN_*`), Super Admins create organizations with their first IT Admin (`POST /super-admin/companies`), IT Admins create users. | VERIFIED: IT Admin/Super Admin registration refused; non-admins and IT Admins cannot create Super Admins or organizations; in Docker a seeded Super Admin created an organization and its IT Admin, who then signed in |
| 1D | Reporting users had unrestricted reads | Reporting users can read reports plus only the data modules assigned on their account (`modules` of HAM/SAM/CLOUD/SCAN, validated; `REPORTS` is not accepted for them). Users, finance, audit logs, organization and platform settings are never readable. Enforced in `get_current_user` (every endpoint) and in the two WebSocket endpoints, writes still blocked by `ScopedRoleWriteGuard`. Removed from the user-directory readers. UI: module checkboxes for the Reporting role, sidebar/redirect follow the same rule, restricted pages are not mounted. | VERIFIED: 32 restricted GET paths return 403 without modules; assigned module readable and read-only; adding/clearing modules takes effect immediately; other company's admin cannot widen access; browser run repeated it through the web proxy |
| 2 | Security tests only counted successful responses | See 4. Negative cases added for takeover, cross-company access, password reset, registration, privileged-account creation, reporting permissions, WebSockets. | VERIFIED |
| 5 | Dashboard/UI behaviour found by the browser run | Reporting users triggered 29 `403` requests (sidebar badge counts, pages mounting before the redirect). Fixed by skipping badge counts for the role and not mounting blocked pages; dashboard link hidden when not allowed. | VERIFIED: 0 failed requests in the final browser run |
| 5 | Seed accepted an email the login form rejects (`root@x.local`) | Seeding now validates the address and fails with a clear message. | VERIFIED (suite) |
| 4 | `/api/health` returned 500 when the database was down | Returns 503 `{"status":"unavailable"}`. | VERIFIED (Docker, DB stopped) |

Earlier-round fixes that remain in place (token invalidation after password change, trusted-proxy handling, body size limit,
WebSocket origin/size/connection limits, pagination bounds, vendor delete 409, CSP, etc.) are covered by the same suites.

## 2. Changed files

Backend: `app/core/{permissions.py (new), request_limits.py (new), access_guard.py, config.py, database.py, deps.py, rate_limit.py, security.py, seed.py}`,
`app/main.py`, `app/models/models.py`, routers `{asset_requests, assets, audit, audit_logs, auth, cloud, departments, discovery, inventory, purchase_orders, reports, software, super_admin, users, vendors}.py`,
migration `b2c4d6e8f0a1_users_email_lower_unique.py` (new), `scripts/security_test.py`, `scripts/smoke_test_assets_api.py`, `Dockerfile`, `docker-compose.yml`, `.env.example`.
Frontend: `src/app/{register,login}/page.tsx`, `src/app/(dashboard)/{users/page.tsx, users/new/page.tsx, super-admin/page.tsx}`,
`src/app/api/{health,[...path]}/route.ts`, `src/components/layout/app-shell.tsx`, `src/lib/{access,profile,users}.ts`, `src/types/user.ts`, `next.config.ts`.
Root: `Dockerfile`, `docker-compose.yml`, `render.yaml`, `.env.example`, `.env.production.example`, `README.md`.

Implementation notes:
* `permissions.py` holds the path-to-module map and `reporting_user_may_read`; `get_current_user` takes the `Request` and calls it.
* `ws_authenticate` (deps.py) is shared by both WebSocket endpoints; its `authorize` callback now also applies the Reporting rule.
* `add-to-organization` takes `{"company_id": ...}`. This is an API contract change, necessary because IT Admins may no longer claim users; the only caller was the Users page, which no longer offers it. The Super Admin overview page now has the "Agents awaiting an organization" panel.

## 3. PostgreSQL migration evidence (throw-away PostgreSQL 16, never the existing database)

* Fresh database: `alembic upgrade head` ran 15 migrations from base to `b2c4d6e8f0a1`; `alembic check` reported "No new upgrade operations detected".
* Upgrade from the existing state: database created at the initial revision `5c6c1c588e99`, seeded with 2 companies, 3 users (one with a mixed-case email), an asset, categories and two tickets (one `APPROVED` with an assigned asset), then upgraded to head. All rows preserved; the `APPROVED`+assigned ticket became `FULFILLED`; starter catalog created; `alembic check` clean.
* Fresh and upgraded schemas compared with `pg_dump -s`: identical (only the random `\restrict` token line differs).
* Structure: 28 tables in DB and models; 57 foreign keys in DB and models; 55 indexes, 3 unique constraints; `users` has `ix_users_email` (unique), `ix_users_email_lower` (unique, new), `ix_users_agent_id` (unique).
* `alembic downgrade -1` and `downgrade base` then `upgrade head` all succeed.
* New migration guard: with `A@x.com` and `a@x.com` present, `upgrade` aborts with a message listing the clashing emails (`RuntimeError`), instead of failing obscurely.
* Both backend suites also ran against a migrated PostgreSQL database (see 4).

Migration risks to document:
1. `b2c4d6e8f0a1` fails on databases that contain emails differing only by case. Run `SELECT lower(email), count(*) FROM users GROUP BY 1 HAVING count(*) > 1;` on production first and merge or rename.
2. It builds a unique index on `users`; on a very large table take a maintenance window (or create it `CONCURRENTLY` by hand first).
3. 23 foreign-key columns have no index (e.g. `assets.vendor_id`, `maintenance.asset_id`, `asset_requests.assigned_asset_id`, `users.department_id`). Not changed (it would be a schema change); consider an additive migration if tables grow.
4. All foreign keys have no `ON DELETE` rule except `report_runs.report_config_id` (SET NULL); the app deletes children explicitly. The `Company.users` ORM cascade was removed in the previous round.
5. SQLite cannot run the migrations (the earlier SQLite failure is a SQLite limitation, not a PostgreSQL problem); the SQLite path is test-only and uses `create_all`.
6. Data-migration `f7c3d8a1b2e4` iterates over all companies; fine at this scale, not load-tested.

## 4. Test commands and results

| Command | Result |
|---|---|
| `npm run lint` | clean |
| `npm run typecheck` | clean |
| `npm run build` | compiled successfully |
| `cd backend && python3 scripts/security_test.py` (SQLite) | 267/267 passed |
| `SECURITY_TEST_DATABASE_URL=postgresql+psycopg2://…/sectest python3 scripts/security_test.py` (migrated PostgreSQL) | 267/267 passed |
| `python3 scripts/smoke_test_assets_api.py` (SQLite) | ALL PASSED |
| `SMOKE_DATABASE_URL=postgresql+psycopg2://…/smoketest python3 scripts/smoke_test_assets_api.py` (migrated PostgreSQL) | ALL PASSED |
| `node e2e.mjs` (Chrome, against the Docker stack) | 62/62 passed, 0 failed requests |
| `npm run verify` | **FAILS (pre-existing, unrelated):** expects `src/app/(dashboard)/agent/users/page.tsx`, which does not exist in the repo. Not changed. |

The security suite is strict: a request that must be refused must return 401/403/404 (400 only where the request creates a record referencing another company's data), and state is re-read afterwards. It covers: tenant isolation (about 50 attacks plus state checks), role scoping, privilege escalation, registration policy and bypass attempts (casing, whitespace, unknown roles), unassigned-user takeover, cross-company user management, token invalidation after change/reset, Reporting-user reads/writes/modules, Sub-admin report access, X-Forwarded-For spoofing, body size, security headers, WebSockets (token, company, origin, stale token, Reporting user), pagination bounds, seed, forgot-password.

All results above are from the final run, after the last code change (fresh Docker stack, fresh migrated PostgreSQL databases).

## 5. Docker verification evidence (Docker Desktop, macOS, project `auditstack`)

* Both images build (`docker compose up -d --build`); db, backend and frontend reach `healthy`.
* Backend startup ran the 15 migrations, seeded the Super Admin from env, runs as uid 1001 (`app`); frontend as uid 1001 (`nextjs`).
* Backend→database: `/api/health` 200 with the database up; **503** with it stopped; recovers by itself after the database restarts (verified).
* Frontend `/api/health`: 200 with backend up (`"backend":"ok"`); **503 `degraded`** with backend (or database) down; recovers (verified).
* Graceful stop: `docker stop` of the backend exited with code 0; full-stack `docker compose restart` came back healthy and the seeded Super Admin row persisted in the volume.
* Secret handling: compose refuses to start without `POSTGRES_PASSWORD` and `JWT_SECRET`; `ENVIRONMENT=production` refuses a short `JWT_SECRET` or the example DB password (verified with a throw-away container); no `JWT_SECRET`/`itam_password` in image history; images contain only `.env.example`.
* Ports: only 3000 (frontend) and 8000 (backend) are published; the database is not published. Backend port 8000 is published because browsers open WebSockets to it directly (existing architecture).
* Defaults in `backend/docker-compose.yml` (local development only) no longer contain credentials and bind PostgreSQL to 127.0.0.1.

## 6. Browser testing evidence (Chrome 1360x900 headless via `playwright-core`; script and screenshots kept in the session scratchpad, not in the repository)

Passed (62 checks): register page shows "Sign-up is closed" and a disabled button; direct API registration refused; anonymous users redirected to `/login`;
seeded Super Admin (mixed-case email) signs in and is kept in `/super-admin`; Super Admin provisions an organization with an IT Admin; IT Admin (mixed-case email)
signs in, opens dashboard, users, assets, tickets, inventory, reports, settings, finance, cloud, discovery and software without errors; creates a Reporting user
(software only) and an IT Agent in the UI; asset, inventory, software, ticket and report created and listed; password change through the proxy returns a fresh token and
the old token is refused; Reporting user lands on `/reports`, cannot see or open Users/Assets/Cloud/Finance, and gets 403 from every restricted API path while reading
software (assigned) and reports; IT Agent lands on `/agent/dashboard` and is redirected away from admin pages; browser WebSockets with a valid token get a pong and with
a bad token close with code 4401; Next.js pages carry a Content-Security-Policy.

Console: 1 error, `GET /favicon.ico` 404 (no favicon exists; cosmetic, left unchanged as an unrelated UI change). Failed/blocked requests: 0.

Not covered by the browser run: ticket approval/fulfilment, asset assignment/return, physical-audit scanning, discovery reconcile, cloud/finance data entry, forgot-password UI, super-admin
subscription/settings pages beyond opening them, mobile layouts, other browsers.

## 7. Remaining risks and unverified items

* **JWT in localStorage + a JavaScript-set cookie** (OPEN, needs an architecture change to HttpOnly cookies).
* **Rate limiter is in memory, per process** (OPEN). With `TRUST_FORWARDED_HEADERS=false` (default) all visitors share one sign-in bucket (a single client can lock others out for a minute); set it to `true` only behind a proxy that sets `X-Forwarded-For` itself.
* **WebSocket token in the query string** may be logged by proxies (OPEN); WebSocket fan-out is in process memory, so run one worker.
* **Sub-admin reads are not restricted by module at the API level** (OPEN by design: pickers need them); only their writes are.
* The seed password stays in the container environment after the first start; remove `SEED_SUPER_ADMIN_PASSWORD` afterwards.
* Public registration cannot be opened for a single organization; with the flags off every account is created by a Super Admin or IT Admin.
* No load, penetration or dependency-vulnerability testing; no HTTPS/TLS termination, backups, monitoring or secrets-manager integration were assessed (AWS items).
* Tests ran on macOS with Docker Desktop, not on AWS; PostgreSQL 16 was used for tests, the existing local database is 15 (`itam_postgres`), which was not used.
* `npm run verify` fails for a pre-existing, unrelated reason (see 4).

## 8. Updated score and decision

I cannot reproduce the auditor's scoring rubric, so I am not claiming a numeric score. All four critical findings (1A to 1D), the test-suite weaknesses, PostgreSQL
migration verification, Docker verification and browser verification now have direct evidence above. Indicatively that closes the items that held the previous result at
66/100, but the score should be re-assigned by the auditor against this evidence.

Decision I can support: **still NO-GO for production**; **GO to begin an AWS *staging* readiness review**, with the items in section 7 (rate limiter, token storage, TLS,
secrets, backups, monitoring, migration pre-check query) as explicit staging exit criteria. Do not deploy before that review.
