# ITAM on CloudFront + S3 + EC2: what DevOps needs to build

The application code is ready; this folder tells you what the AWS side must look like. Nothing here creates a resource.
The same domain serves the site and the API, so the browser never makes a cross-origin call and the API needs no CORS exception.

```
Browser --HTTPS--> CloudFront (one domain, e.g. itam.example.com)
   /api/*  ------------------------> API origin: HTTPS custom origin -> TLS terminator on EC2 -> uvicorn 127.0.0.1:8000 -> RDS PostgreSQL
   /_next/static/*, everything else -> S3 bucket (private, Origin Access Control)
```

## 0. The request path and the proxy chain (read this first)
Every API call crosses three hops. Each one has one job, and the API is configured for exactly this chain.

```
Browser --HTTPS--> CloudFront --HTTPS--> TLS terminator on the instance (nginx) --HTTP, 127.0.0.1 only--> uvicorn (127.0.0.1:8000) --> RDS
```

| Hop | What it does to the request | What the API relies on |
|---|---|---|
| CloudFront | Terminates the visitor's TLS. Appends the **visitor's address** to `X-Forwarded-For`. Adds the **origin custom header** `X-Origin-Verify: <secret>` (overwriting any value a visitor sent). Sends the request over HTTPS to the API origin name. | `X-Origin-Verify` proves the request came through CloudFront (section 4A). |
| TLS terminator (nginx, `deploy/ec2/nginx-itam.conf.example`) | Terminates CloudFront's TLS with the origin certificate. **Appends CloudFront's address** to `X-Forwarded-For` (`$proxy_add_x_forwarded_for`). Passes `Host`, `Authorization`, `Sec-WebSocket-Protocol`, `Upgrade` and `X-Origin-Verify` on unchanged. Forwards over plain HTTP to `127.0.0.1:8000`, which never leaves the machine. | It is the only client of uvicorn (uvicorn listens on loopback only). |
| uvicorn (`--no-proxy-headers`) | Does not rewrite the client address by itself. The application reads `X-Forwarded-For` itself, for exactly the number of hops in `TRUSTED_PROXY_COUNT`, counting from the right. | `TRUSTED_PROXY_COUNT=2`: the entries are `<visitor>, <CloudFront edge>`; the second from the right is the visitor. |

Why this is safe, and why each piece is needed: `X-Forwarded-For` is only believable if nobody can reach the instance except through this chain. So (1) the security group accepts port 443 only from the CloudFront prefix list, and (2) the API refuses any request without the secret header. Either one alone is weaker; use both. If the chain changes (for example the terminator is removed), `TRUSTED_PROXY_COUNT` must change with it, otherwise every visitor shares one rate-limit key. Use 1 for CloudFront alone, 2 for CloudFront plus one terminator on the instance. 0 ignores the header.

## 1. Build and upload the frontend (a person runs this)
```
npm ci
NEXT_PUBLIC_WS_URL=wss://itam.example.com npm run build:static     # writes ./out
npm run check:static                                               # 21 checks on ./out and the CloudFront function
# upload (the cache headers matter):
aws s3 sync out/ s3://<bucket>/ --delete --exclude "*.html" --exclude "_next/static/*" --cache-control "public,max-age=3600"
aws s3 sync out/_next/static s3://<bucket>/_next/static --cache-control "public,max-age=31536000,immutable"
aws s3 sync out/ s3://<bucket>/ --exclude "*" --include "*.html" --cache-control "no-cache" --content-type "text/html; charset=utf-8"
aws cloudfront create-invalidation --distribution-id <id> --paths "/*.html" "/" "/*.txt"
```
`NEXT_PUBLIC_WS_URL` is baked into the files at build time: `wss://<the distribution's domain>` with no path (the app appends `/api/assets/ws/<id>` and `/api/physical-audit/ws/<id>`). Without it, live updates are simply off.
No secret belongs in any frontend variable; `npm run check:static` fails if the build output mentions a backend secret or URL.

## 2. S3
Private bucket, Block Public Access on, versioning on (this is the frontend rollback: restore the previous object versions or re-upload the previous `out/`). Access only through CloudFront Origin Access Control. Do not enable S3 static website hosting.

