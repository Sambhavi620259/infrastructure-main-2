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
from app.core.security import issue_token  # noqa: E402
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
            TOKENS[f"{key}{org}"] = issue_token(user)
            IDS[f"{key}{org}"] = user.id
        COMPANIES[org] = company.id
    # A platform Super Admin, outside any company.
    boss = User(email="super@example.com", hashed_password="x", full_name="Super", role=PlatformRole.SUPER_ADMIN, status="ACTIVE")
    db.add(boss)
    db.flush()
    TOKENS["super"] = issue_token(boss)
    IDS["super"] = boss.id
    db.commit()


def override_db():
    session = Session()
    try:
        yield session
    finally:
        session.close()


app.dependency_overrides[get_db] = override_db
# Like the production command: uvicorn does not rewrite the client address from forwarded headers.
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
with Session() as _db:
    TOKENS["empA"] = issue_token(_db.get(User, A["user"]))
A["ticket"] = created("empA", "POST", "/asset-requests", {"asset_category_id": A["cat"], "reason": "need"})
code, data = call("adminA", "POST", "/asset-requests", {"asset_category_id": A["cat"], "reason": "need"})
check("an IT Admin cannot raise a ticket", code == 403, data)
code, data = call("hamA", "POST", "/asset-requests", {"asset_category_id": A["cat"], "reason": "need"})
check("a sub-admin cannot raise a ticket", code == 403, data)
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
# Users no longer request stock; an older request is made by an admin so the decide checks below still have one.
A["stockreq"] = created("adminA", "POST", "/inventory/requests", {"item_id": A["item"], "quantity": 1, "reason": "Need one"})
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
    ("POST", "/assets", {"name": "x", "amc_vendor_id": A["vendor"]}),
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

print("Reporting user permissions")
for path in ("/users", "/users/unassigned", "/audit-logs", "/financial", "/assets", "/inventory", "/vendors", "/software",
             "/asset-requests", "/cloud/resources", "/departments", "/organization"):
    code, data = call("reportA", "GET", path)
    check(f"reporting user without a module cannot read {path} (403)", code == 403, (code, data))
code, data = call("reportA", "GET", "/reports/runs")
check("reporting user can still read reports", code == 200, (code, data))
code, data = call("reportA", "GET", "/dashboard/overview")
check("reporting user can read the aggregate dashboard figures", code == 200, (code, data))
code, data = call("reportA", "GET", "/profile")
check("reporting user can read their own profile", code == 200, (code, data))
code, data = call("reportA", "GET", "/notifications")
check("reporting user can read their notifications", code == 200, (code, data))
code, data = call("reportA", "POST", "/assets", {"asset_tag": "R", "serial_number": "R", "name": "r", "category": "Laptop"})
check("reporting user still cannot write assets (403)", code == 403, (code, data))
with Session() as db:
    db.query(User).filter(User.id == IDS["reportA"]).update({"modules": ["HAM"]})
    db.commit()
code, data = call("reportA", "GET", "/assets")
check("a module assigned to the reporting user opens that module's data", code == 200, (code, data))
code, data = call("reportA", "GET", "/software")
check("a module that is not assigned stays closed (403)", code == 403, (code, data))
code, data = call("reportA", "GET", "/users")
check("an assigned data module does not open the user list (403)", code == 403, (code, data))
code, data = call("reportA", "POST", "/assets", {"asset_tag": "R", "serial_number": "R", "name": "r", "category": "Laptop"})
check("an assigned module is still read-only (403 on write)", code == 403, (code, data))
with Session() as db:
    db.query(User).filter(User.id == IDS["reportA"]).update({"modules": None})
    db.commit()
code, data = call("reportA", "GET", "/assets")
check("clearing the modules closes the data again (403)", code == 403, (code, data))
code, data = call("adminA", "GET", "/assets")
check("an IT Admin is not affected", code == 200, (code, data))
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
check("user cannot decide on stock requests", code == 403, data)
for method, path, body in (
    ("GET", "/inventory", None), ("GET", f"/inventory/{A['item']}", None), ("GET", "/inventory/counts", None),
    ("GET", "/inventory/requests", None), ("GET", "/inventory/hardware-stock", None), ("GET", "/inventory/movements", None),
    ("POST", "/inventory/requests", {"item_id": A["item"], "quantity": 1, "reason": "x"}),
):
    code, data = call("agentA", method, path, body)
    check(f"user has no access to inventory: {method} {path.replace(A['item'], '{item}')}", code == 403, data)
