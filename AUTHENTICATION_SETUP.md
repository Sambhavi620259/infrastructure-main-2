# Authentication setup

This project uses a Next.js same-origin API proxy in `src/app/api/[...path]/route.ts`. Browser requests such as `/api/auth/login` are forwarded by Next.js to the FastAPI backend. This avoids the previous `localhost:3000/api/auth/login` 404 and local CORS/port mismatch.

## Start the backend

From the project root:

```bash
cd backend
python3 -m pip install -r requirements.txt
python3 -m uvicorn app.main:app --reload --port 8000
```

Keep this terminal running.

## Start the frontend

Open a second terminal:

```bash
cd ~/Downloads/infrastructure-main
npm install
npm run dev
```

Open `http://localhost:3000/login`.

If port 3000 is already occupied, stop the old Next.js process first. Do not use an old browser tab connected to a previous Next.js process.

## Development accounts

Super Admin:

- Email: `superadmin@example.com`
- Password: `ChangeMe123!`

Super Admin registration key:

- `development-super-admin-key`

For IT Admin registration, use a new email address. The seeded Super Admin email cannot be registered again.

## IT Agent flow

1. Sign in as an IT Admin or Super Admin.
2. Open Users and choose **Invite user**.
3. Select **IT Agent**.
4. The UI creates a backend invitation token.
5. Give that token to the agent.
6. The agent opens `/register`, selects **IT Agent**, enters the same email and token, and creates the account.
7. The agent can then sign in at `/login`.

## Persistence

Local authentication records are persisted in `backend/data/auth_store.json`, so registered accounts survive FastAPI restarts. The file is created automatically and should not be committed to source control in production.

For production, replace this JSON repository with a transactional database and use strong environment secrets.
