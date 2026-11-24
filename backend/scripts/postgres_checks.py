"""
PostgreSQL readiness checks (the engine behind Amazon RDS).

Needs an EMPTY, DISPOSABLE PostgreSQL database; its name must contain "test" or "check".
It runs the whole Alembic history, so never point it at a real database.

    createdb itam_pg_check
    POSTGRES_CHECK_DATABASE_URL=postgresql+psycopg2://user:pass@localhost/itam_pg_check \
        .venv/bin/python scripts/postgres_checks.py

Checks: migration chain (single head, no gaps), upgrade / alembic check / downgrade / upgrade,
the schema against the models, constraints, transaction rollback, a concurrent-write race,
and the API starting in PRODUCTION mode against PostgreSQL (no fallback to SQLite).
Exits non-zero if any check fails.
"""
import json
import os
import re
import signal
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request

BACKEND = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
sys.path.insert(0, BACKEND)
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

URL = os.environ.get("POSTGRES_CHECK_DATABASE_URL")
if not URL:
    raise SystemExit(__doc__)
from _dbguard import require_disposable  # noqa: E402

require_disposable(URL, "POSTGRES_CHECK_DATABASE_URL")
JWT = "postgres-check-secret-0123456789abcdef0123456789abcd"
os.environ["DATABASE_URL"] = URL
os.environ["JWT_SECRET"] = JWT

from sqlalchemy import create_engine, inspect, text  # noqa: E402
from sqlalchemy.exc import IntegrityError  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402

RESULTS = []


def check(label, ok, detail=""):
    RESULTS.append(bool(ok))
    print(f"  {'PASS' if ok else 'FAIL'}  {label}" + ("" if ok else f"  -> {detail}"))


def alembic(*args):
    return subprocess.run([sys.executable, "-m", "alembic", *args], cwd=BACKEND,
                          env={**os.environ, "DATABASE_URL": URL}, capture_output=True, text=True)


engine = create_engine(URL)
check("the database is PostgreSQL", engine.dialect.name == "postgresql", engine.dialect.name)
with engine.connect() as conn:
    version = conn.execute(text("select version()")).scalar()
    leftover = inspect(conn).get_table_names()
print(f"  ({version.split(',')[0]})")
check("the database is empty before the run (nothing existing is touched)", leftover == [], leftover)

print("Migration chain")
versions_dir = os.path.join(BACKEND, "migrations", "versions")
revisions = {}
for name in sorted(os.listdir(versions_dir)):
    if not name.endswith(".py"):
        continue
    body = open(os.path.join(versions_dir, name)).read()
    rev = re.search(r"^revision(?:: str)?\s*=\s*['\"]([^'\"]+)['\"]", body, re.M)
    down = re.search(r"^down_revision(?:: [^=]+)?\s*=\s*(None|['\"]([^'\"]+)['\"])", body, re.M)
    if rev:
        revisions[rev.group(1)] = down.group(2) if down else None
check("migration files exist", len(revisions) > 0, len(revisions))
roots = [r for r, d in revisions.items() if d is None]
check("exactly one base revision", len(roots) == 1, roots)
check("every down_revision points at an existing revision", all(d is None or d in revisions for d in revisions.values()),
      [d for d in revisions.values() if d and d not in revisions])
parents = [d for d in revisions.values() if d]
check("no revision is the parent of two others (the history does not fork)", len(parents) == len(set(parents)),
      [p for p in parents if parents.count(p) > 1])
heads = [r for r in revisions if r not in parents]
check("exactly one head", len(heads) == 1, heads)
result = alembic("heads")
check("alembic agrees there is one head", result.returncode == 0 and result.stdout.count("(head)") == 1, result.stdout + result.stderr[-200:])

print("Upgrade, check, downgrade, upgrade")
result = alembic("upgrade", "head")
check(f"alembic upgrade head runs all {len(revisions)} migrations on a fresh database", result.returncode == 0, result.stderr[-400:])
result = alembic("check")
check("the models match the migrations (alembic check: no new operations)", result.returncode == 0 and "No new upgrade operations" in result.stdout,
      result.stdout[-200:] + result.stderr[-300:])
