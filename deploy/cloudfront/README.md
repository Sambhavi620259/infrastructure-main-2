# ITAM on CloudFront + S3 + EC2: what DevOps needs to build

The application code is ready; this folder tells you what the AWS side must look like. Nothing here creates a resource.
The same domain serves the site and the API, so the browser never makes a cross-origin call and the API needs no CORS exception.

```
Browser --HTTPS--> CloudFront (one domain, e.g. itam.example.com)
   /api/*  ------------------------> API origin: HTTPS custom origin -> TLS terminator on EC2 -> uvicorn 127.0.0.1:8000 -> RDS PostgreSQL
   /_next/static/*, everything else -> S3 bucket (private, Origin Access Control)
```

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
- `TRUSTED_PROXY_COUNT=2` (CloudFront appends the visitor's address, the terminator appends CloudFront's). With 1, every visitor shares one rate-limit key. With 0, the limits see only the terminator.
- The uvicorn unit listens on `127.0.0.1:8000` (see `deploy/ec2/itam-backend.service`); it is not reachable from outside the instance.
- Health for your monitors: `GET /api/health/live` (process) and `GET /api/health/ready` (database; 503 when it is down). They return only `{"status": ...}`.

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
| API variables | `deploy/ec2/itam.env.example` (required: `ENVIRONMENT=production`, `DATABASE_URL` (RDS, `?sslmode=require`), `JWT_SECRET`, `CORS_ORIGINS=https://<site domain>`; also `TRUSTED_PROXY_COUNT=2`, `SEED_SUPER_ADMIN_*`) |
| Variables that are NOT used with this architecture | `BACKEND_API_URL`, `BACKEND_PROXY_KEY`, `PROXY_SHARED_SECRET` (they belong to the Next.js proxy used by Docker/local development) |
| API paths (all under `/api`) | access, approval-policies, asset-requests, assets, audit-logs, auth, cloud, dashboard, departments, depreciation, discovery, financial, health, inventory, maintenance, notifications, organization, physical-audit, profile, purchase-orders, reports, software, super-admin, users, vendors, warranty-maintenance (130 paths, 172 operations) |
| WebSocket paths | `/api/assets/ws/{company_id}`, `/api/physical-audit/ws/{session_id}` |
| One API instance | rate limits, live updates and the daily alert job are in process memory: run one instance, one worker |
| Database | RDS PostgreSQL 16, private; migrations run by `deploy/ec2/deploy.sh` (`alembic upgrade head`) |
| Order | RDS + security groups, instance + TLS terminator + certificate, `/etc/itam/itam.env`, `deploy.sh` (API healthy), S3 bucket, build and upload, response headers policy, function, distribution, DNS, invalidation, smoke test |

## 8. Smoke test after the first deployment
Open `https://<domain>/` (lands on the sign-in page); sign in as the seeded Super Admin (lands on `/super-admin`); open a deep link and refresh it (for example `/users/<id>`); check the browser's network tab shows `/api/...` calls answered 200; response headers on the HTML match section 6; `https://<domain>/api/health/ready` returns `{"status":"ok"}`; `https://<domain>/api/docs` returns 404 (docs are off in production).

## 9. Test the same behaviour on a laptop before AWS
`node scripts/serve-static-local.mjs 4000` serves `./out` with the real function and sends `/api/*` to `API_ORIGIN` (default `http://127.0.0.1:8000`); `scripts/e2e-static.mjs` drives it in Chrome (see the header of that file).
