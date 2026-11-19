"""
Security checks: tenant isolation, role scoping and privilege escalation.

Runs the real app on a throwaway SQLite database and signs requests with
real JWTs, so the auth dependencies and the ScopedRoleWriteGuard are
exercised exactly as in production.

    cd backend && .venv/bin/python scripts/security_test.py

Exits non-zero if any check fails.
"""
import json
import os
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

import uvicorn  # noqa: E402
from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402

from app.core.database import Base, get_db  # noqa: E402
from app.core.security import create_access_token, token_claims  # noqa: E402
from app.main import app  # noqa: E402
from app.models.models import Company, PlatformRole, Subscription, User  # noqa: E402

PORT = 8769
# SECURITY_TEST_DATABASE_URL runs the suite against an empty, already-migrated
# PostgreSQL database (alembic upgrade head); by default a throwaway SQLite file.
_url = os.environ.get("SECURITY_TEST_DATABASE_URL")
if _url:
    engine = create_engine(_url)
else:
    engine = create_engine(
        f"sqlite:///{os.path.join(tempfile.mkdtemp(), 'security.db')}", connect_args={"check_same_thread": False}
    )
    Base.metadata.create_all(engine)
Session = sessionmaker(bind=engine)

TOKENS: dict = {}
IDS: dict = {}
with Session() as db:
    for org in ("A", "B"):
        company = Company(name=f"Org {org}", code=org)
        db.add(company)
        db.flush()
        db.add(Subscription(company_id=company.id, plan="ENTERPRISE", user_limit=100, asset_limit=100))
        accounts = [("admin", PlatformRole.IT_ADMIN, None)]
        if org == "A":
            accounts += [
                ("sam", PlatformRole.SUB_ADMIN, ["SAM"]),
                ("ham", PlatformRole.SUB_ADMIN, ["HAM", "REPORTS"]),
                ("report", PlatformRole.REPORTING_USER, None),
                ("agent", PlatformRole.EMPLOYEE, None),
            ]
        for key, role, modules in accounts:
            user = User(email=f"{key}.{org.lower()}@example.com", hashed_password="x", full_name=f"{key} {org}",
                        role=role, company_id=company.id, status="ACTIVE", modules=modules)
            db.add(user)
            db.flush()
            TOKENS[f"{key}{org}"] = create_access_token(token_claims(user))
            IDS[f"{key}{org}"] = user.id
    db.commit()


def override_db():
    session = Session()
    try:
        yield session
    finally:
        session.close()


app.dependency_overrides[get_db] = override_db
server = uvicorn.Server(uvicorn.Config(app, port=PORT, log_level="critical", lifespan="off", proxy_headers=False))
threading.Thread(target=server.run, daemon=True).start()
while not server.started:
    time.sleep(0.05)


def call(who, method, path, body=None):
    request = urllib.request.Request(
        f"http://127.0.0.1:{PORT}/api{path}",
        data=json.dumps(body).encode() if body is not None else None,
        method=method,
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {TOKENS[who]}"},
    )
    try:
        with urllib.request.urlopen(request) as response:
            return response.status, json.loads(response.read() or b"{}")
    except urllib.error.HTTPError as error:
        return error.code, error.read().decode()[:160]


RESULTS = []


def check(label, ok, detail=""):
    RESULTS.append(bool(ok))
    print(f"  {'PASS' if ok else 'FAIL'}  {label}" + ("" if ok else f"  -> {detail}"))


def created(who, method, path, body, key="id"):
    code, data = call(who, method, path, body)
    if code not in (200, 201) or not isinstance(data, dict):
        raise SystemExit(f"setup failed: {method} {path} -> {code} {data}")
    return data[key]


# --- Organization A creates one of everything -------------------------------
A = {}
A["dept"] = created("adminA", "POST", "/departments", {"name": "Finance"})
A["cat"] = created("adminA", "POST", "/assets/categories", {"name": "Laptop"})
A["asset"] = created("adminA", "POST", "/assets", {"asset_tag": "A-1", "serial_number": "SA1", "name": "A laptop", "category": "Laptop"})
A["user"] = created("adminA", "POST", "/users", {"email": "emp.a@example.com", "full_name": "Emp A", "password": "password123", "role": "EMPLOYEE"})
A["ticket"] = created("adminA", "POST", "/asset-requests", {"asset_category_id": A["cat"], "reason": "need"})
A["item"] = created("adminA", "POST", "/inventory", {"name": "Cable", "category": "C", "quantity": 5})
A["vendor"] = created("adminA", "POST", "/vendors", {"name": "V"})
A["po"] = created("adminA", "POST", "/purchase-orders", {"po_number": "P1", "vendor_id": A["vendor"], "total_amount": "10"})
A["sw"] = created("adminA", "POST", "/software", {"name": "Office", "total_licenses": 2})
A["mnt"] = created("adminA", "POST", "/maintenance", {"asset_id": A["asset"], "issue": "x", "status": "SCHEDULED"})
A["audit"] = created("adminA", "POST", "/physical-audit/sessions", {"title": "Audit A"}, key="session_id")
A["cloud"] = created("adminA", "POST", "/cloud/resources", {"provider": "AWS", "account_id": "1", "resource_id": "i-1", "resource_type": "EC2"})
A["device"] = created("adminA", "POST", "/discovery/agent-ingest", {"hostname": "h", "ip_address": "1.1.1.1", "mac_address": "aa"}, key="device_id")
code, run = call("adminA", "POST", "/reports/runs", {"report_type": "asset_inventory", "save": True})
A["run"], A["saved"] = run["id"], run["report_config_id"]
A["claim"] = created("adminA", "POST", "/warranty-maintenance/claims", {"asset_id": A["asset"], "issue_description": "broken"})

