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
from app.core.security import create_access_token  # noqa: E402
from app.main import app  # noqa: E402
from app.models.models import Company, PlatformRole, Subscription, User  # noqa: E402

PORT = 8769
engine = create_engine(
    f"sqlite:///{os.path.join(tempfile.mkdtemp(), 'security.db')}", connect_args={"check_same_thread": False}
)
Session = sessionmaker(bind=engine)
Base.metadata.create_all(engine)

TOKENS: dict = {}
IDS: dict = {}
COMPANIES: dict = {}
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
            TOKENS[f"{key}{org}"] = create_access_token({"sub": user.id})
            IDS[f"{key}{org}"] = user.id
        COMPANIES[org] = company.id
    # A platform Super Admin, outside any company.
    boss = User(email="super@example.com", hashed_password="x", full_name="Super", role=PlatformRole.SUPER_ADMIN, status="ACTIVE")
    db.add(boss)
    db.flush()
    TOKENS["super"] = create_access_token({"sub": boss.id})
    IDS["super"] = boss.id
    db.commit()


def override_db():
    session = Session()
    try:
        yield session
    finally:
        session.close()


app.dependency_overrides[get_db] = override_db
server = uvicorn.Server(uvicorn.Config(app, port=PORT, log_level="critical", lifespan="off"))
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
A["stockreq"] = created("agentA", "POST", "/inventory/requests", {"item_id": A["item"], "quantity": 1, "reason": "Need one"})
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
    ("PUT", f"/inventory/requests/{A['stockreq']}", {"status": "APPROVED"}),
    ("POST", "/inventory/requests", {"item_id": A["item"], "quantity": 1, "reason": "x"}),
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
for method, path, body in attacks:
    code, data = call("adminB", method, path, body)
    check(f"B cannot {method} {path.split('/')[1]}{' ' + path.split('/')[-1] if path.count('/') > 2 else ''}",
          code in (400, 403, 404, 422), f"{code} {data}")

a_ids = [str(v) for v in A.values()] + [v for k, v in IDS.items() if k.endswith("A")]
for path in ["/assets", "/users", "/departments", "/asset-requests", "/inventory", "/vendors", "/purchase-orders", "/software",
             "/maintenance", "/physical-audit/sessions", "/cloud/resources", "/discovery/devices", "/reports/runs", "/reports/saved",
             "/warranty-maintenance/claims", "/assets/events", "/audit-logs", "/notifications", "/assets/categories",
             "/users/directory", "/warranty-maintenance/coverage", "/inventory/requests"]:
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
check("user cannot edit asset details", code in (403, 404), data)
code, data = call("agentA", "DELETE", f"/assets/{A['asset']}")
check("user cannot remove assets", code == 403, data)
code, data = call("agentA", "POST", f"/assets/{A['asset']}/assign", {"user_id": IDS["agentA"]})
check("user cannot assign assets (only the IT Admin)", code == 403, data)
code, data = call("agentA", "POST", f"/assets/{A['asset']}/unassign")
check("user cannot unassign assets", code == 403, data)
code, data = call("agentA", "GET", f"/asset-requests/{A['ticket']}")
check("user cannot open someone else's ticket", code == 404, data)
code, data = call("agentA", "GET", "/asset-requests")
check("user's ticket list holds none of the admin's tickets",
      code == 200 and all(t["id"] != A["ticket"] for t in data), data)
code, data = call("agentA", "PUT", f"/asset-requests/{A['ticket']}", {"status": "CANCELLED"})
check("user cannot cancel someone else's ticket", code == 404, data)
code, data = call("agentA", "POST", "/asset-requests", {"asset_category_id": A["cat"], "reason": "Need a mouse"})
own_ticket = data.get("id", "") if isinstance(data, dict) else ""
code, data = call("agentA", "PUT", f"/asset-requests/{own_ticket}", {"status": "IN_PROGRESS"})
check("user cannot work even their own ticket", code == 403, data)
code, data = call("agentA", "PUT", f"/asset-requests/{own_ticket}", {"status": "CANCELLED"})
check("user can cancel their own ticket", code == 200 and data.get("status") == "CANCELLED", data)
# A user reaches only their own assets, tickets, stock requests and reports.
for path in ("/users", "/users/directory", "/maintenance", "/vendors", "/purchase-orders", "/audit-logs",
             "/dashboard/overview", "/physical-audit/sessions", "/software", "/financial/overview",
             "/warranty-maintenance/claims", "/cloud/resources", "/discovery/devices", "/depreciation/schedule"):
    code, data = call("agentA", "GET", path)
    check(f"user cannot read {path}", code == 403, str(data)[:80])