result = alembic("current")
check("the database is at the head revision", heads and heads[0] in result.stdout, result.stdout)
result = alembic("downgrade", "base")
check("alembic downgrade base works", result.returncode == 0, result.stderr[-300:])
with engine.connect() as conn:
    left = [t for t in inspect(conn).get_table_names() if t != "alembic_version"]
check("a full downgrade leaves no application tables", left == [], left)
result = alembic("upgrade", "head")
check("and upgrade head works again (repeatable)", result.returncode == 0, result.stderr[-300:])

print("Schema against the models")
from app.core.database import Base  # noqa: E402
import app.models.models  # noqa: E402,F401

with engine.connect() as conn:
    insp = inspect(conn)
    db_tables = set(insp.get_table_names()) - {"alembic_version"}
    model_tables = set(Base.metadata.tables)
    check("every model table exists in PostgreSQL and nothing extra does", db_tables == model_tables, (model_tables ^ db_tables))
    model_fks = sum(len(t.foreign_keys) for t in Base.metadata.tables.values())
    db_fks = sum(len(insp.get_foreign_keys(t)) for t in db_tables)
    check("every foreign key in the models exists in the database", model_fks == db_fks, (model_fks, db_fks))
    pk_missing = [t for t in db_tables if not insp.get_pk_constraint(t)["constrained_columns"]]
    check("every table has a primary key", pk_missing == [], pk_missing)
    user_uniques = {tuple(u["column_names"]) for u in insp.get_unique_constraints("users")} | \
        {tuple(i["column_names"]) for i in insp.get_indexes("users") if i["unique"]}
    check("users.email is unique at the database level", ("email",) in user_uniques, user_uniques)
    index_cols = {tuple(i["column_names"]) for t in ("asset_requests",) for i in insp.get_indexes(t)}
    check("ticket lookups are indexed (asset_requests.company_id / status)", ("company_id",) in index_cols and ("status",) in index_cols, index_cols)
    fk_cols = [(t, fk["constrained_columns"][0]) for t in db_tables for fk in insp.get_foreign_keys(t)]
    unindexed = []
    for t, col in fk_cols:
        covered = any(i["column_names"][:1] == [col] for i in insp.get_indexes(t)) or \
            insp.get_pk_constraint(t)["constrained_columns"][:1] == [col] or \
            any(u["column_names"][:1] == [col] for u in insp.get_unique_constraints(t))
        if not covered:
            unindexed.append(f"{t}.{col}")
print(f"  (info) {len(unindexed)} of {len(fk_cols)} foreign-key columns have no index (reads still work; "
      f"worth indexing as tables grow): {', '.join(unindexed[:6])}{'...' if len(unindexed) > 6 else ''}")

print("Transactions and constraints")
from app.models.models import Company, PlatformRole, User  # noqa: E402

Session = sessionmaker(bind=engine)


def make_user(email, company_id=None):
    return User(email=email, hashed_password="x", full_name="T", role=PlatformRole.EMPLOYEE, company_id=company_id, status="ACTIVE")


with Session() as db:
    db.add(make_user("dup@example.com"))
    db.commit()
with Session() as db:
    db.add(make_user("dup@example.com"))
    try:
        db.commit()
        duplicate = "accepted"
    except IntegrityError:
        db.rollback()
        duplicate = "refused"
check("a duplicate email is refused by the database (IntegrityError)", duplicate == "refused", duplicate)
with Session() as db:
    check("and the failed insert left nothing behind", db.query(User).filter(User.email == "dup@example.com").count() == 1)
with Session() as db:
    db.add(Company(name="Atomic Co", code="ATOMIC"))
    db.flush()
    db.add(make_user("dup@example.com"))
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
with Session() as db:
    check("a transaction is all-or-nothing: the company added before the failure is rolled back too",
          db.query(Company).filter(Company.code == "ATOMIC").count() == 0)