code, data = call("samA", "PUT", f"/inventory/requests/{A['stockreq']}", {"status": "APPROVED"})
check("SAM sub-admin cannot approve stock requests (inventory is HAM)", code == 403, data)
code, data = call("samA", "DELETE", f"/assets/{A['asset']}")
check("SAM sub-admin cannot remove hardware assets", code == 403, data)
code, data = call("reportA", "DELETE", f"/assets/{A['asset']}")
check("reporting user cannot remove assets", code == 403, data)
code, data = call("agentA", "POST", "/users", {"email": "y@example.com", "full_name": "Y", "password": "password123"})
check("user cannot create users", code == 403, data)

# --- Reports belong to whoever generated them -------------------------------
print("Report ownership")
code, mine = call("agentA", "POST", "/reports/runs", {"report_type": "my_assets"})
code, other = call("adminA", "POST", "/reports/runs", {"report_type": "asset_inventory"})
code, other2 = call("hamA", "POST", "/reports/runs", {"report_type": "asset_inventory"})
code, listing = call("adminA", "GET", "/reports/runs?limit=100")
check("an IT Admin's recent reports hold only their own runs",
      code == 200 and listing and {r["generated_by"] for r in listing} == {IDS["adminA"]}, listing)
code, data = call("adminA", "GET", f"/reports/runs/{mine['id']}/download")
check("an IT Admin cannot download a user's personal report", code == 404, data)
code, data = call("adminA", "GET", f"/reports/runs/{other2['id']}/download")
check("an IT Admin cannot download another admin's report", code == 404, data)
code, data = call("adminA", "DELETE", f"/reports/runs/{mine['id']}")
check("an IT Admin cannot delete a user's report", code == 404, data)
code, data = call("adminA", "DELETE", f"/reports/runs/{other['id']}")
check("an IT Admin can remove their own report", code == 204, data)
code, data = call("hamA", "GET", "/reports/summary")
check("the summary counts only the caller's own reports", code == 200 and data["generated_this_month"] >= 1, data)

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
code, data = call("super", "GET", "/users?limit=1000")
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
code, data = call("super", "DELETE", f"/users/{IDS['adminB']}")
check("the Super Admin removes an IT Admin", code == 204, data)
code, data = call("adminB", "GET", "/assets")
check("a removed IT Admin can no longer use the app", code in (401, 403), data)
code, data = call("super", "POST", f"/users/{IDS['adminB']}/reactivate")
check("the Super Admin reactivates an IT Admin", code == 200 and data.get("status") == "ACTIVE", data)
code, data = call("adminB", "GET", "/assets")
check("a reactivated IT Admin can use the app again", code == 200, data)
code, data = call("adminA", "DELETE", f"/users/{IDS['adminB']}")
check("an IT Admin cannot remove an admin of another company", code == 404, data)

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


# --- Organization contact details (Super Admin) -----------------------------
print("Organization contact details")
org_a = COMPANIES["A"]
code, data = call("super", "PUT", f"/super-admin/companies/{org_a}", {
    "contact_email": "it@orga.example.com", "contact_phone": "+91 98765 43210",
    "address": "MG Road, Pune", "latitude": 18.5204, "longitude": 73.8567})
check("Super Admin sets an organization's contact details and pin",
      code == 200 and data.get("contact_email") == "it@orga.example.com" and data.get("latitude") == 18.5204, data)
code, data = call("super", "PUT", f"/super-admin/companies/{org_a}", {"latitude": None})
check("a pin needs both latitude and longitude", code == 400, data)
code, data = call("super", "PUT", f"/super-admin/companies/{org_a}", {"contact_email": "not-an-email"})
check("contact email must be valid", code == 422, data)
code, data = call("super", "PUT", f"/super-admin/companies/{org_a}", {"latitude": 123, "longitude": 10})
check("latitude must be on the map", code == 422, data)
code, data = call("adminA", "PUT", f"/super-admin/companies/{org_a}", {"contact_email": "x@example.com"})
check("an IT Admin cannot change contact details", code == 403, data)
code, data = call("adminA", "GET", "/organization")
check("the IT Admin sees their organization's contact details",
      code == 200 and data.get("contact_phone") == "+91 98765 43210" and data.get("longitude") == 73.8567, data)