code, data = call("agentA", "GET", "/departments")
check("user can read department names (ticket form)", code == 200, data)
code, data = call("agentA", "POST", "/departments", {"name": "Hack"})
check("user cannot create departments", code == 403, data)
code, data = call("agentA", "GET", "/assets")
check("user sees no company assets when none are assigned to them", code == 200 and data == [], data)
code, data = call("agentA", "GET", f"/assets/{A['asset']}")
check("user cannot open an asset that is not theirs", code == 404, data)
code, data = call("agentA", "GET", "/reports/runs")
check("user does not see the admin's reports", code == 200 and all(r["id"] != A["run"] for r in data), data)
code, data = call("agentA", "GET", f"/reports/runs/{A['run']}/download")
check("user cannot download the admin's report", code == 404, str(data)[:80])
code, data = call("agentA", "GET", "/reports/saved")
check("user does not see the admin's saved reports", code == 200 and all(r["id"] != A["saved"] for r in data), data)
code, data = call("agentA", "POST", f"/reports/saved/{A['saved']}/run")
check("user cannot run the admin's saved report", code == 404, data)
code, data = call("agentA", "POST", "/reports/runs", {"report_type": "asset_inventory"})
check("user cannot run organization-wide reports", code == 403, data)
code, data = call("adminA", "POST", "/reports/runs", {"report_type": "my_tickets"})
check("admins use organization reports, not personal ones", code == 403, data)
code, data = call("agentA", "POST", "/asset-requests", {"asset_category_id": A["cat"], "reason": "x",
                                                         "requested_for_user_id": IDS["adminA"]})
check("user cannot raise a ticket for someone else", code == 403, data)
code, data = call("agentA", "POST", f"/inventory/{A['item']}/adjust", {"change": -1, "reason": "x"})
check("user cannot move stock directly", code == 403, data)
code, data = call("agentA", "PUT", f"/inventory/requests/{A['stockreq']}", {"status": "APPROVED"})
check("user cannot approve their own stock request", code == 403, data)
code, data = call("samA", "PUT", f"/inventory/requests/{A['stockreq']}", {"status": "APPROVED"})
check("SAM sub-admin cannot approve stock requests (inventory is HAM)", code == 403, data)
code, data = call("samA", "DELETE", f"/assets/{A['asset']}")
check("SAM sub-admin cannot remove hardware assets", code == 403, data)
code, data = call("reportA", "DELETE", f"/assets/{A['asset']}")
check("reporting user cannot remove assets", code == 403, data)
code, data = call("agentA", "POST", "/users", {"email": "y@example.com", "full_name": "Y", "password": "password123"})
check("user cannot create users", code == 403, data)

# --- Work review: admins see users' work, not other admins' -----------------
code, data = call("adminA", "GET", f"/users/{IDS['agentA']}/activity")
check("an IT Admin reviews a user's work", code == 200, data)
for other in ("samA", "hamA", "reportA"):
    code, data = call("adminA", "GET", f"/users/{IDS[other]}/activity")
    check(f"an IT Admin cannot review another admin's work ({other})", code == 403, data)
code, data = call("hamA", "GET", f"/users/{IDS['adminA']}/activity")
check("a sub-admin cannot review the IT Admin's work", code == 403, data)
for person in ("adminA", "adminB", "hamA", "agentA"):
    code, data = call("super", "GET", f"/users/{IDS[person]}/activity")
    check(f"the Super Admin reviews anyone's work ({person})", code == 200, data)
code, data = call("super", "GET", "/users?limit=2000")
check("the Super Admin lists people in every company",
      code == 200 and {IDS["adminA"], IDS["adminB"], IDS["agentA"]} <= {u["id"] for u in data}, data)
code, data = call("super", "POST", "/users", {"email": "newadmin.b@example.com", "full_name": "New Admin", "password": "password123",
                                           "role": "IT_ADMIN", "company_id": COMPANIES["B"]})
check("the Super Admin adds an IT Admin to a company", code == 201 and data.get("company_id") == COMPANIES["B"], data)
code, data = call("super", "POST", "/users", {"email": "newuser.a@example.com", "full_name": "New User", "password": "password123",
                                           "role": "EMPLOYEE", "company_id": COMPANIES["A"]})
check("the Super Admin adds a user to a company", code == 201 and data.get("agent_id"), data)
code, data = call("super", "POST", "/users", {"email": "nocompany@example.com", "full_name": "No Co", "password": "password123", "role": "EMPLOYEE"})
check("the Super Admin must choose a company", code == 400, data)
code, data = call("super", "POST", "/users", {"email": "ghost@example.com", "full_name": "Ghost", "password": "password123",
                                           "role": "EMPLOYEE", "company_id": "no-such-company"})
check("the Super Admin cannot add to an unknown company", code == 400, data)
code, data = call("adminA", "POST", "/users", {"email": "sneak@example.com", "full_name": "Sneak", "password": "password123",
                                            "role": "EMPLOYEE", "company_id": COMPANIES["B"]})
check("an IT Admin cannot add people to another company", code == 201 and data.get("company_id") == COMPANIES["A"], data)

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

print(f"\n{sum(RESULTS)}/{len(RESULTS)} passed")
server.should_exit = True
sys.exit(0 if all(RESULTS) else 1)
