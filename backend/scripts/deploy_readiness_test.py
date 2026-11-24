"""
Deployment-readiness checks for the EC2 + uvicorn + systemd + RDS PostgreSQL target.

Starts the real API as a separate OS process (the way systemd would), on a throw-away
SQLite file (the process is NOT in production mode, so SQLite is allowed here), and checks:

  * production configuration validation (unsafe settings are refused, valid ones accepted)
  * the process starts with no Authify / SSO configuration at all
  * liveness vs readiness (/api/health/live, /api/health/ready, /api/health)
  * graceful shutdown on SIGTERM, restart, and logs that never contain secrets
  * uploaded files survive a restart (they live in the database, not in a release directory)
  * production mode: API docs are not published, and start-up with missing config fails safely

    cd backend && .venv/bin/python scripts/deploy_readiness_test.py

Exits non-zero if any check fails. PostgreSQL itself is checked by the other scripts
(see AWS_DEPLOYMENT_READINESS_REPORT.md); nothing here touches a real database.
"""
import base64
import json
import os
import signal
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

BACKEND = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
sys.path.insert(0, BACKEND)

WORKDIR = tempfile.mkdtemp(prefix="itam-deploy-")
DB_FILE = os.path.join(WORKDIR, "itam.db")
JWT = "deploy-readiness-test-secret-0123456789abcdef0123456789"
DB_PASSWORD_MARKER = "S3cretDbPassw0rd"  # used only in config-validation strings, to prove it is never logged

# The test process shares the secret with the server process so it can sign tokens.
os.environ["JWT_SECRET"] = JWT
os.environ["DATABASE_URL"] = f"sqlite:///{DB_FILE}"
for name in list(os.environ):
    if "AUTHIFY" in name.upper() or name.upper().startswith("SSO"):
        del os.environ[name]

from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402

from app.core.config import Settings  # noqa: E402
from app.core.database import Base  # noqa: E402
from app.core.security import issue_token  # noqa: E402
from app.models.models import AssetCategory, Company, PlatformRole, Subscription, User  # noqa: E402

RESULTS = []


def check(label, ok, detail=""):
    RESULTS.append(bool(ok))
    print(f"  {'PASS' if ok else 'FAIL'}  {label}" + ("" if ok else f"  -> {detail}"))


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


# --------------------------------------------------------------------------- production config
print("Production configuration validation")
GOOD = dict(
    ENVIRONMENT="production",
    SECRET_KEY="x" * 48,
    DATABASE_URL=f"postgresql+psycopg2://itam:{DB_PASSWORD_MARKER}@itam.abc.eu-west-1.rds.amazonaws.com:5432/itam",
    CORS_ORIGINS="https://itam.example.com",
)


def refused(**changes):
    values = {**GOOD, **changes}
    try:
        Settings(**values).check_production_safety()
    except RuntimeError as error:
        return str(error)
    return None


try:
    Settings(**GOOD).check_production_safety()
    check("a complete production configuration is accepted", True)
except RuntimeError as error:
    check("a complete production configuration is accepted", False, error)
msg = refused(SECRET_KEY="production-itam-super-secret-key-change-me-2026")
check("the built-in JWT secret is refused in production", msg and "JWT_SECRET" in msg, msg)
msg = refused(SECRET_KEY="short")
check("a short JWT secret is refused in production", msg and "JWT_SECRET" in msg, msg)
msg = refused(DATABASE_URL="sqlite:///./itam.db")
check("SQLite is refused in production", msg and "PostgreSQL" in msg, msg)
msg = refused(DATABASE_URL="postgresql+psycopg2://itam_user:itam_password@localhost:5432/itam_db")
check("the development database default is refused in production", msg and "DATABASE_URL" in msg, msg)
msg = refused(DATABASE_URL="postgresql+psycopg2://u:itam_password@rds.example.com:5432/itam")
check("the example database password is refused in production", msg and "example database password" in msg, msg)
msg = refused(CORS_ORIGINS="*")
check("CORS * is refused in production", msg and "CORS_ORIGINS" in msg, msg)
msg = refused(CORS_ORIGINS="http://localhost:3000,http://localhost:3001,http://127.0.0.1:3000,http://127.0.0.1:3001")
check("the development CORS default is refused in production", msg and "CORS_ORIGINS" in msg, msg)
check("the error message never repeats the database password", msg is not None and DB_PASSWORD_MARKER not in (refused(SECRET_KEY="short") or ""), "")
try:
    Settings(**{**GOOD, "ENVIRONMENT": "development", "SECRET_KEY": "short", "DATABASE_URL": "sqlite:///x.db"}).check_production_safety()
    check("development mode still allows local settings", True)
