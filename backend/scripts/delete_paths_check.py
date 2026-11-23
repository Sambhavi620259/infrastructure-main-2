"""
Delete paths on a real PostgreSQL database: every delete either works or is refused with a
clear message (400 / 409), never a crash, even when other records point at the row.

SQLite does not enforce foreign keys, so this needs a real, empty, already-migrated database:

    createdb itam_delete_check && DATABASE_URL=... alembic upgrade head
    DELETE_CHECK_DATABASE_URL=postgresql+psycopg2://... .venv/bin/python scripts/delete_paths_check.py
"""
import json
import os
import sys
import threading
import time
import urllib.error
import urllib.request

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

if not os.environ.get("DELETE_CHECK_DATABASE_URL"):
    raise SystemExit(__doc__)

import uvicorn  # noqa: E402
from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402

from app.core.database import get_db  # noqa: E402
from app.core.security import issue_token  # noqa: E402
from app.main import app  # noqa: E402
from app.models.models import Company, PlatformRole, Subscription, User  # noqa: E402

PORT = 8774
from _dbguard import require_disposable
engine = create_engine(require_disposable(os.environ["DELETE_CHECK_DATABASE_URL"], "DELETE_CHECK_DATABASE_URL"), pool_size=10)
Session = sessionmaker(bind=engine)

TOKENS = {}
IDS = {}
with Session() as db:
    company = Company(name="Delete Check Org", code="DEL")
    db.add(company)
    db.flush()
    db.add(Subscription(company_id=company.id, plan="ENTERPRISE", user_limit=100, asset_limit=100))
    for key, role in (("admin", PlatformRole.IT_ADMIN), ("user", PlatformRole.EMPLOYEE)):
        user = User(email=f"{key}@delete.example.com", hashed_password="x", full_name=key.title(), role=role,
                    company_id=company.id, status="ACTIVE")
        db.add(user)
        db.flush()
        TOKENS[key] = issue_token(user)
        IDS[key] = user.id
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
        data=json.dumps(body).encode() if body is not None else None, method=method,
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {TOKENS[who]}"},
    )
    try:
        with urllib.request.urlopen(request) as response:
            raw = response.read()
            return response.status, (json.loads(raw) if raw else {})
    except urllib.error.HTTPError as error:
        text = error.read().decode()
        try:
            return error.code, json.loads(text)
        except ValueError:
            return error.code, text[:200]


RESULTS = []


def check(label, ok, detail=""):
    RESULTS.append(bool(ok))
    print(f"  {'PASS' if ok else 'FAIL'}  {label}" + ("" if ok else f"  -> {detail}"))


def make(who, method, path, body):
    code, data = call(who, method, path, body)
    if code not in (200, 201):
        raise SystemExit(f"setup failed: {method} {path} -> {code} {data}")
    return data


print("Vendors")
vendor = make("admin", "POST", "/vendors", {"name": "Dell"})
spare_vendor = make("admin", "POST", "/vendors", {"name": "Unused vendor"})
asset = make("admin", "POST", "/assets", {"name": "Dell box", "category": "Laptop", "serial_number": "D-1", "vendor_id": vendor["id"]})
code, data = call("admin", "DELETE", f"/vendors/{vendor['id']}")
check("a vendor still used by an asset is refused (409)", code == 409, (code, data))
code, data = call("admin", "DELETE", f"/vendors/{spare_vendor['id']}")
check("an unused vendor is deleted", code == 204, (code, data))

print("Departments")
dept = make("admin", "POST", "/departments", {"name": "Finance"})
empty_dept = make("admin", "POST", "/departments", {"name": "Empty"})
code, data = call("admin", "PUT", f"/users/{IDS['user']}", {"department_id": dept["id"]})
code, data = call("admin", "DELETE", f"/departments/{dept['id']}")
check("a department with people is refused (409)", code == 409, (code, data))
code, data = call("admin", "DELETE", f"/departments/{empty_dept['id']}")
check("an empty department is deleted", code == 204, (code, data))