## 3. Behaviours (evaluated in this order)
| Path pattern | Origin | Allowed methods | Cache policy | Origin request policy | Viewer-request function | Response headers policy |
|---|---|---|---|---|---|---|
| `/api/*` | API origin (section 4) | GET, HEAD, OPTIONS, PUT, POST, PATCH, DELETE | CachingDisabled | AllViewerExceptHostHeader (forwards `Authorization`, `Sec-WebSocket-Protocol`, `Upgrade`, `Content-Type`, all query strings) | none | none that overrides origin (API sets its own, section 6) |
| `/_next/static/*` | S3 | GET, HEAD | CachingOptimized | none | none | `itam-static-security-headers` |
| `*` (default) | S3 | GET, HEAD | CachingOptimized (HTML is `no-cache` from S3 metadata, so it is revalidated) | none | `viewer-request.js` | `itam-static-security-headers` |

- **No cookies, no sessions in CloudFront.** The app keeps its token in the browser and sends `Authorization: Bearer ...`; forward no cookies.
- **WebSockets** use the `/api/*` behaviour (`/api/assets/ws/{company_id}`, `/api/physical-audit/ws/{session_id}`). The sign-in token travels in the `Sec-WebSocket-Protocol` header (`itam.v1, bearer.<token>`); it must reach the origin, which AllViewerExceptHostHeader does. The app reconnects every 5 s after a drop. The API checks the browser's `Origin` against `CORS_ORIGINS`, so that must contain the site's origin.
- **Do NOT add distribution-wide custom error responses** (403/404 -> `/404.html`). They apply to the `/api/*` behaviour too and would replace the API's legitimate JSON 403/404 answers with an HTML page. Unknown addresses get S3's own error; every real page is mapped by the function.
- **Request size:** the API accepts up to 8 MB per request (`MAX_REQUEST_BODY_BYTES`; uploads are base64 in JSON, files max 2 MB). CloudFront's limit is far higher. Origin response timeout: keep at least 30 s.
- **Compression:** enable it for the static behaviours.
- **Default root object:** not needed (the function maps `/` to `/index.html`).