except RuntimeError as error:
    check("development mode still allows local settings", False, error)
ORIGIN_GOOD = "o" + "Kx9" * 15  # 46 characters
try:
    Settings(**GOOD, ORIGIN_VERIFY_SECRET=ORIGIN_GOOD).check_production_safety()
    check("a long random origin-verification secret is accepted in production", True)
except RuntimeError as error:
    check("a long random origin-verification secret is accepted in production", False, error)
msg = refused(ORIGIN_VERIFY_SECRET="short-secret")
check("a short origin-verification secret is refused in production", msg and "ORIGIN_VERIFY_SECRET" in msg, msg)
msg = refused(ORIGIN_VERIFY_SECRET="CHANGE_ME" + "x" * 40)
check("a CHANGE_ME placeholder origin-verification secret is refused in production", msg and "ORIGIN_VERIFY_SECRET" in msg, msg)
msg = refused(ORIGIN_VERIFY_SECRET_PREVIOUS=ORIGIN_GOOD)
check("a previous secret without a current one is refused", msg and "ORIGIN_VERIFY_SECRET_PREVIOUS" in msg, msg)
msg = refused(ORIGIN_VERIFY_SECRET=ORIGIN_GOOD, ORIGIN_VERIFY_SECRET_PREVIOUS="tiny")
check("a short previous secret is refused too", msg and "ORIGIN_VERIFY_SECRET_PREVIOUS" in msg, msg)
check("a trailing newline from an env file is not part of the secret", Settings(**GOOD, ORIGIN_VERIFY_SECRET=ORIGIN_GOOD + "\n").ORIGIN_VERIFY_SECRET == ORIGIN_GOOD)
check("the error message never repeats the origin-verification secret", ORIGIN_GOOD not in (refused(ORIGIN_VERIFY_SECRET=ORIGIN_GOOD, SECRET_KEY="short") or ""))
check("postgres:// URLs from a host are upgraded to the installed driver",
      Settings(**{**GOOD, "DATABASE_URL": "postgres://u:p@h:5432/d"}).DATABASE_URL.startswith("postgresql+psycopg2://"))

# --------------------------------------------------------------------------- schema + fixtures
engine = create_engine(f"sqlite:///{DB_FILE}", connect_args={"check_same_thread": False})
Base.metadata.create_all(engine)
Session = sessionmaker(bind=engine)
with Session() as db:
    company = Company(name="Deploy Co", code="DEP")
    db.add(company)
    db.flush()
    db.add(Subscription(company_id=company.id, plan="ENTERPRISE", user_limit=50, asset_limit=50))
    admin = User(email="admin@deploy.example.com", hashed_password="x", full_name="Admin", role=PlatformRole.IT_ADMIN,
                 company_id=company.id, status="ACTIVE")
    agent = User(email="agent@deploy.example.com", hashed_password="x", full_name="Agent", role=PlatformRole.EMPLOYEE,
                 company_id=company.id, status="ACTIVE")
    db.add_all([admin, agent])
    category = AssetCategory(company_id=company.id, name="Laptop")
    db.add(category)
    db.flush()
    ADMIN_TOKEN, AGENT_TOKEN, CATEGORY = issue_token(admin), issue_token(agent), category.id
    db.commit()

# --------------------------------------------------------------------------- real server process
LOG_FILE = os.path.join(WORKDIR, "server.log")


def start_server(port, extra_env=None, database=None):
    env = {k: v for k, v in os.environ.items() if "AUTHIFY" not in k.upper()}
    env.update({"DATABASE_URL": database or f"sqlite:///{DB_FILE}", "JWT_SECRET": JWT, "ENVIRONMENT": "development",
                "LOG_LEVEL": "INFO", "PYTHONUNBUFFERED": "1"})
    env.update(extra_env or {})
    log = open(LOG_FILE, "ab")
    process = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", str(port), "--no-proxy-headers"],
        cwd=BACKEND, env=env, stdout=log, stderr=subprocess.STDOUT,
    )
    return process


def wait_up(port, process, seconds=30):
    deadline = time.time() + seconds
    while time.time() < deadline:
        if process.poll() is not None:
            return False
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{port}/api/health/live", timeout=1)
            return True
        except Exception:
            time.sleep(0.2)
    return False