# --- Tenant isolation: organization B's admin attacks A's records -------------
print("Tenant isolation")
attacks = [
    ("GET", f"/assets/{A['asset']}", None), ("PUT", f"/assets/{A['asset']}", {"name": "pwned"}),
    ("POST", f"/assets/{A['asset']}/assign", {"user_id": IDS["adminB"]}), ("POST", f"/assets/{A['asset']}/unassign", None),
    ("GET", f"/assets/{A['asset']}/lifecycle", None), ("DELETE", f"/assets/{A['asset']}", None),
    ("GET", f"/users/{A['user']}", None), ("PUT", f"/users/{A['user']}", {"full_name": "pwned"}), ("DELETE", f"/users/{A['user']}", None),
    ("POST", f"/users/{A['user']}/reset-password", {"new_password": "pwned1234"}), ("GET", f"/users/{A['user']}/activity", None),
    ("POST", f"/users/{A['user']}/reactivate", None),
    ("DELETE", f"/departments/{A['dept']}", None),
    ("GET", f"/asset-requests/{A['ticket']}", None), ("PUT", f"/asset-requests/{A['ticket']}", {"status": "REJECTED", "rejection_reason": "x"}),
    ("GET", f"/inventory/{A['item']}", None), ("PUT", f"/inventory/{A['item']}", {"quantity": 0}),
    ("POST", f"/inventory/{A['item']}/adjust", {"change": -1, "reason": "x"}), ("DELETE", f"/inventory/{A['item']}", None),
    ("GET", f"/vendors/{A['vendor']}", None), ("PUT", f"/vendors/{A['vendor']}", {"name": "pwned"}), ("DELETE", f"/vendors/{A['vendor']}", None),
    ("PUT", f"/purchase-orders/{A['po']}/status", {"status": "CANCELLED"}),
    ("POST", "/purchase-orders", {"po_number": "X", "vendor_id": A["vendor"], "total_amount": "1"}),
    ("GET", f"/software/{A['sw']}", None), ("POST", f"/software/{A['sw']}/assign", {"user_id": IDS["adminB"]}), ("DELETE", f"/software/{A['sw']}", None),
    ("GET", f"/maintenance/{A['mnt']}", None), ("PUT", f"/maintenance/{A['mnt']}", {"status": "CANCELLED"}),
    ("POST", "/maintenance", {"asset_id": A["asset"], "issue": "x"}),
    ("GET", f"/physical-audit/sessions/{A['audit']}", None), ("GET", f"/physical-audit/sessions/{A['audit']}/scans", None),
    ("POST", f"/physical-audit/sessions/{A['audit']}/scan", {"asset_tag": "A-1"}), ("POST", f"/physical-audit/sessions/{A['audit']}/complete", None),
    ("PUT", f"/cloud/resources/{A['cloud']}", {"status": "STOPPED"}),
    ("POST", f"/discovery/reconcile/{A['device']}", {"asset_tag": "Z", "category": "Desktop"}), ("POST", f"/discovery/devices/{A['device']}/ignore", None),
    ("GET", f"/reports/runs/{A['run']}/download", None), ("POST", f"/reports/saved/{A['saved']}/run", None), ("DELETE", f"/reports/saved/{A['saved']}", None),
    ("POST", f"/depreciation/calculate/{A['asset']}", {}),
    ("POST", "/warranty-maintenance/claims", {"asset_id": A["asset"], "issue_description": "x"}),
    ("PUT", f"/warranty-maintenance/claims/{A['claim']}", {"status": "APPROVED"}),
    ("POST", "/asset-requests", {"asset_category_id": A["cat"], "reason": "x"}),
    ("POST", "/asset-requests/returns", {"asset_id": A["asset"], "reason": "x"}),
    ("POST", "/assets", {"asset_tag": "B-1", "serial_number": "SB1", "name": "x", "category": "Laptop", "department_id": A["dept"]}),
    ("POST", "/assets", {"asset_tag": "B-2", "serial_number": "SB2", "name": "x", "category": "Laptop", "vendor_id": A["vendor"]}),
    ("POST", "/users", {"email": "x.b@example.com", "full_name": "X", "password": "password123", "department_id": A["dept"]}),
]
# A request that names one of A's records must be refused as forbidden/not found
# (never 200, never a 400/422 that merely reflects a bad body, never a 5xx).
# Requests that create a new record pointing at A's data may also be 400.
A_VALUES = {str(v) for v in A.values()}
for method, path, body in attacks:
    names_a_record = any(value in path for value in A_VALUES)
    allowed = (403, 404) if names_a_record else (400, 403, 404)
    code, data = call("adminB", method, path, body)
    check(f"B cannot {method} {path.split('/')[1]}{' ' + path.split('/')[-1] if path.count('/') > 2 else ''}",
          code in allowed, f"{code} {data}")