## 4. The API origin (HTTPS only; there must be no HTTP between CloudFront and EC2)
- A DNS name you control (for example `api-origin.example.com`) pointing at the EC2 instance, with a certificate from a public CA (ACM cannot be installed on EC2, so use Let's Encrypt or a purchased one) whose name matches. CloudFront must be set to **HTTPS only** to the origin and validates that certificate; the instance's default `ec2-*.amazonaws.com` name cannot have one.
- On the instance a TLS terminator (nginx or caddy) listens on 443 and proxies to `http://127.0.0.1:8000` on the same machine (that hop never leaves the host). It must pass `Host`, `Upgrade`/`Connection` (WebSockets), `Authorization` and `Sec-WebSocket-Protocol` unchanged, and **append** to `X-Forwarded-For` (`proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`). Keep its upload limit at least 9 MB and its read timeout at least 60 s.
- Security group: 443 only from the CloudFront managed prefix list (`com.amazonaws.global.cloudfront.origin-facing`); SSH/SSM only from you. Nothing else can reach the API, which is what makes the forwarded client address trustworthy.
- `TRUSTED_PROXY_COUNT=2` (CloudFront appends the visitor's address, the terminator appends CloudFront's; see the chain in section 0). With 1, every visitor shares one rate-limit key. With 0, the limits see only the terminator.
- The uvicorn unit listens on `127.0.0.1:8000` (see `deploy/ec2/itam-backend.service`); it is not reachable from outside the instance.
- Health for your monitors: `GET /api/health/live` (process) and `GET /api/health/ready` (database; 503 when it is down). They return only `{"status": ...}`.

## 4A. Origin verification header (`X-Origin-Verify`)
Purpose: the API refuses every request that did not come through CloudFront, so the security group is not the only thing between the internet and port 443, and a forged `X-Forwarded-For` cannot reach the rate limits.

**How the API behaves** (`ORIGIN_VERIFY_SECRET` in `/etc/itam/itam.env`; code in `backend/app/core/http_guard.py`, covered by automated tests in `security_test.py`, `deploy_readiness_test.py`, `postgres_checks.py` and `release_flow_test.py`):
- Secret set: every HTTP request and every WebSocket handshake must carry `X-Origin-Verify` with exactly that value, or the API answers `403 {"detail":"Forbidden."}` (a WebSocket is closed before it opens). Public pages of the API, sign-in and CORS preflights are included. The comparison is constant-time.
- `/api/health`, `/api/health/live` and `/api/health/ready` stay open without the header, because `deploy.sh` and your monitors call them on the instance. They return only `{"status": ...}`.
- Secret empty (the default): nothing is checked. Local development and Docker behave exactly as before. **Do not set it for Docker/local runs**: the Next.js proxy used there does not send the header.
- In production the value must be at least 32 characters and not a `CHANGE_ME` placeholder, or the API refuses to start. If it is empty in production the API starts and logs a warning.
- The value is never logged, never returned (not even in the 403), never in the frontend code or in `./out` (`npm run check:static` fails if the build output mentions `ORIGIN_VERIFY` or `X-Origin-Verify`), and the template in Git holds only `CHANGE_ME`.

**What DevOps configures**
1. Generate the secret once, on a trusted machine: `python3 -c "import secrets; print(secrets.token_urlsafe(48))"`. It must differ from `JWT_SECRET`.
2. Store it in **AWS Secrets Manager or SSM Parameter Store (SecureString)**. Not in Git, a ticket, chat, or a CloudFormation/Terraform file in plain text (read it from the secret store at apply time, and mark the variable sensitive).
3. **API instance:** write it into `/etc/itam/itam.env` (owner root, mode 600) as `ORIGIN_VERIFY_SECRET=<value>`, for example with an SSM Run Command that reads the parameter, then restart `itam-backend`. Do not put it on a command line (it would show in `ps` and shell history) or in the systemd unit.
4. **CloudFront:** on the **API origin** only (not the S3 origin), add an **origin custom header** named `X-Origin-Verify` with the same value. CloudFront sends it only to the origin, never to visitors, and overwrites a header of that name sent by a visitor. Do **not** add `X-Origin-Verify` to any origin request policy or "forward headers" list (that would let a visitor choose it). Treat read access to the distribution configuration (`cloudfront:GetDistribution*`) as secret-level: custom header values are visible there; keep it to the few people who need it.
5. nginx on the instance: leave the header alone (the sample passes it through), and never add it to an access-log format.
6. Verify (from your laptop, after both sides are set): `curl -i https://<site domain>/api/auth/registration-options` returns **200** (CloudFront added the header); `curl -i https://api-origin.example.com/api/auth/registration-options` (straight to the origin, no header) returns **403**; `https://api-origin.example.com/api/health/ready` returns 200. Then prove CloudFront overwrites a forged header: `curl -i -H "X-Origin-Verify: forged" https://<site domain>/api/auth/registration-options` must still return **200** (if it returns 403, the custom header is not being applied on this origin).

**Rotating it without downtime** (do this on a schedule, and immediately if it may have leaked):
1. Generate a new secret and store it.
2. On the instance set `ORIGIN_VERIFY_SECRET=<new>` and `ORIGIN_VERIFY_SECRET_PREVIOUS=<old>`; restart `itam-backend`. The API now accepts either.
3. Update the CloudFront origin custom header to `<new>` and wait until the distribution status is "Deployed".
4. Remove `ORIGIN_VERIFY_SECRET_PREVIOUS` from the instance; restart. The old value stops working.
(Skipping step 2 means every request fails with 403 between steps 3 and the instance update.)

**Troubleshooting:** everything returns 403 through CloudFront: the two values differ (check for a trailing space or newline when pasting; the API trims whitespace, CloudFront does not), or the header is on the wrong origin. The journal shows at most one line a minute, `Refused a request without a valid origin verification header (METHOD /path)`, with no values.

## 5. The viewer-request function (`viewer-request.js`, runtime cloudfront-js-2.0, event: viewer-request, default behaviour only)
It maps clean URLs to the static files: `/` to `/index.html`, `/tickets` to `/tickets.html`, `/users/new` to `/users/new.html`, and `/tickets/<id>`, `/users/<id>`, `/assets/<id>`, `/agent/tickets/<id>`, `/super-admin/work/<id>` to the placeholder page `/<route>/_.html` (the page reads the real id from the address bar). Test it in the console with a sample event if you like; `npm run check:static` already runs it against every page in the build. If a page is added under a detail route (for example `/assets/<something fixed>`), `npm run check:static` fails until `STATIC_CHILDREN` in the function is updated; redeploy the function with each frontend release that changes it.

## 6. Security headers
**Static behaviours** (`/_next/static/*` and default): attach a response headers policy built from `response-headers-policy.json` (replace `SITE_DOMAIN`), with **Override origin = true** (S3 sends none of these):

| Header | Value |
|---|---|
| Content-Security-Policy | `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' wss://SITE_DOMAIN https://SITE_DOMAIN; frame-src https://www.openstreetmap.org; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'` |
| Strict-Transport-Security | `max-age=31536000; includeSubDomains` |
| X-Content-Type-Options | `nosniff` |
| X-Frame-Options | `DENY` |
| Referrer-Policy | `strict-origin-when-cross-origin` |
| Permissions-Policy | `camera=(), microphone=(), geolocation=(self)` |
| X-DNS-Prefetch-Control | `on` |
| Cross-Origin-Opener-Policy | `same-origin` |

`'unsafe-inline'` for scripts and styles is needed because the exported pages carry Next.js's inline bootstrap scripts; replacing it needs a nonce-based policy, which a static host cannot generate. The `frame-src` entry is the OpenStreetMap map on the office-location settings. `npm run check:static` fails if this policy drifts from `next.config.ts`.

**`/api/*` behaviour:** do not attach a policy that overrides the origin. The API already sends on every response: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Permissions-Policy: camera=(), microphone=(), geolocation=()`, `Cross-Origin-Resource-Policy: same-site`, `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`, `Strict-Transport-Security: max-age=31536000; includeSubDomains` (production), and `Cache-Control: no-store`. Optionally add a policy with only HSTS and "Override origin = false".

## 7. Everything the deployment depends on
| Item | Where |
|---|---|
| Frontend build variable | `NEXT_PUBLIC_WS_URL=wss://<site domain>` |
| API variables | `deploy/ec2/itam.env.example` (required: `ENVIRONMENT=production`, `DATABASE_URL` (RDS, `?sslmode=require`), `JWT_SECRET`, `CORS_ORIGINS=https://<site domain>`; also `ORIGIN_VERIFY_SECRET` (section 4A), `TRUSTED_PROXY_COUNT=2`, `SEED_SUPER_ADMIN_*`) |
| CloudFront origin custom header | `X-Origin-Verify: <ORIGIN_VERIFY_SECRET>` on the API origin only (section 4A) |
| TLS terminator on the instance | `deploy/ec2/nginx-itam.conf.example` |
| Variables that are NOT used with this architecture | `BACKEND_API_URL`, `BACKEND_PROXY_KEY`, `PROXY_SHARED_SECRET` (they belong to the Next.js proxy used by Docker/local development) |
| API paths (all under `/api`) | access, approval-policies, asset-requests, assets, audit-logs, auth, cloud, dashboard, departments, depreciation, discovery, financial, health, inventory, maintenance, notifications, organization, physical-audit, profile, purchase-orders, reports, software, super-admin, users, vendors, warranty-maintenance (130 paths, 172 operations) |
| WebSocket paths | `/api/assets/ws/{company_id}`, `/api/physical-audit/ws/{session_id}` |
| One API instance | rate limits, live updates and the daily alert job are in process memory: run one instance, one worker |
| Database | RDS PostgreSQL 16, private; migrations run by `deploy/ec2/deploy.sh` (`alembic upgrade head`) |
| Order | RDS + security groups, instance + TLS terminator + certificate, `/etc/itam/itam.env`, `deploy.sh` (API healthy), S3 bucket, build and upload, response headers policy, function, distribution, DNS, invalidation, smoke test |

## 8. Smoke test after the first deployment
Open `https://<domain>/` (lands on the sign-in page); sign in as the seeded Super Admin (lands on `/super-admin`); open a deep link and refresh it (for example `/users/<id>`); check the browser's network tab shows `/api/...` calls answered 200; response headers on the HTML match section 6; `https://<domain>/api/health/ready` returns `{"status":"ok"}`; calling the API origin name directly without the header returns 403 on every path except the health endpoints (section 4A, step 6); `https://<domain>/api/docs` returns 404 (docs are off in production).

## 9. Test the same behaviour on a laptop before AWS
`node scripts/serve-static-local.mjs 4000` serves `./out` with the real function and sends `/api/*` to `API_ORIGIN` (default `http://127.0.0.1:8000`); `scripts/e2e-static.mjs` drives it in Chrome (see the header of that file).