print("Assets")
held = make("admin", "POST", "/assets", {"name": "Held laptop", "category": "Laptop", "serial_number": "H-1"})
call("admin", "POST", f"/assets/{held['id']}/assign", {"user_id": IDS["user"]})
code, data = call("admin", "DELETE", f"/assets/{held['id']}")
check("an asset someone holds is refused (400)", code == 400, (code, data))
code, data = call("admin", "POST", "/maintenance", {"asset_id": asset["id"], "issue": "Screen flicker", "status": "SCHEDULED"})
maintenance_id = data.get("id") if code in (200, 201) else None
check("a maintenance record can be created", maintenance_id is not None, (code, data))
# A problem ticket needs the asset to be the user's; the admin takes it back afterwards.
call("admin", "POST", f"/assets/{asset['id']}/assign", {"user_id": IDS["user"]})
ticket = make("user", "POST", "/asset-requests", {"ticket_type": "ISSUE", "asset_id": asset["id"], "priority": "LOW", "reason": "Keys stick"})
call("admin", "POST", f"/assets/{asset['id']}/unassign")
code, data = call("admin", "DELETE", f"/assets/{asset['id']}")
check("an unassigned asset with history, maintenance and a ticket is deleted (204)", code == 204, (code, data))
code, data = call("user", "GET", f"/asset-requests/{ticket['id']}")
check("the ticket about it survives, no longer pointing at the asset", code == 200 and data.get("asset_id") is None, (code, data))

print("Tickets")
call("user", "POST", f"/asset-requests/{ticket['id']}/comments", {"body": "Any news?"})
code, data = call("user", "DELETE", f"/asset-requests/{ticket['id']}")
check("a ticket with comments and history is deleted by its owner (204)", code == 204, (code, data))

print("Inventory")
item = make("admin", "POST", "/inventory", {"name": "HDMI cable", "category": "Cables", "quantity": 10, "reorder_level": 2})
call("admin", "POST", f"/inventory/{item['id']}/adjust", {"change": -2, "reason": "Given to a user"})
call("admin", "POST", "/inventory/requests", {"item_id": item["id"], "quantity": 1, "reason": "Spare"})
code, data = call("admin", "DELETE", f"/inventory/{item['id']}")
check("an inventory item with movements and requests is deleted (204)", code == 204, (code, data))

print("Software")
product = make("admin", "POST", "/software", {"name": "Office", "vendor": "MS", "license": {"license_number": "OFF-1234", "seats": 3, "license_type": "PERPETUAL"}})
seat = make("admin", "POST", f"/software/{product['id']}/assign", {"user_id": IDS["user"]})
code, data = call("admin", "DELETE", f"/software/{product['id']}")
check("software with a seat in use is refused (400)", code == 400, (code, data))
call("admin", "POST", f"/software/assignments/{seat['assignment_id']}/release")
code, data = call("admin", "DELETE", f"/software/{product['id']}")
check("software with only released seats is deleted (204)", code == 204, (code, data))

print("Maintenance and reports")
if maintenance_id:
    code, data = call("admin", "DELETE", f"/maintenance/{maintenance_id}")
    check("a maintenance record is deleted (204) or already went with its asset (404)", code in (204, 404), (code, data))
# "my tickets" is the personal report every user can run.
run = make("user", "POST", "/reports/runs", {"report_type": "my_tickets", "save": True})
code, data = call("user", "DELETE", f"/reports/runs/{run['id']}")
check("a generated report is deleted (204)", code == 204, (code, data))
saved = call("user", "GET", "/reports/saved")[1]
check("the report was also saved", bool(saved), saved)
if saved:
    code, data = call("user", "DELETE", f"/reports/saved/{saved[0]['id']}")
    check("a saved report is deleted (204)", code == 204, (code, data))

print(f"\n{sum(RESULTS)}/{len(RESULTS)} passed")
server.should_exit = True
sys.exit(0 if all(RESULTS) else 1)