code, data = call("super", "GET", "/super-admin/contact-directory")
row = next((c for c in data if c["id"] == org_a), {}) if code == 200 else {}
check("contact directory lists contact details and IT Admins",
      row.get("address") == "MG Road, Pune" and any(a["email"] == "admin.a@example.com" for a in row.get("it_admins", [])), data)
code, data = call("adminA", "GET", "/super-admin/contact-directory")
check("an IT Admin cannot open the contact directory", code == 403, data)

# --- Plan features -----------------------------------------------------------
print("Plan features")
code, data = call("super", "GET", "/super-admin/plan-features")
check("every plan includes every feature by default",
      code == 200 and all(set(v) == set(data["features"]) for v in data["plans"].values()), data)
code, data = call("super", "PUT", "/super-admin/plan-features", {"plans": {"ENTERPRISE": ["INVENTORY", "REPORTS", "CLOUD"]}})
check("Super Admin removes Software from the Enterprise plan",
      code == 200 and "SOFTWARE" not in data["plans"]["ENTERPRISE"] and "SOFTWARE" in data["plans"]["STARTER"], data)
code, data = call("adminA", "GET", "/software")
check("an organization on that plan cannot use Software", code == 403 and "plan" in str(data), data)
code, data = call("agentA", "GET", "/software/mine")
check("its users cannot use Software either", code == 403, data)
code, data = call("adminA", "GET", "/inventory")
check("features still on the plan keep working", code == 200, data)
code, data = call("adminA", "GET", "/profile")
check("the profile lists the plan's features", code == 200 and "SOFTWARE" not in data["user"]["planFeatures"]
      and "INVENTORY" in data["user"]["planFeatures"], data)
code, data = call("adminA", "GET", "/organization")
check("the organization lists the plan's features", code == 200 and "SOFTWARE" not in data["plan_features"], data)
code, data = call("super", "PUT", "/super-admin/plan-features", {"plans": {"ENTERPRISE": ["TELEPORT"]}})
check("unknown features are refused", code == 400, data)
code, data = call("adminA", "PUT", "/super-admin/plan-features", {"plans": {"ENTERPRISE": ["SOFTWARE"]}})
check("an IT Admin cannot change plan features", code == 403, data)
call("super", "PUT", "/super-admin/plan-features", {"plans": {"ENTERPRISE": ["INVENTORY", "SOFTWARE", "REPORTS", "CLOUD"]}})
code, data = call("adminA", "GET", "/software")
check("adding the feature back restores access", code == 200, data)


# --- Audit fixes: sessions, sign-in, registration, access control, limits ----
import asyncio  # noqa: E402

import websockets  # noqa: E402

from app.core import rate_limit  # noqa: E402
from app.core.config import settings  # noqa: E402
from app.core.http_guard import BodySizeLimitMiddleware  # noqa: E402


def raw(method, path, body=None, token=None, headers=None):
    """A call with no test token: returns (status, parsed body, response headers)."""
    request_headers = {"Content-Type": "application/json", **(headers or {})}
    if token:
        request_headers["Authorization"] = f"Bearer {token}"
    request = urllib.request.Request(
        f"http://127.0.0.1:{PORT}/api{path}",
        data=json.dumps(body).encode() if body is not None else None,
        method=method, headers=request_headers,
    )
    try:
        with urllib.request.urlopen(request) as response:
            raw_body = response.read()
            return response.status, (json.loads(raw_body) if raw_body else {}), dict(response.headers)
    except urllib.error.HTTPError as error:
        text = error.read().decode()
        try:
            return error.code, json.loads(text), dict(error.headers)
        except ValueError:
            return error.code, text[:160], dict(error.headers)


def login(email, password, headers=None):
    return raw("POST", "/auth/login", {"email": email, "password": password}, headers=headers)