# Nothing of A's was changed by those attacks.
code, data = call("adminA", "GET", f"/assets/{A['asset']}")
check("A's asset is unchanged after B's attacks", code == 200 and data.get("name") == "A laptop" and data.get("status") != "ASSIGNED", data)
code, data = call("adminA", "GET", f"/users/{A['user']}")
check("A's user is unchanged after B's attacks", code == 200 and data.get("full_name") == "Emp A" and data.get("status") == "ACTIVE", data)
code, data = call("adminA", "GET", f"/vendors/{A['vendor']}")
check("A's vendor still exists after B's attacks", code == 200, data)
code, data = call("adminA", "GET", f"/inventory/{A['item']}")
check("A's inventory item is unchanged after B's attacks", code == 200 and data.get("quantity") == 5, data)
with Session() as db:
    emp = db.query(User).filter(User.id == A["user"]).first()
    from app.core.security import verify_password as _vp  # noqa: E402
    check("A's user password was not reset by B", _vp("password123", emp.hashed_password))

a_ids = [str(v) for v in A.values()] + [v for k, v in IDS.items() if k.endswith("A")]
for path in ["/assets", "/users", "/departments", "/asset-requests", "/inventory", "/vendors", "/purchase-orders", "/software",
             "/maintenance", "/physical-audit/sessions", "/cloud/resources", "/discovery/devices", "/reports/runs", "/reports/saved",
             "/warranty-maintenance/claims", "/assets/events", "/audit-logs", "/notifications", "/assets/categories",
             "/users/directory", "/warranty-maintenance/coverage"]:
    code, data = call("adminB", "GET", path)
    leaked = [value for value in a_ids if value in json.dumps(data)]
    check(f"B's list {path} shows none of A's records", not leaked, leaked)

# --- Role scoping -----------------------------------------------------------
print("Role scoping")
code, data = call("samA", "POST", "/software", {"name": "Office 2", "total_licenses": 1})
check("SAM sub-admin can add software", code == 201, data)
code, data = call("samA", "POST", "/assets", {"asset_tag": "X", "serial_number": "X", "name": "x", "category": "Laptop"})
check("SAM sub-admin cannot register hardware", code == 403, data)
code, data = call("samA", "GET", "/assets")
check("SAM sub-admin can still view assets", code == 200, data)
code, data = call("hamA", "POST", "/assets", {"asset_tag": "H", "serial_number": "H", "name": "h", "category": "Laptop"})
check("HAM sub-admin registers hardware", code == 201, data)
code, data = call("hamA", "POST", "/cloud/resources", {"provider": "AWS", "account_id": "1", "resource_id": "i-2", "resource_type": "EC2"})
check("HAM sub-admin cannot add cloud resources", code == 403, data)
code, data = call("hamA", "POST", "/reports/runs", {"report_type": "asset_inventory"})
check("HAM+REPORTS sub-admin runs reports", code == 201, data)
code, data = call("reportA", "POST", "/reports/runs", {"report_type": "asset_inventory"})
check("reporting user runs reports", code == 201, data)
code, data = call("reportA", "POST", "/asset-requests", {"asset_category_id": A["cat"], "reason": "x"})
check("reporting user cannot raise tickets", code == 403, data)
code, data = call("reportA", "PUT", "/profile", {"name": "Report User"})
check("reporting user edits own profile", code == 200, data)
code, data = call("samA", "GET", "/profile")
check("profile lists sub-admin modules", code == 200 and data["user"]["modules"] == ["SAM"], data)
code, data = call("agentA", "PUT", f"/assets/{A['asset']}", {"name": "renamed"})
check("IT Agent cannot edit asset details", code == 403, data)
code, data = call("agentA", "DELETE", f"/assets/{A['asset']}")
check("IT Agent cannot remove assets", code == 403, data)
code, data = call("samA", "DELETE", f"/assets/{A['asset']}")
check("SAM sub-admin cannot remove hardware assets", code == 403, data)
code, data = call("reportA", "DELETE", f"/assets/{A['asset']}")
check("reporting user cannot remove assets", code == 403, data)
code, data = call("agentA", "POST", "/users", {"email": "y@example.com", "full_name": "Y", "password": "password123"})
check("IT Agent cannot create users", code == 403, data)

