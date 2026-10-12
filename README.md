# AssetOps ITAM Admin UI

Production-oriented Next.js frontend foundation for the requested multi-tenant IT Asset Management system.

## Workspaces and roles

### 1. Super Admin — platform owner

- Company provisioning and company status
- Subscription and plan management
- Tenant management
- Tenant-to-IT-Admin workspace hand-off
- Platform administrators
- Immutable-audit UI
- Platform settings

### 2. IT Admin — company administrator

- Organization configuration
- User provisioning
- Sub-admin creation and role assignment
- Hardware Asset Management (HAM)
- Software Asset Management (SAM)
- Cloud Resource Management
- Discovery / scanning
- Financial and contract management
- Reports

### 3. Sub-Admins

The canonical role model supports:

- HAM Sub-Admin
- SAM Sub-Admin
- Cloud Sub-Admin
- Discovery Sub-Admin

Each module role is least-privilege and also receives reporting access.

### 4. Reporting User

- Reports and approved exports only.

The role and permission definitions are centralized in `src/lib/roles.ts` so the frontend and backend can share the same authorization contract.

## Requirement coverage

The UI covers the requested centralized asset repository, lifecycle management, hardware/software management, discovery, cloud resources, financial/contract management, reporting, company subscriptions and tenant management.

See `docs/PRODUCTION_REQUIREMENTS.md` for the detailed requirement-to-route mapping and the backend security contract.

## Architecture

- **Frontend** (`/`, Next.js 15): all browser API calls go to `/api/*` on the same origin; `src/app/api/[...path]/route.ts` forwards them to the backend (`BACKEND_API_URL`). Live updates use WebSockets straight to the backend.
- **Backend** (`backend/`, FastAPI + SQLAlchemy + PostgreSQL): JWT auth, role checks and tenant isolation on every endpoint. The schema is owned by Alembic migrations in `backend/migrations`.

## Run locally

Requirements: Node.js 20.9+, Python 3.11+, PostgreSQL 15+.

```bash
# 1. Database (or use your own PostgreSQL)
docker compose -f backend/docker-compose.yml up -d db

# 2. Backend
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env            # then edit values
alembic upgrade head            # create / update the schema
uvicorn app.main:app --reload --port 8000

# 3. Frontend (new terminal, project root)
npm ci
cp .env.example .env.local
npm run dev                     # http://localhost:3000
```

First run: open `/register`, choose **Super Admin** and create the Super Admin key, or **IT Admin** to get an organization.

## Checks

```bash
npm run lint && npm run typecheck && npm run build      # frontend
cd backend && .venv/bin/python scripts/smoke_test_assets_api.py   # API: ~180 end-to-end checks on a throwaway SQLite DB
```

## Production (Docker Compose)

```bash
cp .env.production.example .env   # set POSTGRES_PASSWORD, JWT_SECRET, PUBLIC_APP_URL …
docker compose up -d --build      # db + backend (runs migrations) + frontend
```

- The backend runs with `ENVIRONMENT=production` and **refuses to start** with the default JWT secret, the example database password, or `CORS_ORIGINS=*`.
- Put both services behind HTTPS (a reverse proxy or load balancer). Expose the frontend (port 3000) and the backend port 8000 for WebSockets, or route `wss://` to the backend and set `PUBLIC_WS_URL`.
- Run **one backend worker** (the default): live-update connections live in process memory. Scaling out needs a shared message broker (e.g. Redis pub/sub).
- Sign-in and registration are rate limited per client address (`AUTH_RATE_LIMIT_PER_MINUTE`, in memory, per process).
- `GET /api/health` checks the database; Docker uses it as the backend health check.
- Back up the `postgres_data` volume.

## Deploying (Render + Vercel)

The backend needs WebSockets, a background job and one long-running process,
so it runs on Render; the Next.js frontend runs on Vercel.

1. **Backend and database (Render).** New → Blueprint → pick this repository.
   `render.yaml` creates `itam-db` (PostgreSQL) and `itam-backend`, generates
   `JWT_SECRET` and runs migrations on start. When asked for `CORS_ORIGINS`,
   enter the Vercel address (you can set it after step 2). Note the backend
   address, e.g. `https://itam-backend.onrender.com`.
2. **Frontend (Vercel).** Add New → Project → import this repository (framework:
   Next.js). Environment variables:
   - `BACKEND_API_URL` = `https://itam-backend.onrender.com`
   - `NEXT_PUBLIC_WS_URL` = `wss://itam-backend.onrender.com`
3. Set `CORS_ORIGINS` on Render to the Vercel address
   (e.g. `https://your-app.vercel.app`) if you skipped it.
4. Open the Vercel address → Register → Super Admin (choose the platform key),
   then register an IT Admin for the organization.

Free plans: the Render service sleeps after ~15 minutes idle (the first request
then takes about a minute) and the free database expires after 30 days. Use
paid plans for real use.

## Security notes

- No default accounts: the first Super Admin registers (creating the Super Admin key) or is seeded from `SEED_SUPER_ADMIN_EMAIL` / `SEED_SUPER_ADMIN_PASSWORD`.
- Passwords and the Super Admin key are stored as bcrypt hashes.
- Suspending an organization (Super Admin → Companies) locks out all its users immediately.
- IT Agents get operational permissions only (tickets, asset hand-over, stock moves, maintenance, reports) and see colleagues' names only, never contact details.