rate_limit.reset_for_tests()
settings.AUTH_RATE_LIMIT_PER_MINUTE = 0  # per-address limit tested separately below

print("Sessions end when the password changes")
PW = "Passw0rd!123"
created("adminA", "POST", "/users", {"email": "Case.User@Example.com", "full_name": "Case User", "password": PW, "role": "EMPLOYEE"})
code, data, _ = login("CASE.USER@example.com", PW)
check("sign-in ignores the case of the email", code == 200 and data.get("access_token"), data)
old_token = data["access_token"]
code, data, _ = raw("GET", "/profile", token=old_token)
check("a freshly issued token works", code == 200, data)
code, data, _ = raw("POST", "/users", {"email": "case.user@example.com", "full_name": "Dup", "password": PW, "role": "EMPLOYEE"},
                    token=TOKENS["adminA"])
check("an email in another case counts as a duplicate", code == 400, data)
settings.ALLOW_PUBLIC_AGENT_SIGNUP = True  # open only for this check (the default is closed)
code, data, _ = raw("POST", "/auth/register", {"name": "Case Twin", "email": "CASE.USER@EXAMPLE.COM", "password": PW, "role": "IT_AGENT"})
check("registration refuses an email that differs only by case", code == 400, data)
settings.ALLOW_PUBLIC_AGENT_SIGNUP = False
code, data, _ = raw("GET", "/users?limit=500", token=TOKENS["adminA"])
stored = [u["email"] for u in data] if code == 200 else []
check("emails are stored in lower case", "case.user@example.com" in stored and "Case.User@Example.com" not in stored, stored)

case_id = next(u["id"] for u in data if u["email"] == "case.user@example.com")
code, data, _ = raw("POST", f"/users/{case_id}/reset-password", {"new_password": "NewPassw0rd!456"}, token=TOKENS["adminA"])
check("an IT Admin resets a user's password", code == 200, data)
code, data, _ = raw("GET", "/profile", token=old_token)
check("the user's old token stops working after the reset", code == 401, data)
code, data, _ = login("case.user@example.com", PW)
check("the old password no longer signs in", code == 401, data)
code, data, _ = login("case.user@example.com", "NewPassw0rd!456")
check("the new password signs in", code == 200, data)
token_before_change = data["access_token"]
code, data, _ = raw("POST", "/auth/change-password", {"current_password": "NewPassw0rd!456", "new_password": "Another!Pass789"},
                    token=token_before_change)
check("a user changes their own password", code == 200 and data.get("access_token"), data)
fresh_token = data.get("access_token", "")
code, data, _ = raw("GET", "/profile", token=token_before_change)
check("the token from before the change stops working", code == 401, data)
code, data, _ = raw("GET", "/profile", token=fresh_token)
check("the token returned by the change works", code == 200, data)
code, data, _ = raw("POST", "/auth/change-password", {"current_password": "Another!Pass789", "new_password": "x" * 80}, token=fresh_token)
check("a password over 72 bytes is refused, not silently cut", code == 422, data)

print("Sign-in limits")
code, data, _ = raw("POST", "/auth/login", {"email": "case.user@example.com", "password": "a" * 200})
check("an oversized password is refused", code == 422, data)
for _ in range(settings.LOGIN_FAILURE_LIMIT):
    login("lockme@example.com", "wrong-password")
code, data, _ = login("lockme@example.com", "wrong-password")
check("too many failed sign-ins pause the account, whatever the address", code == 429, data)
rate_limit.reset_for_tests()
settings.AUTH_RATE_LIMIT_PER_MINUTE = 5
codes = [login(f"nobody{i}@example.com", "wrong-password", headers={"X-Forwarded-For": f"10.9.9.{i}"})[0] for i in range(8)]
check("a caller cannot dodge the address limit by inventing X-Forwarded-For", codes[-1] == 429 and 429 not in codes[:5], codes)
settings.AUTH_RATE_LIMIT_PER_MINUTE = 0
rate_limit.reset_for_tests()
settings.TRUSTED_PROXY_COUNT = 1
settings.AUTH_RATE_LIMIT_PER_MINUTE = 3
codes = [login("who@example.com", "x", headers={"X-Forwarded-For": f"203.0.113.{i}"})[0] for i in range(6)]
check("behind a trusted proxy each visitor address has its own limit", 429 not in codes, codes)
settings.TRUSTED_PROXY_COUNT = 0
settings.AUTH_RATE_LIMIT_PER_MINUTE = 0
rate_limit.reset_for_tests()