# --- Privilege escalation ---------------------------------------------------
print("Privilege escalation")
code, data = call("adminA", "POST", "/users", {"email": "boss@example.com", "full_name": "Boss", "password": "password123", "role": "SUPER_ADMIN"})
check("IT Admin cannot create a Super Admin", code == 403, data)
code, data = call("adminA", "PUT", f"/users/{A['user']}", {"role": "SUPER_ADMIN"})
check("IT Admin cannot promote a user to Super Admin", code == 403, data)
code, data = call("adminA", "PUT", f"/users/{IDS['adminA']}", {"role": "EMPLOYEE"})
check("IT Admin cannot change their own role", code == 400, data)
code, data = call("adminA", "PUT", f"/users/{IDS['adminA']}", {"status": "INACTIVE"})
check("IT Admin cannot deactivate themselves", code == 400, data)
code, data = call("adminA", "PUT", f"/users/{A['user']}", {"status": "BANANA"})
check("user status must be ACTIVE or INACTIVE", code == 400, data)
code, data = call("adminA", "POST", "/users", {"email": "sub@example.com", "full_name": "Sub", "password": "password123", "role": "SUB_ADMIN", "modules": []})
check("Sub-admin needs at least one module", code == 400, data)
code, data = call("adminA", "POST", "/users", {"email": "sub@example.com", "full_name": "Sub", "password": "password123", "role": "SUB_ADMIN", "modules": ["ROOT"]})
check("unknown Sub-admin module is refused", code == 400, data)
code, data = call("adminA", "PUT", f"/users/{A['user']}", {"role": "SUB_ADMIN", "modules": ["SAM", "SAM"]})
check("promoting to Sub-admin stores modules once", code == 200 and data.get("modules") == ["SAM"], data)
code, data = call("adminA", "PUT", f"/users/{A['user']}", {"role": "EMPLOYEE"})
check("demoting from Sub-admin clears modules", code == 200 and not data.get("modules"), data)

# --- Audit fixes: sessions, resets, registration, proxies, limits -----------
print("Audit fixes")
from app.core.config import settings  # noqa: E402
import app.core.rate_limit as rate_limit  # noqa: E402


def raw(method, path, body=None, token=None, headers=None, data=None):
    hdrs = {"Content-Type": "application/json", **(headers or {})}
    if token:
        hdrs["Authorization"] = f"Bearer {token}"
    payload = data if data is not None else (json.dumps(body).encode() if body is not None else None)
    request = urllib.request.Request(f"http://127.0.0.1:{PORT}/api{path}", data=payload, method=method, headers=hdrs)
    try:
        with urllib.request.urlopen(request) as response:
            return response.status, json.loads(response.read() or b"{}"), response.headers
    except urllib.error.HTTPError as error:
        text = error.read().decode()
        try:
            return error.code, json.loads(text), error.headers
        except ValueError:
            return error.code, text, error.headers


settings.AUTH_RATE_LIMIT_PER_MINUTE = 1000

# --- Registration policy ------------------------------------------------------
print("Registration policy")
from app.models.models import Notification  # noqa: E402


def user_count(email):
    with Session() as db:
        return db.query(User).filter(func.lower(User.email) == email.lower()).count()


from sqlalchemy import func  # noqa: E402
check("public admin registration is OFF by default", settings.ALLOW_PUBLIC_ADMIN_REGISTRATION is False)
check("public agent registration is OFF by default", settings.ALLOW_PUBLIC_AGENT_REGISTRATION is False)
code, data, _ = raw("GET", "/auth/registration-options")
check("registration-options reports everything closed", code == 200 and data == {"admin": False, "agent": False}, data)

key = "k" * 12
attempts = [
    ("IT_ADMIN", {}), ("SUPER_ADMIN", {"registrationKey": key, "registrationKeyConfirm": key}),
    ("IT_AGENT", {}),
]
for role, extra in attempts:
    for email in (f"eve.{role.lower()}@example.com", f"EVE.{role.lower()}@EXAMPLE.COM "):
        code, data, _ = raw("POST", "/auth/register", {"name": "Eve", "email": email, "password": "password123", "role": role, **extra})
        check(f"public {role} registration refused ({email.strip()})", code == 403, (code, data))
        check(f"  ...and no {role} account exists for {email.strip()}", user_count(email.strip()) == 0)
for role in ("it_admin", "GOD", "", "SUB_ADMIN", "REPORTING_USER", "EMPLOYEE"):
    code, data, _ = raw("POST", "/auth/register", {"name": "Eve", "email": "eve.role@example.com", "password": "password123", "role": role})
    check(f"registering with role '{role}' is refused", code in (400, 403, 422), (code, data))
check("  ...and none of those created an account", user_count("eve.role@example.com") == 0)

# Privileged accounts cannot be created by non-admins either.
for who in ("agentA", "reportA", "samA"):
    code, data = call(who, "POST", "/users", {"email": f"p.{who}@example.com", "full_name": "P", "password": "password123", "role": "IT_ADMIN"})
    check(f"{who} cannot create an IT Admin", code == 403, (code, data))
    code, data = call(who, "POST", "/super-admin/admins", {"name": "P", "email": f"s.{who}@example.com", "password": "password123456"})
    check(f"{who} cannot create a Super Admin", code == 403, (code, data))