def http(port, method, path, body=None, token=None, raw=False):
    request = urllib.request.Request(
        f"http://127.0.0.1:{port}/api{path}", data=json.dumps(body).encode() if body is not None else None, method=method,
        headers={"Content-Type": "application/json", **({"Authorization": f"Bearer {token}"} if token else {})},
    )
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            data = response.read()
            return response.status, (data if raw else json.loads(data or b"{}"))
    except urllib.error.HTTPError as error:
        data = error.read()
        try:
            return error.code, (data if raw else json.loads(data))
        except Exception:
            return error.code, data


print("Server process: start, health, no Authify")
port = free_port()
server = start_server(port)
up = wait_up(port, server)
check("the API starts as its own process with no Authify / SSO configuration", up, open(LOG_FILE).read()[-400:])
code, data = http(port, "GET", "/health/live")
check("liveness answers 200", code == 200 and data == {"status": "ok"}, (code, data))
code, data = http(port, "GET", "/health/ready")
check("readiness answers 200 while the database is up", code == 200 and data == {"status": "ok"}, (code, data))
code, data = http(port, "GET", "/health")
check("/api/health (existing monitors and Docker) still answers 200", code == 200, (code, data))
check("health responses carry no sensitive detail", all(key == "status" for key in data), data)
code, data = http(port, "GET", "/auth/registration-options")
check("independent sign-in works without any SSO provider (registration options answer)", code == 200, (code, data))
code, data = http(port, "GET", "/profile", token=ADMIN_TOKEN)
check("a locally issued token is accepted: authentication is independent of Authify", code == 200, (code, data))
code, data = http(port, "GET", "/profile", token="not-a-token")
check("an invalid token is refused (401)", code == 401, (code, data))

print("Origin verification in a real process")
ORIGIN_SECRET = "p" + "Qr7" * 14
WRONG_SECRET = "w" + "Zt3" * 14
port_o = free_port()
server_o = start_server(port_o, {"ORIGIN_VERIFY_SECRET": ORIGIN_SECRET})
check("the API starts with origin verification on", wait_up(port_o, server_o), open(LOG_FILE).read()[-300:])


def call_o(path, token=None, headers=None):
    request = urllib.request.Request(f"http://127.0.0.1:{port_o}/api{path}", headers={**({"Authorization": f"Bearer {token}"} if token else {}), **(headers or {})})
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            return response.status
    except urllib.error.HTTPError as error:
        return error.code


check("a request without the header is refused (403)", call_o("/profile", ADMIN_TOKEN) == 403)
check("a request with a wrong header is refused (403)", call_o("/profile", ADMIN_TOKEN, {"X-Origin-Verify": WRONG_SECRET}) == 403)
check("a request with the right header is accepted", call_o("/profile", ADMIN_TOKEN, {"X-Origin-Verify": ORIGIN_SECRET}) == 200)
check("the health endpoints stay open for the deploy script", call_o("/health/ready") == 200 and call_o("/health/live") == 200)
server_o.send_signal(signal.SIGTERM)
server_o.wait(timeout=20)
log_o = open(LOG_FILE).read()
check("start-up says origin verification is on", "Origin verification is on" in log_o, log_o[-300:])
check("the refusal is logged without any header value", "without a valid origin verification header" in log_o, log_o[-300:])
check("the log never contains the secret or the wrong value that was sent", ORIGIN_SECRET not in log_o and WRONG_SECRET not in log_o)

print("File upload survives a restart")
code, ticket = http(port, "POST", "/asset-requests", {"asset_category_id": CATEGORY, "reason": "needs a laptop"}, token=AGENT_TOKEN)
check("a ticket can be created", code == 201, (code, ticket))
PNG = base64.b64encode(b"\x89PNG\r\n\x1a\n" + os.urandom(64)).decode()
code, att = http(port, "POST", f"/asset-requests/{ticket.get('id')}/attachments",
                 {"filename": "photo.png", "content_type": "image/png", "data": PNG}, token=AGENT_TOKEN)
check("a PNG attachment uploads", code == 201 and att.get("size", 0) > 0, (code, att))
code, before = http(port, "GET", f"/asset-requests/{ticket.get('id')}/attachments/{att.get('id')}", token=AGENT_TOKEN, raw=True)
check("and downloads", code == 200 and before == base64.b64decode(PNG), (code, str(before)[:60]))
code, bad = http(port, "POST", f"/asset-requests/{ticket.get('id')}/attachments",
                 {"filename": "evil.png", "content_type": "image/png", "data": base64.b64encode(b"<script>").decode()}, token=AGENT_TOKEN)
check("a file whose content does not match its type is refused (400)", code == 400, (code, bad))

print("Graceful shutdown and restart")
server.send_signal(signal.SIGTERM)
try:
    exit_code = server.wait(timeout=20)