settings.PROXY_SHARED_SECRET = "proxy-secret-for-tests"
settings.AUTH_RATE_LIMIT_PER_MINUTE = 3
rate_limit.reset_for_tests()
good = {"X-Itam-Proxy-Key": "proxy-secret-for-tests"}
codes = [login("who@example.com", "x", headers={**good, "X-Itam-Client-Ip": f"198.51.100.{i}"})[0] for i in range(6)]
check("with the proxy secret, each visitor address the proxy names has its own limit", 429 not in codes, codes)
codes = [login("who@example.com", "x", headers={**good, "X-Itam-Client-Ip": "198.51.100.77"})[0] for i in range(6)]
check("and one visitor still hits the limit", codes[-1] == 429, codes)
rate_limit.reset_for_tests()
codes = [login("who@example.com", "x", headers={"X-Itam-Proxy-Key": "wrong", "X-Itam-Client-Ip": f"198.51.100.{i}"})[0] for i in range(6)]
check("without the secret, a named address is ignored and the limit applies", codes[-1] == 429, codes)
settings.PROXY_SHARED_SECRET = ""
settings.AUTH_RATE_LIMIT_PER_MINUTE = 0
rate_limit.reset_for_tests()

print("Registration")
# The defaults, before any switch is touched: public sign-up of IT Admins and users is closed.
check("IT Admin sign-up is off by default", settings.ALLOW_PUBLIC_IT_ADMIN_SIGNUP is False, settings.ALLOW_PUBLIC_IT_ADMIN_SIGNUP)
check("user (IT Agent) sign-up is off by default", settings.ALLOW_PUBLIC_AGENT_SIGNUP is False, settings.ALLOW_PUBLIC_AGENT_SIGNUP)
code, data, _ = raw("GET", "/auth/registration-options")
check("the register page is told IT Admin and user sign-up are closed",
      code == 200 and data.get("it_admin") is False and data.get("user") is False and data.get("super_admin") is False, data)
for role in ("IT_ADMIN", "IT_AGENT"):
    code, data, _ = raw("POST", "/auth/register", {"name": "Closed Door", "email": f"closed.{role.lower()}@example.com", "password": PW, "role": role})
    check(f"{role} registration is refused by default (403)", code == 403, (code, data))
with Session() as db:
    check("a refused registration creates no account",
          db.query(User).filter(User.email.like("closed.%@example.com")).count() == 0)
code, data, _ = raw("POST", "/auth/register", {"name": "Closed Door", "email": "closed.sneaky@example.com", "password": PW, "role": "it_admin"})
check("a role spelled in another case is not accepted either", code in (403, 422), (code, data))
settings.ALLOW_PUBLIC_AGENT_SIGNUP = True
code, data, _ = raw("GET", "/auth/registration-options")
check("user sign-up can be switched on", code == 200 and data.get("user") is True and data.get("it_admin") is False, data)
code, data, _ = raw("POST", "/auth/register", {"name": "Closed Door", "email": "closed.admin2@example.com", "password": PW, "role": "IT_ADMIN"})
check("switching on user sign-up does not open IT Admin sign-up", code == 403, (code, data))
settings.ALLOW_PUBLIC_IT_ADMIN_SIGNUP = True
code, data, _ = raw("GET", "/auth/registration-options")
check("the register page can ask which account types are open", code == 200 and data.get("it_admin") is True and data.get("super_admin") is False, data)
settings.ALLOW_PUBLIC_IT_ADMIN_SIGNUP = False
code, data, _ = raw("GET", "/auth/registration-options")
check("IT Admin sign-up can be switched off", code == 200 and data.get("it_admin") is False, data)
code, data, _ = raw("POST", "/auth/register", {"name": "Wannabe Admin", "email": "wannabe@example.com", "password": PW, "role": "IT_ADMIN"})
check("public IT Admin registration is refused when switched off", code == 403, data)
code, data, _ = raw("POST", "/auth/register", {"name": "Regular User", "email": "regular@example.com", "password": PW, "role": "IT_AGENT"})
check("ordinary user sign-up still works", code == 200, data)
settings.ALLOW_PUBLIC_IT_ADMIN_SIGNUP = True
code, data, _ = raw("POST", "/auth/register", {"name": "Second Boss", "email": "boss2@example.com", "password": PW, "role": "SUPER_ADMIN"})
check("a second Super Admin cannot register", code == 403, data)
settings.ALLOW_PUBLIC_SUPER_ADMIN_SIGNUP = False
code, data, _ = raw("POST", "/auth/register", {"name": "Boss", "email": "boss3@example.com", "password": PW, "role": "SUPER_ADMIN"})
check("Super Admin sign-up can be closed", code == 403, data)
settings.ALLOW_PUBLIC_SUPER_ADMIN_SIGNUP = True