code, data = call("adminA", "POST", "/super-admin/admins", {"name": "P", "email": "s.adminA@example.com", "password": "password123456"})
check("an IT Admin cannot create a Super Admin", code == 403, (code, data))
code, data = call("adminA", "POST", "/super-admin/companies", {"name": "Rogue Co", "admin_name": "R", "admin_email": "rogue@example.com", "admin_password": "password123"})
check("an IT Admin cannot create an organization", code == 403, (code, data))

# The operator may open sign-up; an admin opens a company only through a Super Admin.
settings.ALLOW_PUBLIC_AGENT_REGISTRATION = True
code, data, _ = raw("GET", "/auth/registration-options")
check("registration-options reflects the setting", code == 200 and data == {"admin": False, "agent": True}, data)
code, data, _ = raw("POST", "/auth/register", {"name": "Eve", "email": "eve.admin2@example.com", "password": "password123", "role": "IT_ADMIN"})
check("opening agent sign-up does not open IT Admin sign-up", code == 403 and user_count("eve.admin2@example.com") == 0, (code, data))

# --- Unassigned user takeover -------------------------------------------------
print("Unassigned users")
with Session() as db:
    root = User(email="boss.root@example.com", hashed_password="x", full_name="Root", role=PlatformRole.SUPER_ADMIN, status="ACTIVE")
    db.add(root)
    db.commit()
    TOKENS["root"] = create_access_token(token_claims(root))
    IDS["root"] = root.id
    companyB = db.query(User).filter(User.id == IDS["adminB"]).first().company_id
    companyA = db.query(User).filter(User.id == IDS["adminA"]).first().company_id

code, data, _ = raw("POST", "/auth/register", {"name": "Case Agent", "email": "Case.Agent@Example.com", "password": "password123", "role": "IT_AGENT"})
check("agent registers with a mixed-case email (sign-up open)", code == 200, data)
code, dup, _ = raw("POST", "/auth/register", {"name": "Dup", "email": "case.agent@example.com", "password": "password123", "role": "IT_AGENT"})
check("same email in another case is a duplicate", code == 400, dup)
code, data, _ = raw("POST", "/auth/login", {"email": "CASE.AGENT@EXAMPLE.COM", "password": "password123"})
check("login ignores email case", code == 200, data)
old_token = data["access_token"] if code == 200 else ""
code, me, _ = raw("GET", "/auth/me", token=old_token)
check("fresh token works", code == 200 and me.get("company_id") is None, me)
agent_id = me.get("id") if code == 200 else None

for who in ("adminA", "adminB", "samA", "hamA", "reportA", "agentA"):
    code, data = call(who, "GET", "/users/unassigned")
    check(f"{who} cannot list users who have no company", code == 403 and "case.agent" not in json.dumps(data), (code, data))
    code, data = call(who, "POST", f"/users/{agent_id}/add-to-organization", {"company_id": companyB})
    check(f"{who} cannot attach an unassigned user to an organization", code == 403, (code, data))
code, data = call("adminB", "POST", f"/users/{agent_id}/add-to-organization")
check("add-to-organization without a body is refused", code in (403, 422), (code, data))
for method, path, body in [
    ("GET", f"/users/{agent_id}", None), ("PUT", f"/users/{agent_id}", {"full_name": "pwned"}),
    ("GET", f"/users/{agent_id}/activity", None),
    ("POST", f"/users/{agent_id}/reset-password", {"new_password": "hijacked123"}),
    ("DELETE", f"/users/{agent_id}", None), ("POST", f"/users/{agent_id}/reactivate", None),
]:
    for who in ("adminA", "adminB"):
        code, data = call(who, method, path, body)
        check(f"{who} cannot {method} an unassigned user's {path.split('/')[-1] if path.count('/') > 2 else 'record'}", code in (403, 404), (code, data))
code, data, _ = raw("POST", "/auth/login", {"email": "case.agent@example.com", "password": "hijacked123"})
check("the unassigned user's password was not changed by the attacks", code == 401, data)
code, data, _ = raw("POST", "/auth/login", {"email": "case.agent@example.com", "password": "password123"})
check("the unassigned user can still sign in with their own password", code == 200, data)
with Session() as db:
    check("the unassigned user is still unassigned and active", (lambda u: u.company_id is None and u.status == "ACTIVE" and u.full_name == "Case Agent")(db.query(User).filter(User.id == agent_id).first()))

# A Super Admin is the authorized path.
code, data = call("root", "GET", "/users/unassigned")
check("a Super Admin can list users who have no company", code == 200 and any(u["id"] == agent_id for u in data), (code, data))
code, data = call("root", "POST", f"/users/{agent_id}/add-to-organization", {"company_id": "no-such-company"})
check("assigning to an unknown organization is refused", code == 404, (code, data))
code, data = call("root", "POST", f"/users/{agent_id}/add-to-organization", {"company_id": companyB})
check("a Super Admin can place the user in an organization", code == 200 and data.get("company_id") == companyB, (code, data))
code, data = call("root", "POST", f"/users/{agent_id}/add-to-organization", {"company_id": companyA})
check("an already-assigned user cannot be moved again", code == 400, (code, data))