with Session() as db:
    company = Company(name="Ref Co", code="REF")
    db.add(company)
    db.flush()
    db.add(make_user("child@example.com", company.id))
    db.commit()
    company_id = company.id
with Session() as db:
    try:
        db.execute(text("delete from companies where id = :i"), {"i": company_id})
        db.commit()
        outcome = "deleted"
    except IntegrityError:
        db.rollback()
        outcome = "refused"
check("a company that still has users cannot be deleted (foreign key)", outcome == "refused", outcome)

print("Concurrent writes")
outcomes = []
gate = threading.Barrier(8)


def racer(i):
    with Session() as db:
        db.add(make_user("race@example.com"))
        gate.wait()
        try:
            db.commit()
            outcomes.append("ok")
        except IntegrityError:
            db.rollback()
            outcomes.append("refused")


threads = [threading.Thread(target=racer, args=(i,)) for i in range(8)]
[t.start() for t in threads]
[t.join() for t in threads]
check("8 simultaneous sign-ups with the same email: exactly one wins", outcomes.count("ok") == 1 and outcomes.count("refused") == 7, outcomes)
from app.core.config import settings  # noqa: E402
from app.core.database import engine as app_engine  # noqa: E402

check("the app's connection pool uses the configured size, pre-ping and recycling",
      app_engine.pool.size() == settings.DB_POOL_SIZE and app_engine.pool._pre_ping is True and app_engine.pool._recycle == 1800,
      (app_engine.pool.size(), app_engine.pool._pre_ping, app_engine.pool._recycle))

print("The API in production mode against PostgreSQL")


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def http(port, method, path, body=None, token=None, origin=True):
    request = urllib.request.Request(
        f"http://127.0.0.1:{port}/api{path}", data=json.dumps(body).encode() if body is not None else None, method=method,
        headers={"Content-Type": "application/json", **({"Authorization": f"Bearer {token}"} if token else {}),
                 **({"X-Origin-Verify": ORIGIN_SECRET} if origin else {})})
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            return response.status, json.loads(response.read() or b"{}")
    except urllib.error.HTTPError as error:
        try:
            return error.code, json.loads(error.read())
        except Exception:
            return error.code, {}


ORIGIN_SECRET = "pg" + "Hj4" * 15
PROD = {"ENVIRONMENT": "production", "ORIGIN_VERIFY_SECRET": ORIGIN_SECRET, "DATABASE_URL": URL, "JWT_SECRET": JWT, "CORS_ORIGINS": "https://itam.example.com",
        "SEED_SUPER_ADMIN_EMAIL": "root@itam.example.com", "SEED_SUPER_ADMIN_PASSWORD": "A-long-seed-password-1"}
port = free_port()
logfile = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".pgcheck.log"), "wb")
server = subprocess.Popen([sys.executable, "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", str(port), "--no-proxy-headers"],
                          cwd=BACKEND, env={**os.environ, **PROD}, stdout=logfile, stderr=subprocess.STDOUT)
up = False
for _ in range(150):
    if server.poll() is not None:
        break
    try:
        urllib.request.urlopen(f"http://127.0.0.1:{port}/api/health/ready", timeout=1)
        up = True
        break
    except Exception:
        time.sleep(0.2)
check("production mode starts against PostgreSQL and readiness answers 200", up, "")
code, data = http(port, "POST", "/auth/login", {"email": "root@itam.example.com", "password": "A-long-seed-password-1", "role": "SUPER_ADMIN"}, origin=False)
check("production + PostgreSQL + origin secret: a request that skipped CloudFront (no header) is refused (403)", code == 403, (code, data))
code, data = http(port, "POST", "/auth/login", {"email": "root@itam.example.com", "password": "A-long-seed-password-1", "role": "SUPER_ADMIN"})
check("the seeded Super Admin signs in with email and password", code == 200 and data.get("role") == "SUPER_ADMIN", (code, data))
token = data.get("access_token")
code, data = http(port, "POST", "/super-admin/companies", {"name": "Pg Check Co", "code": "PGCHK"}, token=token)
check("a write through the API reaches PostgreSQL (the Super Admin creates a company: 201)", code == 201 and data.get("code") == "PGCHK", (code, data))
with Session() as db:
    check("and the row is really in PostgreSQL", db.query(Company).filter(Company.code == "PGCHK").count() == 1)