print("Who can manage whom")
code, data, _ = raw("POST", "/auth/register", {"name": "Floating Agent", "email": "floating@example.com", "password": PW, "role": "IT_AGENT"})
floating_id = raw("GET", "/users/unassigned", token=TOKENS["super"])[1][0]["id"] if code == 200 else None
check("the new sign-up exists and the Super Admin can see them", floating_id is not None, code)
for who in ("adminA", "adminB", "samA", "reportA", "agentA"):
    code, data, _ = raw("GET", "/users/unassigned", token=TOKENS[who])
    check(f"{who} cannot list people who are not in an organization (403)", code == 403, (code, data))
    code, data, _ = raw("POST", f"/users/{floating_id}/add-to-organization", {"company_id": COMPANIES["A"]}, token=TOKENS[who])
    check(f"{who} cannot place a person in an organization (403)", code == 403, (code, data))
for action, method, path, body in [
    ("reset the password of", "POST", f"/users/{floating_id}/reset-password", {"new_password": "Hijacked!1234"}),
    ("deactivate", "DELETE", f"/users/{floating_id}", None),
    ("reactivate", "POST", f"/users/{floating_id}/reactivate", None),
]:
    code, data, _ = raw(method, path, body, token=TOKENS["adminA"])
    check(f"an IT Admin cannot {action} someone who is not in their organization", code == 404, (code, data))
with Session() as db:
    check("after those attempts the person is still in no organization",
          db.query(User).filter(User.id == floating_id).first().company_id is None)
code, data, _ = raw("POST", f"/users/{floating_id}/add-to-organization", {"company_id": "no-such-company"}, token=TOKENS["super"])
check("the Super Admin cannot place a person in a company that does not exist", code == 404, (code, data))
code, data, _ = raw("POST", f"/users/{floating_id}/add-to-organization", {"company_id": COMPANIES["A"]}, token=TOKENS["super"])
check("the Super Admin places the person in an organization", code == 200 and data.get("company_id") == COMPANIES["A"], (code, data))
code, data, _ = raw("POST", f"/users/{floating_id}/add-to-organization", {"company_id": COMPANIES["B"]}, token=TOKENS["super"])
check("a person who already has an organization cannot be placed again", code == 400, (code, data))
code, data, _ = raw("POST", f"/users/{floating_id}/reset-password", {"new_password": "Hijacked!1234"}, token=TOKENS["adminB"])
check("another company's IT Admin cannot manage the person who was just placed", code == 404, (code, data))
code, data, _ = raw("GET", "/users/unassigned", token=TOKENS["super"])
check("the placed person is no longer listed as waiting", code == 200 and all(u["id"] != floating_id for u in data), (code, data))
code, data, _ = raw("POST", f"/users/{IDS['adminA']}/reset-password", {"new_password": "Hijacked!1234"}, token=TOKENS["adminB"])
check("an IT Admin cannot reset another company's IT Admin", code == 404, data)
code, data, _ = raw("POST", f"/users/{IDS['super']}/reset-password", {"new_password": "Hijacked!1234"}, token=TOKENS["adminA"])
check("an IT Admin cannot reset the Super Admin", code in (403, 404), (code, data))
code, data, _ = raw("DELETE", f"/users/{IDS['super']}", token=TOKENS["adminA"])
check("an IT Admin cannot remove the Super Admin", code in (403, 404), (code, data))
code, data, _ = raw("POST", "/users", {"email": "newadmin@example.com", "full_name": "New Admin", "password": PW, "role": "IT_ADMIN"}, token=TOKENS["adminA"])
check("an IT Admin cannot create another IT Admin", code == 403, data)
code, data, _ = raw("PUT", f"/users/{case_id}", {"role": "IT_ADMIN"}, token=TOKENS["adminA"])
check("an IT Admin cannot promote someone to IT Admin", code == 403, data)
code, data, _ = raw("POST", "/users", {"email": "newadmin@example.com", "full_name": "New Admin", "password": PW, "role": "IT_ADMIN",
                                       "company_id": COMPANIES["A"]}, token=TOKENS["super"])