# Two organizations cannot manipulate each other's users.
code, data = call("adminA", "POST", f"/users/{agent_id}/reset-password", {"new_password": "hijacked123"})
check("organization A's admin cannot reset organization B's user", code == 404, (code, data))
for method, path, body in [("GET", f"/users/{agent_id}", None), ("PUT", f"/users/{agent_id}", {"full_name": "pwned"}),
                           ("DELETE", f"/users/{agent_id}", None), ("POST", f"/users/{agent_id}/reactivate", None),
                           ("GET", f"/users/{agent_id}/activity", None)]:
    code, data = call("adminA", method, path, body)
    check(f"organization A's admin cannot {method} organization B's user ({path.split('/')[-1] if path.count('/') > 2 else 'record'})", code == 404, (code, data))
for method, path, body in [("GET", f"/users/{IDS['adminA']}", None), ("POST", f"/users/{IDS['adminA']}/reset-password", {"new_password": "hijacked123"}),
                           ("DELETE", f"/users/{IDS['adminA']}", None)]:
    code, data = call("adminB", method, path, body)
    check(f"organization B's admin cannot {method} organization A's admin ({path.split('/')[-1] if path.count('/') > 2 else 'record'})", code == 404, (code, data))
code, data, _ = raw("POST", "/auth/login", {"email": "case.agent@example.com", "password": "password123"})
check("the user's password survived organization A's attacks", code == 200, data)
code, data = call("adminB", "GET", f"/users/{agent_id}")
check("organization B's admin can see their new user", code == 200, (code, data))
code, data = call("adminA", "GET", "/users?limit=200")
check("organization A's user list does not include organization B's users", code == 200 and all(u["company_id"] == companyA for u in data), data)

# Password change invalidates earlier tokens and hands back a new one.
code, data, _ = raw("POST", "/auth/change-password", {"current_password": "password123", "new_password": "newpassword456"}, token=old_token)
check("password change succeeds", code == 200 and "access_token" in data, data)
new_token = data.get("access_token", "") if code == 200 else ""
code, data, _ = raw("GET", "/auth/me", token=old_token)
check("token from before the password change is rejected", code == 401, data)
code, data, _ = raw("GET", "/auth/me", token=new_token)
check("token returned by the password change works", code == 200, data)

# Admin reset invalidates the user's sessions too.
code, data, _ = raw("POST", "/auth/login", {"email": "case.agent@example.com", "password": "newpassword456"})
session_token = data.get("access_token", "")
code, data = call("adminB", "POST", f"/users/{agent_id}/reset-password", {"new_password": "temporary789"})
check("admin of the agent's company can reset the password", code == 200, data)
code, data, _ = raw("GET", "/auth/me", token=session_token)
check("token from before an admin reset is rejected", code == 401, data)

# Tokens without the password fingerprint (e.g. forged with a stolen secret format) are refused.
legacy = create_access_token({"sub": IDS["adminA"]})
code, data, _ = raw("GET", "/auth/me", token=legacy)
check("token without a password fingerprint is rejected", code == 401, data)

# Reports are limited to Sub-admins who hold the REPORTS module.
code, data = call("samA", "GET", "/reports/runs")
check("Sub-admin without REPORTS cannot read reports", code == 403, data)
code, data = call("hamA", "GET", "/reports/runs")
check("Sub-admin with REPORTS can read reports", code == 200, data)

# --- Reporting user permissions ------------------------------------------------
print("Reporting user permissions")
RESTRICTED_READS = [
    "/assets", "/assets/counts", f"/assets/{A['asset']}", "/assets/categories", "/assets/events",
    "/users", "/users/counts", "/users/directory", f"/users/{A['user']}",
    "/inventory", "/inventory/counts", "/software",
    "/dashboard/overview", "/asset-requests", "/asset-requests/counts", "/vendors", "/purchase-orders",
    "/maintenance", "/departments", "/cloud/resources", "/discovery/devices", "/discovery/unmanaged",
    "/physical-audit/sessions", "/warranty-maintenance/claims", "/warranty-maintenance/coverage",
    "/financial/summary", "/financial/department-breakdown",
    "/audit-logs", "/organization", "/super-admin/overview",
]
for path in RESTRICTED_READS:
    code, data = call("reportA", "GET", path)
    check(f"reporting user without modules cannot read {path}", code == 403, (code, data))
for path in ("/reports/types", "/reports/runs", "/reports/summary", "/reports/saved", "/profile", "/notifications", "/auth/me"):
    code, data = call("reportA", "GET", path)
    check(f"reporting user can read {path}", code == 200, (code, data))
for method, path, body in [
    ("POST", "/assets", {"asset_tag": "R1", "serial_number": "R1", "name": "r", "category": "Laptop"}),
    ("POST", "/software", {"name": "R", "total_licenses": 1}),
    ("POST", "/users", {"email": "r@example.com", "full_name": "R", "password": "password123"}),
    ("PUT", f"/assets/{A['asset']}", {"name": "pwned"}),
    ("DELETE", f"/inventory/{A['item']}", None),
]:
    code, data = call("reportA", method, path, body)
    check(f"reporting user cannot {method} {path}", code == 403, (code, data))

