"""
End-to-end checks for the ticket workflow: hardware, software and access
requests, approvals, shortages, reservations, comments, attachments, history,
resolution and reopening, and who may do what.

Runs the real app (with the access guard) on a throwaway SQLite database and
signs requests with real JWTs.

    cd backend && .venv/bin/python scripts/ticket_workflow_test.py

TICKET_DATABASE_URL runs against a real, empty, already-migrated database
(e.g. PostgreSQL); the concurrent-allocation checks run only there, because
SQLite serialises writes. Exits non-zero if any check fails.
"""
import base64
import json
import os
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

import uvicorn  # noqa: E402
from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402

from app.core.database import Base, get_db  # noqa: E402
from app.core.security import create_access_token  # noqa: E402
from app.main import app  # noqa: E402
from app.models.models import AccessGrant, Company, PlatformRole, Subscription, User  # noqa: E402
from app.services.access_service import expire_access_grants  # noqa: E402

PORT = 8772
ON_POSTGRES = bool(os.environ.get("TICKET_DATABASE_URL"))
if ON_POSTGRES:
    engine = create_engine(os.environ["TICKET_DATABASE_URL"], pool_size=20)
else:
    engine = create_engine(f"sqlite:///{os.path.join(tempfile.mkdtemp(), 'tickets.db')}",
                           connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
Session = sessionmaker(bind=engine)

TOKENS, IDS, COMPANY = {}, {}, {}
with Session() as db:
    for org, people in (("A", [("admin", PlatformRole.IT_ADMIN), ("admin2", PlatformRole.IT_ADMIN),
                               ("ham", PlatformRole.SUB_ADMIN), ("u1", PlatformRole.EMPLOYEE),
                               ("u2", PlatformRole.EMPLOYEE), ("u3", PlatformRole.EMPLOYEE)]),
                        ("B", [("admin", PlatformRole.IT_ADMIN), ("u1", PlatformRole.EMPLOYEE)])):
        company = Company(name=f"Ticket Org {org}", code=f"T{org}")
        db.add(company)
        db.flush()
        COMPANY[org] = company.id
        db.add(Subscription(company_id=company.id, plan="ENTERPRISE", user_limit=100, asset_limit=100))
        for key, role in people:
            user = User(email=f"{key}.t{org.lower()}@example.com", hashed_password="x",
                        full_name=f"{key.upper()} {org}", role=role, company_id=company.id, status="ACTIVE",
                        modules=["HAM", "SAM"] if role == PlatformRole.SUB_ADMIN else None,
                        employee_code="EMP-001" if key == "u1" and org == "A" else None)
            db.add(user)
            db.flush()
            TOKENS[key + org] = create_access_token({"sub": user.id})
            IDS[key + org] = user.id
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


def call(who, method, path, body=None, raw=False):
    request = urllib.request.Request(
        f"http://127.0.0.1:{PORT}/api{path}", data=json.dumps(body).encode() if body is not None else None,
        method=method, headers={"Content-Type": "application/json", "Authorization": f"Bearer {TOKENS[who]}"},
    )
    try:
        with urllib.request.urlopen(request) as response:
            data = response.read()
            if raw:
                return response.status, data, dict(response.headers)
            return response.status, json.loads(data or b"{}")
    except urllib.error.HTTPError as error:
        text = error.read().decode()
        if raw:
            return error.code, text, {}
        try:
            return error.code, json.loads(text)
        except ValueError:
            return error.code, text


RESULTS = []


def check(label, ok, detail=""):
    RESULTS.append(bool(ok))
    print(f"  {'PASS' if ok else 'FAIL'}  {label}" + ("" if ok else f"  -> {str(detail)[:240]}"))


def move(who, ticket, status, **extra):
    return call(who, "PUT", f"/asset-requests/{ticket['id']}", {"status": status, **extra})


tomorrow = (datetime.utcnow() + timedelta(days=1)).strftime("%Y-%m-%dT00:00:00")
next_week = (datetime.utcnow() + timedelta(days=7)).strftime("%Y-%m-%dT00:00:00")
yesterday = (datetime.utcnow() - timedelta(days=1)).strftime("%Y-%m-%dT00:00:00")

# --- Setup: a category, two devices, departments ------------------------------
code, cat = call("adminA", "POST", "/assets/categories", {"name": "Laptop"})
code, dept = call("adminA", "POST", "/departments", {"name": "Engineering"})
code, dev1 = call("adminA", "POST", "/assets", {"name": "ThinkPad 1", "category": "Laptop", "serial_number": "TP-1"})
code, dev2 = call("adminA", "POST", "/assets", {"name": "ThinkPad 2", "category": "Laptop", "serial_number": "TP-2"})

print("Submitting a request")
code, t1 = call("u1A", "POST", "/asset-requests", {
    "asset_category_id": cat["id"], "department_id": dept["id"], "reason": "Laptop for new project",
    "priority": "HIGH", "required_date": next_week, "additional_comments": "16 GB RAM please"})
check("a user submits a hardware request with priority, required date and comments",
      code == 201 and t1["status"] == "PENDING" and t1["priority"] == "HIGH" and t1["additional_comments"]
      and t1["required_date"].startswith(next_week[:10]), t1)
check("it gets a ticket number and records the requester's employee ID",
      t1.get("ticket_no") == 1 and t1["requester_employee_id"] == "EMP-001" and t1["department_name"] == "Engineering", t1)
code, body = call("u1A", "POST", "/asset-requests", {"asset_category_id": cat["id"], "reason": "x", "required_date": yesterday})
check("a required date in the past is refused", code == 400, body)
code, body = call("u1A", "POST", "/asset-requests", {"asset_category_id": cat["id"], "reason": "x", "priority": "URGENT"})
check("an unknown priority is refused", code == 422, body)
code, t2 = call("u2A", "POST", "/asset-requests", {"asset_category_id": cat["id"], "reason": "Second laptop",
                                                    "priority": "CRITICAL"})
check("ticket numbers run on per organization", code == 201 and t2["ticket_no"] == 2, t2)
code, tb = call("u1B", "POST", "/asset-requests", {"asset_category_id": call("adminB", "POST", "/assets/categories", {"name": "Laptop"})[1]["id"], "reason": "B"})
check("another organization starts its own numbering", code == 201 and tb["ticket_no"] == 1, tb)
code, history = call("u1A", "GET", f"/asset-requests/{t1['id']}/history")
check("the history records the submission", code == 200 and history and history[0]["action"] == "CREATED", history)

print("Privacy: users only see their own tickets")
for path in (f"/asset-requests/{t1['id']}", f"/asset-requests/{t1['id']}/comments", f"/asset-requests/{t1['id']}/history",
             f"/asset-requests/{t1['id']}/attachments"):
    code, body = call("u2A", "GET", path)
    check(f"another user gets 404 for {path.split('/')[-1] if path.count('/') > 2 else 'the ticket'}", code == 404, body)
code, body = call("u2A", "POST", f"/asset-requests/{t1['id']}/comments", {"body": "hi"})
check("another user cannot comment on it", code == 404, body)
code, body = call("adminB", "GET", f"/asset-requests/{t1['id']}")
check("another organization's admin cannot open it", code == 404, body)
code, page = call("u2A", "GET", "/asset-requests/search")
check("a user's search returns only their own tickets", code == 200 and page["total"] == 1 and page["items"][0]["id"] == t2["id"], page)

print("Review, assignment and comments")
code, body = move("adminA", t1, "UNDER_REVIEW")
check("an admin starts reviewing", code == 200 and body["status"] == "UNDER_REVIEW", body)
code, body = call("adminA", "POST", f"/asset-requests/{t1['id']}/assign", {"assignee_id": IDS["admin2A"]})
check("the ticket is assigned to an IT team member", code == 200 and body["assignee_name"] == "ADMIN2 A", body)
code, body = call("adminA", "POST", f"/asset-requests/{t1['id']}/assign", {"assignee_id": IDS["u2A"]})
check("it cannot be assigned to a user outside the IT team", code == 400, body)
code, body = call("u1A", "POST", f"/asset-requests/{t1['id']}/assign", {"assignee_id": IDS["u1A"]})
check("a user cannot assign tickets", code == 403, body)
call("adminA", "POST", f"/asset-requests/{t1['id']}/comments", {"body": "Check budget code first", "internal": True})
call("adminA", "POST", f"/asset-requests/{t1['id']}/comments", {"body": "We have one in stock."})
code, comments = call("u1A", "GET", f"/asset-requests/{t1['id']}/comments")
check("the requester sees comments but not internal notes",
      code == 200 and [c["body"] for c in comments] == ["We have one in stock."], comments)
code, comments = call("admin2A", "GET", f"/asset-requests/{t1['id']}/comments")
check("the IT team sees internal notes too", code == 200 and len(comments) == 2, comments)
code, body = call("u1A", "POST", f"/asset-requests/{t1['id']}/comments", {"body": "secret", "internal": True})
check("users cannot write internal notes", code == 403, body)
code, history = call("u1A", "GET", f"/asset-requests/{t1['id']}/history")
check("the requester's history leaves out internal steps (assignment)",
      code == 200 and all(e["action"] != "ASSIGNED" for e in history), history)

print("Waiting for the user")
code, body = move("adminA", t1, "WAITING_USER")
check("asking the user for more information needs a note", code == 400, body)
code, body = move("adminA", t1, "WAITING_USER", note="Which OS do you need?")
check("the ticket waits for the user", code == 200 and body["status"] == "WAITING_USER", body)
code, body = call("u1A", "POST", f"/asset-requests/{t1['id']}/comments", {"body": "Windows 11"})
code, body = call("u1A", "GET", f"/asset-requests/{t1['id']}")
check("the user's reply puts it back under review", body["status"] == "UNDER_REVIEW", body)

print("Hardware: approval, reservation and handover")
code, body = move("u1A", t1, "APPROVED")
check("a user cannot approve a ticket", code == 403, body)
code, body = call("adminA", "PUT", "/approval-policies/ASSET", {"approver_roles": ["IT_ADMIN"]})
code, body = move("hamA", t1, "APPROVED")
check("a sub-admin cannot approve when the rule names only IT Admins", code == 403, body)
code, body = move("adminA", t1, "APPROVED", reserve_asset_id=dev1["id"])
check("approving reserves a device for the requester", code == 200 and body["status"] == "APPROVED"
      and body["assigned_asset_id"] == dev1["id"], body)
code, device = call("adminA", "GET", f"/assets/{dev1['id']}")
check("the device is marked reserved", device["status"] == "REQUESTED", device)
code, body = call("adminA", "POST", f"/assets/{dev1['id']}/assign", {"user_id": IDS["u2A"]})
check("a reserved device cannot be assigned to someone else directly", code == 400 and "reserved" in str(body), body)
move("adminA", t2, "UNDER_REVIEW")
code, body = move("adminA", t2, "APPROVED", reserve_asset_id=dev1["id"])
check("the same device cannot be reserved for a second ticket", code == 400, body)
code, body = move("adminA", t1, "FULFILLED")
check("handover assigns the reserved device and resolves the ticket", code == 200 and body["status"] == "FULFILLED"
      and body["resolved_at"], body)
code, device = call("adminA", "GET", f"/assets/{dev1['id']}")
check("the device is now assigned to the requester", device["status"] == "ASSIGNED" and device["assigned_to_id"] == IDS["u1A"], device)

print("Hardware unavailable")
code, body = move("adminA", t2, "APPROVED")
code, body = move("adminA", t2, "WAITING_INVENTORY")
check("waiting for inventory needs an expected date or procurement notes", code == 400, body)
code, body = move("adminA", t2, "WAITING_INVENTORY", expected_date=next_week, procurement_note="PO-77 raised with Dell")
check("the request waits for inventory with the procurement details",
      code == 200 and body["status"] == "WAITING_INVENTORY" and body["procurement_note"] == "PO-77 raised with Dell", body)
code, body = move("adminA", t2, "FULFILLED")
check("a shortage cannot be marked resolved without a device", code == 400, body)
code, body = move("adminA", t2, "IN_PROGRESS", reserve_asset_id=dev2["id"])
check("when stock arrives, a device is reserved and work continues", code == 200 and body["status"] == "IN_PROGRESS"
      and body["assigned_asset_id"] == dev2["id"], body)
code, body = move("adminA", t2, "CANCELLED")
code, device = call("adminA", "GET", f"/assets/{dev2['id']}")
check("cancelling releases the reservation back to stock", device["status"] == "IN_STOCK", device)

print("Resolution, confirmation and reopening")
code, body = call("u2A", "POST", f"/asset-requests/{t1['id']}/confirm")
check("only the requester can confirm", code in (403, 404), body)
code, body = call("u1A", "POST", f"/asset-requests/{t1['id']}/reopen", {"reason": "Charger missing"})
check("the requester reopens a resolved ticket", code == 200 and body["status"] == "UNDER_REVIEW" and body["reopen_count"] == 1, body)
code, comments = call("u1A", "GET", f"/asset-requests/{t1['id']}/comments")
check("the reopen reason is added to the conversation", any("Charger missing" in c["body"] for c in comments), comments)
code, body = move("adminA", t1, "FULFILLED", note="Charger handed over", assigned_asset_id=None)
check("the IT team cannot resolve a reopened hardware ticket without a device in stock", code == 400, body)
code, body = move("adminA", t1, "CLOSED")
check("an under-review ticket cannot be closed directly", code == 400, body)

code, t3 = call("u1A", "POST", "/asset-requests", {"ticket_type": "ISSUE", "asset_id": dev1["id"], "reason": "Screen flickers"})
code, body = move("adminA", t3, "WAITING_INVENTORY", procurement_note="x")
check("a problem ticket cannot wait for inventory", code == 400, body)
code, body = move("adminA", t3, "APPROVED")
check("a problem ticket is not approved", code == 400, body)
code, body = move("adminA", t3, "FULFILLED", resolution_note="Replaced the display cable")
check("a problem ticket is resolved with a note", code == 200 and body["status"] == "FULFILLED", body)
code, body = call("u1A", "POST", f"/asset-requests/{t3['id']}/confirm")
check("the requester confirms: the ticket is closed", code == 200 and body["status"] == "CLOSED" and body["closed_at"], body)
code, body = call("u1A", "POST", f"/asset-requests/{t3['id']}/reopen", {"reason": "It flickers again"})
check("a requester cannot reopen a closed ticket", code == 400, body)
code, body = move("adminA", t3, "UNDER_REVIEW")
check("a closed ticket cannot be moved", code == 400, body)
code, body = call("adminA", "POST", f"/asset-requests/{t3['id']}/reopen", {"reason": "User reported again"})
check("the IT team can reopen a closed ticket", code == 200 and body["status"] == "UNDER_REVIEW", body)
code, body = move("adminA", t3, "REJECTED")
check("rejecting needs a reason", code == 400, body)

print("Software: approval, license exhaustion and release")
code, office = call("adminA", "POST", "/software", {"name": "Office", "license": {"seats": 1}})
code, free_tool = call("adminA", "POST", "/software", {"name": "7-Zip", "approval_required": False, "license": {"seats": 5}})
check("software can be marked as not needing approval", code == 201 and free_tool["approval_required"] is False, free_tool)
code, s1 = call("u1A", "POST", "/asset-requests", {"ticket_type": "SOFTWARE", "software_id": office["id"], "reason": "Docs"})
code, s2 = call("u2A", "POST", "/asset-requests", {"ticket_type": "SOFTWARE", "software_id": office["id"], "reason": "Docs"})
code, body = move("adminA", s1, "FULFILLED")
check("software that needs approval cannot be given before approval", code == 400 and "approv" in str(body), body)
move("adminA", s1, "APPROVED")
code, body = move("adminA", s1, "FULFILLED", deployment_status="PENDING")
check("after approval a seat is allocated, installation pending", code == 200 and body["status"] == "FULFILLED", body)
code, seats = call("u1A", "GET", "/software/mine")
seat = next((s for s in seats if s["software_name"] == "Office"), {})
check("the user's seat shows installation as pending (not installed)", seat.get("deployment_status") == "PENDING", seats)
code, body = call("u1A", "PUT", f"/software/assignments/{seat.get('id')}/deployment", {"status": "INSTALLED"})
check("users cannot mark software as installed", code == 403, body)
code, body = call("adminA", "PUT", f"/software/assignments/{seat.get('id')}/deployment", {"status": "FAILED"})
check("a failed installation needs a note", code == 400, body)
code, body = call("adminA", "PUT", f"/software/assignments/{seat.get('id')}/deployment", {"status": "INSTALLED", "note": "Installed via remote session"})
check("an admin records the installation as confirmed", code == 200 and body["deployment_status"] == "INSTALLED", body)
move("adminA", s2, "APPROVED")
code, body = move("adminA", s2, "FULFILLED")
check("license exhaustion: no seat is over-allocated", code == 400, body)
code, body = move("adminA", s2, "WAITING_LICENSE", procurement_note="Buying 5 more seats")
check("the request waits for a license", code == 200 and body["status"] == "WAITING_LICENSE", body)
code, licenses = call("adminA", "GET", "/software/licenses")
office_license = next(l for l in licenses if l["software_name"] == "Office")
check("the license still shows 1 of 1 seats used", (office_license["assigned"], office_license["available"]) == (1, 0), office_license)
call("adminA", "POST", f"/software/assignments/{seat['id']}/release")
code, body = move("adminA", s2, "FULFILLED")
check("once a seat is released, the waiting request is fulfilled", code == 200 and body["status"] == "FULFILLED", body)
code, s3 = call("u3A", "POST", "/asset-requests", {"ticket_type": "SOFTWARE", "software_id": free_tool["id"], "reason": "Unzip"})
code, body = move("adminA", s3, "FULFILLED")
check("software that needs no approval is given straight away", code == 200 and body["status"] == "FULFILLED", body)

print("Access management")
code, body = call("u1A", "POST", "/access/resources", {"name": "Finance DB", "access_levels": ["Read"]})
check("users cannot add access resources", code == 403, body)
code, body = call("adminA", "POST", "/access/resources", {"name": "VPN", "access_levels": ["User"], "privileged_levels": ["Admin"]})
check("privileged levels must be among the access levels", code == 400, body)
code, findb = call("adminA", "POST", "/access/resources", {
    "name": "Finance DB", "resource_type": "DATABASE", "owner_id": IDS["u3A"],
    "access_levels": ["Read", "Write", "Admin"], "privileged_levels": ["Admin"], "max_days": 90})
check("an admin adds a resource with an owner, levels and a 90-day limit", code == 201 and findb["owner_name"] == "U3 A", findb)
code, catalog = call("u1A", "GET", "/access/catalog")
check("users see the access catalogue", code == 200 and [r["name"] for r in catalog] == ["Finance DB"], catalog)
code, body = call("u1A", "POST", "/asset-requests", {"ticket_type": "ACCESS", "access_resource_id": findb["id"],
                                                      "access_level": "Root", "reason": "x", "access_until": next_week})
check("an unknown access level is refused", code == 400, body)
code, body = call("u1A", "POST", "/asset-requests", {"ticket_type": "ACCESS", "access_resource_id": findb["id"],
                                                      "access_level": "Admin", "reason": "x"})
check("a resource with a time limit needs an end date", code == 400, body)
far = (datetime.utcnow() + timedelta(days=200)).strftime("%Y-%m-%dT00:00:00")
code, body = call("u1A", "POST", "/asset-requests", {"ticket_type": "ACCESS", "access_resource_id": findb["id"],
                                                      "access_level": "Admin", "reason": "x", "access_until": far})
check("an end date beyond the resource's limit is refused", code == 400, body)
code, a1 = call("u1A", "POST", "/asset-requests", {"ticket_type": "ACCESS", "access_resource_id": findb["id"],
                                                    "access_level": "Admin", "reason": "Quarter-end close",
                                                    "access_until": next_week})
check("a user requests privileged access", code == 201 and a1["access_resource_name"] == "Finance DB"
      and a1["needs_owner_approval"] is True, a1)
code, body = call("u1A", "POST", "/asset-requests", {"ticket_type": "ACCESS", "access_resource_id": findb["id"],
                                                      "access_level": "Read", "reason": "x", "access_until": next_week})
check("a second open request for the same resource is refused", code == 400, body)
code, body = move("adminA", a1, "FULFILLED")
check("access is never granted before approval", code == 400, body)
code, body = move("adminA", a1, "APPROVED")
check("IT cannot approve before the resource owner", code == 400 and "owner" in str(body).lower(), body)
code, body = move("adminA", a1, "PENDING_APPROVAL")
check("the request is sent for approval", code == 200 and body["status"] == "PENDING_APPROVAL", body)
code, waiting = call("u3A", "GET", "/asset-requests?awaiting_my_approval=true")
check("the owner sees the request waiting for their approval", code == 200 and [t["id"] for t in waiting] == [a1["id"]], waiting)
code, body = call("u2A", "POST", f"/asset-requests/{a1['id']}/owner-decision", {"decision": "APPROVED"})
check("someone who is not the owner cannot approve", code in (403, 404), body)
code, body = call("u3A", "POST", f"/asset-requests/{a1['id']}/owner-decision", {"decision": "REJECTED"})
check("an owner rejection needs a reason", code == 400, body)
code, body = call("u3A", "POST", f"/asset-requests/{a1['id']}/owner-decision", {"decision": "APPROVED", "note": "OK for close"})
check("the owner approves", code == 200 and body["needs_owner_approval"] is False, body)
code, body = call("u3A", "PUT", f"/asset-requests/{a1['id']}", {"status": "APPROVED"})
check("the owner (a user) cannot do the IT approval", code in (403, 404), body)
code, body = move("adminA", a1, "APPROVED")
check("IT approves after the owner", code == 200 and body["status"] == "APPROVED"
      and {a["kind"] for a in body["approvals"]} == {"OWNER", "APPROVER"}, body)
code, body = move("adminA", a1, "FULFILLED")
check("access is recorded as granted with its end date", code == 200 and body["status"] == "FULFILLED"
      and body["access_grant_id"], body)
code, mine = call("u1A", "GET", "/access/mine")
check("the user sees their access", code == 200 and mine and mine[0]["access_level"] == "Admin"
      and mine[0]["privileged"] is True and mine[0]["is_active"], mine)
code, grants = call("u1A", "GET", "/access/grants")
check("users cannot list everyone's access", code == 403, grants)
code, body = call("adminA", "POST", f"/access/grants/{mine[0]['id']}/revoke", {"reason": "Close finished"})
check("an admin revokes access, keeping the record", code == 200 and body["is_active"] is False
      and body["revoke_reason"] == "Close finished", body)
code, a2 = call("u2A", "POST", "/asset-requests", {"ticket_type": "ACCESS", "access_resource_id": findb["id"],
                                                    "access_level": "Read", "reason": "Reports", "access_until": tomorrow})
move("adminA", a2, "PENDING_APPROVAL")
call("u3A", "POST", f"/asset-requests/{a2['id']}/owner-decision", {"decision": "APPROVED"})
move("adminA", a2, "APPROVED")
move("adminA", a2, "FULFILLED")
with Session() as db:
    grant = db.query(AccessGrant).filter(AccessGrant.user_id == IDS["u2A"], AccessGrant.is_active.is_(True)).first()
    grant.expires_at = datetime.utcnow() - timedelta(minutes=1)
    db.commit()
    ended = expire_access_grants(db)
    db.commit()
code, mine = call("u2A", "GET", "/access/mine")
check("expired access is ended by the daily check", ended == 1 and mine[0]["is_active"] is False
      and mine[0]["revoke_reason"] == "Expired", mine)
code, a3 = call("u3A", "POST", "/asset-requests", {"ticket_type": "ACCESS", "access_resource_id": findb["id"],
                                                    "access_level": "Read", "reason": "Own data", "access_until": tomorrow})
check("the owner's own request needs no owner approval", code == 201 and a3["needs_owner_approval"] is False, a3)
code, body = call("u3A", "POST", f"/asset-requests/{a3['id']}/owner-decision", {"decision": "APPROVED"})
check("the owner cannot approve their own request", code == 403, body)

print("Attachments")
png = base64.b64encode(b"\x89PNG\r\n\x1a\n" + b"0" * 64).decode()
code, att = call("u1A", "POST", f"/asset-requests/{t2['id']}/attachments", {"filename": "x.png", "content_type": "image/png", "data": png})
check("only the requester and IT team can attach files", code in (403, 404), att)
code, body = call("u1A", "POST", f"/asset-requests/{t1['id']}/attachments",
                  {"filename": "../../etc/screen.png", "content_type": "image/png", "data": "data:image/png;base64," + png})
check("the requester attaches an image (path stripped from the name)", code == 201 and body["filename"] == "screen.png", body)
code, fake = call("u1A", "POST", f"/asset-requests/{t1['id']}/attachments",
                  {"filename": "doc.pdf", "content_type": "application/pdf", "data": png})
check("a file whose content does not match its type is refused", code == 400, fake)
code, fake = call("u1A", "POST", f"/asset-requests/{t1['id']}/attachments",
                  {"filename": "run.exe", "content_type": "application/x-msdownload", "data": png})
check("other file types are refused", code == 400, fake)
big = base64.b64encode(b"%PDF-" + b"0" * (2 * 1024 * 1024)).decode()
code, fake = call("u1A", "POST", f"/asset-requests/{t1['id']}/attachments",
                  {"filename": "big.pdf", "content_type": "application/pdf", "data": big})
check("files over 2 MB are refused", code == 413, fake)
code, data, headers = call("adminA", "GET", f"/asset-requests/{t1['id']}/attachments/{body['id']}", raw=True)
check("the IT team downloads it as an attachment, not sniffed",
      code == 200 and data.startswith(b"\x89PNG") and "attachment" in headers.get("content-disposition", "")
      and headers.get("x-content-type-options") == "nosniff", headers)
code, body2, _ = call("u2A", "GET", f"/asset-requests/{t1['id']}/attachments/{body['id']}", raw=True)
check("another user cannot download it", code == 404, body2)

print("Dashboard counts and search")
code, counts = call("adminA", "GET", "/asset-requests/counts")
check("counts cover each status, high priority and admin action",
      code == 200 and counts["waiting_license"] == 0 and counts["high_priority"] >= 1 and counts["total"] >= 8
      and "needs_action" in counts and "awaiting_my_approval" in counts, counts)
code, page = call("adminA", "GET", "/asset-requests/search?priority=HIGH,CRITICAL&sort=priority&order=desc&limit=1")
check("search filters by priority, sorts and pages", code == 200 and page["total"] == 2 and len(page["items"]) == 1
      and page["items"][0]["priority"] == "CRITICAL", page)
code, page = call("adminA", "GET", "/asset-requests/search?q=TKT-000001")
check("search finds a ticket by its number", code == 200 and page["total"] == 1 and page["items"][0]["id"] == t1["id"], page)
code, page = call("adminA", "GET", "/asset-requests/search?ticket_type=ACCESS&requester=U1")
check("search filters by type and requester name", code == 200 and page["total"] == 1, page)
code, page = call("adminA", "GET", f"/asset-requests/search?department_id={dept['id']}&status=UNDER_REVIEW")
check("search filters by department and status", code == 200 and [t["id"] for t in page["items"]] == [t1["id"]], page)
code, page = call("adminA", "GET", f"/asset-requests/search?created_from={tomorrow[:10]}")
check("search filters by creation date", code == 200 and page["total"] == 0, page)
code, body = call("adminA", "GET", "/asset-requests/search?status=NOPE")
check("an unknown status filter is refused", code == 422, body)

if ON_POSTGRES:
    print("Concurrent allocation (PostgreSQL)")
    code, solo = call("adminA", "POST", "/software", {"name": "Solo", "approval_required": False, "license": {"seats": 1}})
    racers = []
    for key in ("u1A", "u2A", "u3A"):
        code, ticket = call(key, "POST", "/asset-requests", {"ticket_type": "SOFTWARE", "software_id": solo["id"], "reason": "race"})
        racers.append(ticket)
    with ThreadPoolExecutor(max_workers=3) as pool:
        results = list(pool.map(lambda t: move("adminA", t, "FULFILLED")[0], racers))
    check("three simultaneous allocations of a 1-seat license: exactly one succeeds",
          results.count(200) == 1 and all(c in (200, 400, 409) for c in results), results)
    code, d3 = call("adminA", "POST", "/assets", {"name": "Race laptop", "category": "Laptop", "serial_number": "RACE-1"})
    hw = []
    for key in ("u1A", "u2A", "u3A"):
        code, ticket = call(key, "POST", "/asset-requests", {"asset_category_id": cat["id"], "reason": "race"})
        move("adminA", ticket, "UNDER_REVIEW")
        hw.append(ticket)
    with ThreadPoolExecutor(max_workers=3) as pool:
        results = list(pool.map(lambda t: move("adminA", t, "APPROVED", reserve_asset_id=d3["id"])[0], hw))
    check("three simultaneous reservations of one device: exactly one succeeds", results.count(200) == 1, results)
else:
    print("  SKIP  concurrent allocation checks (set TICKET_DATABASE_URL to a PostgreSQL database)")

print(f"\n{sum(RESULTS)}/{len(RESULTS)} passed")
server.should_exit = True
sys.exit(0 if all(RESULTS) else 1)