check("the Super Admin can create an IT Admin", code == 201, data)

print("Password recovery")
rate_limit.reset_for_tests()
code, data, _ = raw("POST", "/auth/forgot-password", {"email": "Case.User@example.com"})
check("a forgotten-password request is accepted (same answer for any address)", code == 200, data)
code, data, _ = raw("GET", "/notifications?limit=50", token=TOKENS["adminA"])
check("the user's IT Admin is told", code == 200 and any("asked for a password reset" in n["title"] for n in data), data)
code, data, _ = raw("POST", "/auth/forgot-password", {"email": "admin.a@example.com"})
code, data, _ = raw("GET", "/notifications?limit=50", token=TOKENS["super"])
check("an IT Admin's request reaches the Super Admin, with a link that exists",
      code == 200 and any("asked for a password reset" in n["title"] and n.get("link") == "/super-admin/work" for n in data), data)
code, data, _ = raw("POST", "/auth/forgot-password", {"email": "nobody.here@example.com"})
check("an unknown address gets the same answer", code == 200 and "If that account exists" in data.get("message", ""), data)

print("Limits and headers")
code, data, hdrs = raw("GET", "/health")
hdrs = {k.lower(): v for k, v in hdrs.items()}
check("API answers carry security headers", code == 200 and hdrs.get("x-content-type-options") == "nosniff"
      and hdrs.get("x-frame-options") == "DENY" and "no-store" in hdrs.get("cache-control", ""), hdrs)
check("the health check says ok when the database answers", code == 200 and data == {"status": "ok"}, (code, data))
# Database down: a session on a database that cannot be opened.
_broken_engine = create_engine("sqlite:////nonexistent-folder/itam.db", connect_args={"check_same_thread": False})
_BrokenSession = sessionmaker(bind=_broken_engine)


def _broken_db():
    session = _BrokenSession()
    try:
        yield session
    finally:
        session.close()


_working_db = app.dependency_overrides[get_db]
app.dependency_overrides[get_db] = _broken_db
code, data, hdrs = raw("GET", "/health")
app.dependency_overrides[get_db] = _working_db
check("the health check returns 503 when the database is unavailable", code == 503, (code, data))
check("and says so without revealing details", data == {"status": "unavailable"}, data)
code, data, _ = raw("GET", "/health")
check("the health check recovers once the database is back", code == 200, (code, data))
for path in ("/users?limit=100000", "/audit-logs?limit=100000", "/vendors?limit=100000", "/inventory?limit=100000", "/users?skip=-1"):
    code, data, _ = raw("GET", path, token=TOKENS["adminA"])
    check(f"GET {path.split('?')[0]} refuses an unbounded page", code == 422, (code, data))


async def _size_limit_checks():
    seen = {}

    async def echo(scope, receive, send):
        body = b""
        while True:
            message = await receive()
            body += message.get("body", b"")
            if not message.get("more_body"):
                break
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send({"type": "http.response.body", "body": str(len(body)).encode()})

    app_with_limit = BodySizeLimitMiddleware(echo, max_bytes=100)

    async def call_app(chunks, headers):
        responses = []
        pending = list(chunks)

        async def receive():
            if pending:
                chunk = pending.pop(0)
                return {"type": "http.request", "body": chunk, "more_body": bool(pending)}
            return {"type": "http.disconnect"}

        async def send(message):
            responses.append(message)

        await app_with_limit({"type": "http", "method": "POST", "path": "/x", "headers": headers}, receive, send)
        return responses[0]["status"]

    seen["small"] = await call_app([b"a" * 50], [])
    seen["declared"] = await call_app([b"a" * 500], [(b"content-length", b"500")])
    seen["streamed"] = await call_app([b"a" * 60, b"a" * 60], [])
    return seen