# Modules are assigned per account and checked on the server.
code, data = call("adminA", "POST", "/users", {"email": "rep.sam@example.com", "full_name": "Rep Sam", "password": "password123", "role": "REPORTING_USER", "modules": ["REPORTS"]})
check("a Reporting user cannot be given the Sub-admin-only REPORTS module", code == 400, (code, data))
code, data = call("adminA", "POST", "/users", {"email": "rep.sam@example.com", "full_name": "Rep Sam", "password": "password123", "role": "REPORTING_USER", "modules": ["ROOT"]})
check("an unknown module is refused for a Reporting user", code == 400, (code, data))
code, data = call("adminA", "POST", "/users", {"email": "rep.sam@example.com", "full_name": "Rep Sam", "password": "password123", "role": "REPORTING_USER", "modules": ["SAM"]})
check("an IT Admin can create a Reporting user who may also read software", code == 201 and data.get("modules") == ["SAM"], (code, data))
rep_id = data.get("id")
code, data, _ = raw("POST", "/auth/login", {"email": "rep.sam@example.com", "password": "password123"})
TOKENS["repSam"] = data.get("access_token", "")
code, data = call("repSam", "GET", "/software")
check("the Reporting user can read the assigned module (software)", code == 200, (code, data))
for path in ("/assets", "/users", "/inventory", "/dashboard/overview", "/cloud/resources", "/financial/summary"):
    code, data = call("repSam", "GET", path)
    check(f"the same Reporting user cannot read unassigned {path}", code == 403, (code, data))
code, data = call("repSam", "POST", "/software", {"name": "X", "total_licenses": 1})
check("assigned modules are read-only for a Reporting user", code == 403, (code, data))
code, data = call("repSam", "GET", "/software")
check("a Reporting user sees only their own company's software", code == 200 and all(row["company_id"] == companyA for row in data), data)
code, data = call("adminA", "PUT", f"/users/{rep_id}", {"modules": ["SAM", "HAM"]})
check("an IT Admin can change a Reporting user's modules", code == 200 and data.get("modules") == ["HAM", "SAM"], (code, data))
code, data = call("repSam", "GET", "/assets")
check("a module added later takes effect immediately", code == 200, (code, data))
code, data = call("adminA", "PUT", f"/users/{rep_id}", {"modules": []})
check("clearing modules removes the extra read access", code == 200 and not data.get("modules"), (code, data))
code, data = call("repSam", "GET", "/software")
check("...and the Reporting user loses access again", code == 403, (code, data))
code, data = call("adminB", "PUT", f"/users/{rep_id}", {"modules": ["HAM"]})
check("another company's admin cannot widen a Reporting user's access", code == 404, (code, data))

# Reporting users cannot open the live asset feed without the HAM module.
# X-Forwarded-For is ignored unless the peer is a trusted proxy.
settings.AUTH_RATE_LIMIT_PER_MINUTE = 3
rate_limit._hits.clear()
settings.TRUSTED_PROXIES = []
statuses = [raw("POST", "/auth/login", {"email": "nobody@example.com", "password": "x" * 8},
                headers={"X-Forwarded-For": f"10.9.9.{i}"})[0] for i in range(6)]
check("spoofed X-Forwarded-For does not dodge the rate limit", statuses[-1] == 429, (statuses, {k: len(v) for k, v in rate_limit._hits.items()}, settings.AUTH_RATE_LIMIT_PER_MINUTE, settings.TRUSTED_PROXIES))
rate_limit._hits.clear()
settings.TRUSTED_PROXIES = ["127.0.0.1"]
statuses = [raw("POST", "/auth/login", {"email": "nobody@example.com", "password": "x" * 8},
                headers={"X-Forwarded-For": f"10.9.9.{i}"})[0] for i in range(6)]
check("trusted proxy's X-Forwarded-For separates clients", 429 not in statuses, statuses)
settings.AUTH_RATE_LIMIT_PER_MINUTE = 1000
settings.TRUSTED_PROXIES = ["127.0.0.1", "::1"]

# Request body size limit and response headers.
settings.MAX_REQUEST_BODY_BYTES = 1000
code, data, hdrs = raw("POST", "/auth/login", data=b"{" + b" " * 5000 + b"}")
check("oversized request body is refused with 413", code == 413, code)
code, data, hdrs = raw("POST", "/auth/login", {"email": "nobody@example.com", "password": "x" * 8})
check("normal-sized request body is still accepted", code == 401, code)
settings.MAX_REQUEST_BODY_BYTES = 2 * 1024 * 1024
code, data, hdrs = raw("GET", "/auth/me", token=TOKENS["adminA"])
check("API responses carry security headers", hdrs.get("X-Content-Type-Options") == "nosniff" and hdrs.get("X-Frame-Options") == "DENY", dict(hdrs))

# WebSocket authentication.
import asyncio  # noqa: E402
try:
    import websockets  # noqa: E402
except ImportError:
    websockets = None
if websockets is None:
    print("  SKIP  WebSocket checks (pip install websockets)")