code, data = http(port, "GET", "/users/unassigned", token=token)
check("a read through the API works (Super Admin lists unassigned users)", code == 200, (code, data))
server.send_signal(signal.SIGTERM)
try:
    server.wait(timeout=20)
    stopped = True
except subprocess.TimeoutExpired:
    server.kill()
    stopped = False
check("SIGTERM stops it", stopped)
logfile.close()
pg_log = open(os.path.join(BACKEND, ".pgcheck.log")).read()
check("the log never contains the origin secret, the JWT secret or the seeded password",
      ORIGIN_SECRET not in pg_log and JWT not in pg_log and "A-long-seed-password-1" not in pg_log)
check("start-up says origin verification is on", "Origin verification is on" in pg_log, pg_log[-200:])
# Production WITHOUT the origin secret (how Docker and local production-mode runs behave): it must start, and warn.
port_n = free_port()
with open(os.path.join(BACKEND, ".pgcheck3.log"), "wb") as handle_n:
    env_n = {**os.environ, **PROD}
    env_n.pop("ORIGIN_VERIFY_SECRET")
    server_n = subprocess.Popen([sys.executable, "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", str(port_n), "--no-proxy-headers"],
                                cwd=BACKEND, env=env_n, stdout=handle_n, stderr=subprocess.STDOUT)
    up_n = False
    for _ in range(150):
        if server_n.poll() is not None:
            break
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{port_n}/api/health/ready", timeout=1)
            up_n = True
            break
        except Exception:
            time.sleep(0.2)
    code_n, _data = http(port_n, "POST", "/auth/login", {"email": "root@itam.example.com", "password": "A-long-seed-password-1", "role": "SUPER_ADMIN"}, origin=False)
    server_n.send_signal(signal.SIGTERM)
    try:
        server_n.wait(timeout=20)
    except subprocess.TimeoutExpired:
        server_n.kill()
log_n = open(os.path.join(BACKEND, ".pgcheck3.log")).read()
check("production without ORIGIN_VERIFY_SECRET still starts and signs in with no header (Docker / local behaviour)", up_n and code_n == 200, (up_n, code_n))
check("and it logs a warning that requests are not verified as coming through CloudFront", "ORIGIN_VERIFY_SECRET is not set" in log_n, log_n[-200:])
# No silent fallback to SQLite: an unreachable PostgreSQL must stop start-up.
unreachable = URL.rsplit("@", 1)[0] + "@127.0.0.1:1/" + URL.rsplit("/", 1)[1]
port = free_port()
with open(os.path.join(BACKEND, ".pgcheck2.log"), "wb") as handle:
    server = subprocess.Popen([sys.executable, "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", str(port)],
                              cwd=BACKEND, env={**os.environ, **PROD, "DATABASE_URL": unreachable}, stdout=handle, stderr=subprocess.STDOUT)
    try:
        exit_code = server.wait(timeout=60)
    except subprocess.TimeoutExpired:
        server.kill()
        exit_code = "still running"
check("with PostgreSQL unreachable, production start-up fails instead of falling back to SQLite",
      exit_code not in (0, "still running"), exit_code)
for leftover_log in (".pgcheck.log", ".pgcheck2.log", ".pgcheck3.log"):
    try:
        os.remove(os.path.join(BACKEND, leftover_log))
    except OSError:
        pass

print(f"\n{sum(RESULTS)}/{len(RESULTS)} passed")
sys.exit(0 if all(RESULTS) else 1)