sizes = asyncio.run(_size_limit_checks())
check("a request body within the limit goes through", sizes["small"] == 200, sizes)
check("a body larger than the limit is refused (declared length)", sizes["declared"] == 413, sizes)
check("a body larger than the limit is refused (streamed, no length)", sizes["streamed"] == 413, sizes)

print("Vendors and references")
vendor_id = created("adminA", "POST", "/vendors", {"name": "Dell Inc"})
code, data, _ = raw("POST", "/assets", {"name": "Dell box", "category": "Laptop", "serial_number": "V-1", "vendor_id": vendor_id}, token=TOKENS["adminA"])
code, data, _ = raw("DELETE", f"/vendors/{vendor_id}", token=TOKENS["adminA"])
check("a vendor still used by assets is not deleted (409, not a crash)", code == 409, (code, data))

print("Reports stay private")
code, data, _ = raw("POST", "/reports/runs", {"report_type": "my_tickets"}, token=TOKENS["empA"])
code2, runs, _ = raw("GET", "/reports/runs", token=TOKENS["adminA"])
check("an IT Admin's list does not show a user's personal report", code == 201 and code2 == 200 and all(r["id"] != data.get("id") for r in runs), (code, code2))
code, data, _ = raw("GET", f"/reports/runs/{data.get('id')}/download", token=TOKENS["adminA"])
check("nor can the IT Admin download it", code == 404, data)

print("WebSockets")


async def _ws_checks():
    results = {}
    url = f"ws://127.0.0.1:{PORT}/api/assets/ws/{COMPANIES['A']}"

    async def opens(token, origin=None, query=False, company=COMPANIES["A"]):
        target = f"ws://127.0.0.1:{PORT}/api/assets/ws/{company}"
        try:
            if query:
                connection = websockets.connect(f"{target}?token={token}", origin=origin)
            else:
                connection = websockets.connect(target, subprotocols=["itam.v1", f"bearer.{token}"], origin=origin)
            async with connection as ws:
                await ws.send("hello")
                reply = await asyncio.wait_for(ws.recv(), timeout=2)
                return reply == "pong: hello", ws.subprotocol
        except Exception:
            return False, None

    results["subprotocol"] = await opens(TOKENS["adminA"])
    results["query"] = await opens(TOKENS["adminA"], query=True)
    results["no_token"] = await opens("")
    results["bad_token"] = await opens("not-a-token")
    results["other_company"] = await opens(TOKENS["adminB"])
    results["employee"] = await opens(TOKENS["empA"])
    results["evil_origin"] = await opens(TOKENS["adminA"], origin="https://evil.example")
    results["old_token"] = await opens(token_before_change)
    return results


ws_results = asyncio.run(_ws_checks())
check("the socket opens with the token in the subprotocol", ws_results["subprotocol"] == (True, "itam.v1"), ws_results["subprotocol"])
check("the older ?token= form still works", ws_results["query"][0] is True, ws_results["query"])
check("a socket without a token is refused", ws_results["no_token"][0] is False, ws_results["no_token"])
check("a socket with a bad token is refused", ws_results["bad_token"][0] is False, ws_results["bad_token"])
check("another company's IT Admin cannot join the feed", ws_results["other_company"][0] is False, ws_results["other_company"])
check("a user cannot join the company-wide feed", ws_results["employee"][0] is False, ws_results["employee"])
check("a page on another website cannot open a signed-in socket", ws_results["evil_origin"][0] is False, ws_results["evil_origin"])
check("a token from before a password change cannot open a socket", ws_results["old_token"][0] is False, ws_results["old_token"])

print(f"\n{sum(RESULTS)}/{len(RESULTS)} passed")
server.should_exit = True
sys.exit(0 if all(RESULTS) else 1)