except subprocess.TimeoutExpired:
    server.kill()
    exit_code = "timeout"
# uvicorn finishes its shutdown, then re-raises SIGTERM, so a clean stop shows as 0 or -15 (143 under a shell).
check("SIGTERM stops the process (it exits by itself, it is not killed)", exit_code in (0, -signal.SIGTERM), exit_code)
log = open(LOG_FILE).read()
check("start-up is logged", "ITAM API started" in log, log[-300:])
check("shutdown is logged", "ITAM API shutting down" in log and "ITAM API stopped" in log, log[-300:])
port2 = free_port()
server = start_server(port2)
check("the process starts again after being stopped", wait_up(port2, server), open(LOG_FILE).read()[-300:])
code, after = http(port2, "GET", f"/asset-requests/{ticket.get('id')}/attachments/{att.get('id')}", token=AGENT_TOKEN, raw=True)
check("the uploaded file is still there after the restart (stored in the database)", code == 200 and after == before, code)
code, other = http(port2, "GET", f"/asset-requests/{ticket.get('id')}/attachments/{att.get('id')}")
check("the file is not downloadable without signing in (401)", code == 401, code)
server.send_signal(signal.SIGTERM)
server.wait(timeout=20)
log = open(LOG_FILE).read()
check("logs never contain the JWT secret", JWT not in log)
check("logs never contain the tokens", ADMIN_TOKEN not in log and AGENT_TOKEN not in log)

print("Readiness with the database gone (in-process)")
import threading  # noqa: E402
import uvicorn  # noqa: E402
from app.core.database import get_db  # noqa: E402
from app.main import app  # noqa: E402

broken = sessionmaker(bind=create_engine("sqlite:////nonexistent-folder/itam.db", connect_args={"check_same_thread": False}))


def broken_db():
    session = broken()
    try:
        yield session
    finally:
        session.close()


app.dependency_overrides[get_db] = broken_db
PORT_B = free_port()
inproc = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=PORT_B, log_level="critical", lifespan="off", proxy_headers=False))
threading.Thread(target=inproc.run, daemon=True).start()
while not inproc.started:
    time.sleep(0.05)
code, data = http(PORT_B, "GET", "/health/live")
check("liveness stays 200 when the database is unavailable", code == 200, (code, data))
code, data = http(PORT_B, "GET", "/health/ready")
check("readiness answers 503 when the database is unavailable", code == 503, (code, data))
check("and says only 'unavailable'", data == {"status": "unavailable"}, data)
code, data = http(PORT_B, "GET", "/health")
check("/api/health answers 503 as well", code == 503, (code, data))
code, data = http(PORT_B, "POST", "/auth/login", {"email": "a@b.com", "password": "password123"})
body = json.dumps(data) if not isinstance(data, bytes) else data.decode(errors="replace")
check("an API error caused by the database never reveals internals (no SQL, path or driver names)",
      code >= 500 and "sqlite" not in body.lower() and "Traceback" not in body and "nonexistent" not in body
      and "sqlalchemy" not in body.lower(), (code, body[:200]))
app.dependency_overrides.clear()
inproc.should_exit = True

print("Production mode (separate processes; nothing connects to a database)")
PROD_ENV = {
    "ENVIRONMENT": "production", "JWT_SECRET": JWT,
    "DATABASE_URL": f"postgresql+psycopg2://itam:{DB_PASSWORD_MARKER}@127.0.0.1:1/itam",
    "CORS_ORIGINS": "https://itam.example.com",
}
probe = ("import os; from app.main import app; "
         "print('docs=%s openapi=%s redoc=%s' % (app.docs_url, app.openapi_url, app.redoc_url))")
result = subprocess.run([sys.executable, "-c", probe], cwd=BACKEND, env={**os.environ, **PROD_ENV}, capture_output=True, text=True)
check("in production the interactive API docs and schema are not published",
      "docs=None openapi=None redoc=None" in result.stdout, result.stdout + result.stderr[-200:])
# Missing config: must fail to start, say why, and not print secrets.
bad_env = {k: v for k, v in os.environ.items() if k not in ("JWT_SECRET", "DATABASE_URL", "CORS_ORIGINS")}
bad_env.update({"ENVIRONMENT": "production", "DATABASE_URL": f"postgresql+psycopg2://itam:{DB_PASSWORD_MARKER}@127.0.0.1:1/itam"})
port3 = free_port()
log3 = os.path.join(WORKDIR, "prod-missing.log")
with open(log3, "wb") as handle:
    process = subprocess.Popen([sys.executable, "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", str(port3)],
                               cwd=BACKEND, env=bad_env, stdout=handle, stderr=subprocess.STDOUT)
    try:
        code3 = process.wait(timeout=30)
    except subprocess.TimeoutExpired:
        process.kill()
        code3 = "still running"