else:
    async def ws_close_code(path, token, origin=None):
        kwargs = {"origin": origin} if origin else {}
        try:
            async with websockets.connect(f"ws://127.0.0.1:{PORT}/api{path}?token={token}", **kwargs) as ws:
                await ws.send("ping")
                reply = await asyncio.wait_for(ws.recv(), 3)
                return "open" if str(reply).startswith("pong") else reply
        except websockets.exceptions.ConnectionClosed as closed:
            return closed.rcvd.code if closed.rcvd else None
        except Exception as exc:  # noqa: BLE001
            return repr(exc)

    companyA = None
    with Session() as db:
        companyA = db.query(User).filter(User.id == IDS["adminA"]).first().company_id
    ws_path = f"/assets/ws/{companyA}"
    check("WebSocket: valid token and origin connects", asyncio.run(ws_close_code(ws_path, TOKENS["adminA"], "http://localhost:3000")) == "open")
    check("WebSocket: missing/invalid token is closed 4401", asyncio.run(ws_close_code(ws_path, "bad")) == 4401)
    check("WebSocket: other company's admin is closed 4403", asyncio.run(ws_close_code(ws_path, TOKENS["adminB"])) == 4403)
    check("WebSocket: foreign Origin is closed 4403", asyncio.run(ws_close_code(ws_path, TOKENS["adminA"], "https://evil.example")) == 4403)
    check("WebSocket: Reporting user without HAM is closed 4403", asyncio.run(ws_close_code(ws_path, TOKENS["reportA"])) == 4403)
    check("WebSocket: token from before a password change is closed 4401", asyncio.run(ws_close_code(ws_path, old_token)) == 4401)

# Pagination bounds and vendor deletion.
code, data = call("adminA", "GET", "/users?limit=100000")
check("oversized page limit is rejected", code == 422, code)
code, data = call("adminA", "GET", "/users?skip=-1")
check("negative skip is rejected", code == 422, code)
code, data = call("adminA", "GET", "/departments?limit=1")
check("list endpoints accept skip/limit", code == 200 and len(data) <= 1, data)
code, data = call("adminA", "POST", "/purchase-orders", {"po_number": "P2", "vendor_id": A["vendor"], "total_amount": "5"})
code, data = call("adminA", "DELETE", f"/vendors/{A['vendor']}")
check("vendor still used by purchase orders is refused with 409, not 500", code == 409, (code, data))

# Password recovery reaches a human for an agent with no organization.
code, agent2, _ = raw("POST", "/auth/register", {"name": "Lonely Agent", "email": "lonely@example.com", "password": "password123", "role": "IT_AGENT"})
code, data, _ = raw("POST", "/auth/forgot-password", {"email": "LONELY@example.com"})
check("forgot-password answers generically", code == 200, data)
with Session() as db:
    notified = db.query(Notification).filter(Notification.user_id == IDS["root"], Notification.title.like("Lonely Agent asked%")).count()
check("forgot-password from an unassigned agent notifies the Super Admins", notified == 1, notified)
code, data, _ = raw("POST", "/auth/forgot-password", {"email": "nobody-here@example.com"})
check("forgot-password does not reveal unknown accounts", code == 200 and "If that account exists" in data["message"], data)

# Super Admin seeding.
import app.core.seed as seed  # noqa: E402
seed.SessionLocal = Session
with Session() as db:
    db.query(Notification).delete()
    db.query(User).filter(User.role == PlatformRole.SUPER_ADMIN).delete()
    db.commit()
settings.SEED_SUPER_ADMIN_EMAIL = "Seed.Root@Example.com"
settings.SEED_SUPER_ADMIN_EMAIL = "root@audit.local"  # special-use TLD: the login form would reject it
settings.SEED_SUPER_ADMIN_PASSWORD = "a-long-seed-password"
try:
    seed.seed_initial_users()
    check("seed refuses an email address the login form would reject", False)
except RuntimeError:
    check("seed refuses an email address the login form would reject", True)
settings.SEED_SUPER_ADMIN_EMAIL = "Seed.Root@Example.com"
settings.SEED_SUPER_ADMIN_PASSWORD = "short"
try:
    seed.seed_initial_users()
    check("seed refuses a password under 12 characters", False)
except RuntimeError:
    check("seed refuses a password under 12 characters", True)
settings.SEED_SUPER_ADMIN_PASSWORD = "a-long-seed-password"
seed.seed_initial_users()
seed.seed_initial_users()  # second run must not create a duplicate
with Session() as db:
    seeded = db.query(User).filter(User.role == PlatformRole.SUPER_ADMIN).all()
check("seed creates exactly one Super Admin with a lowercased email", len(seeded) == 1 and seeded[0].email == "seed.root@example.com", [u.email for u in seeded])
code, data, _ = raw("POST", "/auth/login", {"email": "SEED.ROOT@example.com", "password": "a-long-seed-password"})
check("the seeded Super Admin can sign in", code == 200 and data.get("role") == "SUPER_ADMIN", data)

print(f"\n{sum(RESULTS)}/{len(RESULTS)} passed")
server.should_exit = True
sys.exit(0 if all(RESULTS) else 1)