text = open(log3).read()
check("start-up fails (non-zero exit) when production configuration is missing", code3 not in (0, "still running"), code3)
check("and the log says what is unsafe", "Unsafe production configuration" in text and "JWT_SECRET" in text, text[-300:])
check("and the log does not contain the database password", DB_PASSWORD_MARKER not in text, text[-300:])

print("Configuration files and committed secrets")
import re  # noqa: E402

REPO = os.path.join(BACKEND, "..")
template = os.path.join(REPO, "deploy", "ec2", "itam.env.example")
values = {}
for line in open(template):
    line = line.strip()
    if line and not line.startswith("#") and "=" in line:
        key, _, value = line.partition("=")
        values[key] = value
check("the staging environment template exists and names the required variables",
      all(k in values for k in ("ENVIRONMENT", "DATABASE_URL", "JWT_SECRET", "CORS_ORIGINS", "TRUSTED_PROXY_COUNT", "ORIGIN_VERIFY_SECRET")), sorted(values))
msg = None
try:
    Settings(ENVIRONMENT=values["ENVIRONMENT"], SECRET_KEY=values["JWT_SECRET"], DATABASE_URL=values["DATABASE_URL"],
             CORS_ORIGINS=values["CORS_ORIGINS"]).check_production_safety()
except RuntimeError as error:
    msg = str(error)
check("the template cannot be started as it is: its CHANGE_ME placeholders are refused", msg is not None and "CHANGE_ME" in msg, msg)
msg_origin = None
try:
    Settings(**{**GOOD, "ORIGIN_VERIFY_SECRET": values["ORIGIN_VERIFY_SECRET"]}).check_production_safety()
except RuntimeError as error:
    msg_origin = str(error)
check("the template's origin secret placeholder is refused on its own", msg_origin is not None and "ORIGIN_VERIFY_SECRET" in msg_origin, msg_origin)
check("the template ships an empty previous secret and TRUSTED_PROXY_COUNT=2",
      values.get("ORIGIN_VERIFY_SECRET_PREVIOUS", None) == "" and values.get("TRUSTED_PROXY_COUNT") == "2", values)
check("the template defaults keep public sign-up closed",
      all(values.get(k) == "false" for k in ("ALLOW_PUBLIC_IT_ADMIN_SIGNUP", "ALLOW_PUBLIC_AGENT_SIGNUP", "ALLOW_PUBLIC_SUPER_ADMIN_SIGNUP")), values)
tracked = subprocess.run(["git", "ls-files"], cwd=REPO, capture_output=True, text=True)
if tracked.returncode == 0 and tracked.stdout.strip():
    files = [f for f in tracked.stdout.splitlines() if not f.endswith((".png", ".jpg", ".ico", ".svg", ".woff2", ".lock"))
             and "package-lock" not in f and "node_modules" not in f]
    check("no .env file is committed", not [f for f in files if os.path.basename(f) in (".env", ".env.local", ".env.production")],
          [f for f in files if os.path.basename(f).startswith(".env") and f.endswith(("env", "local", "production"))])
    patterns = {"AWS access key": re.compile(r"AKIA[0-9A-Z]{16}"), "private key": re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----"),
                "AWS secret key": re.compile(r"aws_secret_access_key\s*[=:]\s*['\"]?[A-Za-z0-9/+=]{40}")}
    hits = []
    for name in files:
        try:
            body = open(os.path.join(REPO, name), errors="ignore").read()
        except OSError:
            continue
        hits += [f"{name}: {label}" for label, pattern in patterns.items() if pattern.search(body)]
    check("no AWS keys or private keys are committed", hits == [], hits)
    # Environment variables that hold real values must come from the environment, not from code.
    code_hits = []
    for name in files:
        if name.startswith("backend/app/") and name.endswith(".py"):
            body = open(os.path.join(REPO, name), errors="ignore").read()
            if re.search(r"(password|secret)\s*=\s*['\"][^'\"]{8,}['\"]", body, re.I) and "config.py" not in name:
                code_hits.append(name)
    check("no password or secret is assigned from a string literal in application code", code_hits == [], code_hits)
else:
    print("  (skipped: not a git checkout)")

print(f"\n{sum(RESULTS)}/{len(RESULTS)} passed")
sys.exit(0 if all(RESULTS) else 1)
