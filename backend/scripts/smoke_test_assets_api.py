"""
Smoke test for the asset, audit and warranty APIs: CRUD + assignment,
status/lifecycle events, warranty coverage and claims, audit sessions and
scans, WebSocket broadcasts and WebSocket authentication, IT Agent
sign-up and user management, departments, reports and the
IT Agent workspace (tickets, inventory, asset operations).

Runs a throwaway server on port 8765 against a temporary SQLite file, with the
logged-in user faked, so it never touches the real Postgres database or the
dev server on port 8000.

Usage (from backend/):
    .venv/bin/python scripts/smoke_test_assets_api.py
    # against PostgreSQL (empty database, migrated with `alembic upgrade head` first):
    SMOKE_DATABASE_URL=postgresql+psycopg2://... .venv/bin/python scripts/smoke_test_assets_api.py
"""
import asyncio
import json
import os
import sys
import tempfile
import threading
import time
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import uvicorn
import websockets
from fastapi import FastAPI
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.database import Base, get_db
from app.core.deps import get_current_user
from app.core.security import create_access_token
from app.models.models import AssetLifecycle, AuditSession, Company, PlatformRole, User
from app.routers import (
    asset_requests, assets, audit, auth, departments, inventory, organization, purchase_orders, reports, software,
    super_admin, users, vendors,
    warranty_maintenance, maintenance, depreciation, financial, notifications, discovery, cloud, profile,
)

PORT = 8765
BASE = f"http://127.0.0.1:{PORT}/api"
WS_BASE = f"ws://127.0.0.1:{PORT}/api"

# SMOKE_DATABASE_URL runs the checks against a real (empty, already migrated)
# database such as PostgreSQL; by default a throwaway SQLite file is used.
DATABASE_URL = os.environ.get("SMOKE_DATABASE_URL")
if DATABASE_URL:
    engine = create_engine(DATABASE_URL)
else:
    db_path = os.path.join(tempfile.mkdtemp(), "smoke.db")
    engine = create_engine(f"sqlite:///{db_path}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
TestSession = sessionmaker(bind=engine, autocommit=False, autoflush=False)

with TestSession() as db:
    company = Company(name="Smoke Co", code="SMOKE")
    db.add(company)
    db.flush()
    admin = User(email="admin@example.com", hashed_password="x", full_name="Smoke Admin",
                 role=PlatformRole.IT_ADMIN, company_id=company.id, status="ACTIVE")
    employee = User(email="emp@example.com", hashed_password="x", full_name="Smoke Employee",
                    role=PlatformRole.EMPLOYEE, company_id=company.id, status="ACTIVE")
    db.add_all([admin, employee])
    db.flush()
    session = AuditSession(company_id=company.id, title="Smoke audit", started_by=admin.id,
                           status="IN_PROGRESS")
    db.add(session)
    db.commit()
    COMPANY_ID, ADMIN_ID, EMPLOYEE_ID, SESSION_ID = company.id, admin.id, employee.id, session.id

TOKEN = create_access_token({"sub": ADMIN_ID})


def override_db():
    db = TestSession()
    try:
        yield db
    finally:
        db.close()


# Whose requests the test is making; switched to an IT Agent for the agent checks.
ACTING = {"user_id": None}


def override_user():
    with TestSession() as db:
        user = db.get(User, ACTING["user_id"] or ADMIN_ID)
        db.expunge(user)
        return user


app = FastAPI()
app.include_router(assets.router, prefix="/api")
app.include_router(audit.router, prefix="/api")
app.include_router(warranty_maintenance.router, prefix="/api")
app.include_router(users.router, prefix="/api")
app.include_router(reports.router, prefix="/api")
app.include_router(departments.router, prefix="/api")
app.include_router(auth.router, prefix="/api")
app.include_router(asset_requests.router, prefix="/api")
app.include_router(inventory.router, prefix="/api")
app.include_router(vendors.router, prefix="/api")
app.include_router(purchase_orders.router, prefix="/api")
app.include_router(software.router, prefix="/api")
app.include_router(organization.router, prefix="/api")
app.include_router(super_admin.router, prefix="/api")
app.include_router(maintenance.router, prefix="/api")
app.include_router(depreciation.router, prefix="/api")
app.include_router(financial.router, prefix="/api")
app.include_router(notifications.router, prefix="/api")
app.include_router(discovery.router, prefix="/api")
app.include_router(cloud.router, prefix="/api")
app.include_router(profile.router, prefix="/api")
app.dependency_overrides[get_db] = override_db
app.dependency_overrides[get_current_user] = override_user


def call(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method,
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req) as resp:
            return resp.status, json.loads(resp.read() or b"{}")
    except urllib.error.HTTPError as err:
        return err.code, err.read().decode()


def call_raw(path):
    req = urllib.request.Request(BASE + path)
    try:
        with urllib.request.urlopen(req) as resp:
            return resp.status, resp.headers, resp.read().decode("utf-8-sig")
    except urllib.error.HTTPError as err:
        return err.code, err.headers, err.read().decode()


async def expect_message(ws, event_key, event):
    raw = await asyncio.wait_for(ws.recv(), timeout=3)
    message = json.loads(raw)
    assert message.get("event") == event, f"expected {event}, got {message}"
    return message[event_key]


failures = []


def check(label, condition, detail=""):
    print(f"  {'PASS' if condition else 'FAIL'}  {label}" + (f"  -> {detail}" if not condition else ""))
    if not condition:
        failures.append(label)


async def ws_rejected(url):
    """True if the server refuses or closes the socket instead of keeping it open."""
    try:
        async with websockets.connect(url) as ws:
            await asyncio.wait_for(ws.recv(), timeout=2)
    except asyncio.TimeoutError:
        return False  # still open and idle: it was accepted
    except Exception:
        return True
    return False


async def run_checks():
    print("WebSocket auth")
    check("asset WS without token is rejected", await ws_rejected(f"{WS_BASE}/assets/ws/{COMPANY_ID}"))
    check("asset WS with bad token is rejected", await ws_rejected(f"{WS_BASE}/assets/ws/{COMPANY_ID}?token=bad"))
    check("asset WS for another company is rejected",
          await ws_rejected(f"{WS_BASE}/assets/ws/other-company?token={TOKEN}"))
    check("audit WS without token is rejected", await ws_rejected(f"{WS_BASE}/physical-audit/ws/{SESSION_ID}"))

    async with websockets.connect(f"{WS_BASE}/assets/ws/{COMPANY_ID}?token={TOKEN}") as ws:
        print("Assets")
        code, body = call("POST", "/assets", {"asset_tag": "SMK-1", "serial_number": "SN-1",
                                              "name": "Smoke Laptop", "category": "Laptop"})
        check("POST /assets returns 201", code == 201, body)
        asset_id = body["id"] if code == 201 else None
        if asset_id:
            msg = await expect_message(ws, "asset", "ASSET_CREATED")
            check("ASSET_CREATED broadcast received", msg["id"] == asset_id, msg)

            code, body = call("PUT", f"/assets/{asset_id}", {"status": "IN_REPAIR"})
            check("PUT /assets/{id} (status change) returns 200", code == 200, body)
            msg = await expect_message(ws, "asset", "ASSET_UPDATED")
            check("ASSET_UPDATED broadcast carries new status", msg["status"] == "IN_REPAIR", msg)

            call("PUT", f"/assets/{asset_id}", {"status": "IN_STOCK"})
            await expect_message(ws, "asset", "ASSET_UPDATED")

            code, body = call("POST", f"/assets/{asset_id}/assign", {"user_id": EMPLOYEE_ID})
            check("POST /assets/{id}/assign returns 200", code == 200, body)
            msg = await expect_message(ws, "asset", "ASSET_ASSIGNED")
            check("ASSET_ASSIGNED broadcast names the assignee",
                  msg["assigned_to_name"] == "Smoke Employee", msg)

            code, body = call("PUT", f"/assets/{asset_id}", {"condition": "GOOD"})
            check("PUT response keeps the current assignee",
                  code == 200 and body.get("assigned_to_id") == EMPLOYEE_ID, body)
            await expect_message(ws, "asset", "ASSET_UPDATED")

            code, body = call("POST", f"/assets/{asset_id}/unassign")
            check("POST /assets/{id}/unassign returns 200", code == 200, body)
            msg = await expect_message(ws, "asset", "ASSET_UNASSIGNED")
            check("ASSET_UNASSIGNED broadcast clears the assignee", msg["assigned_to_id"] is None, msg)

            code, body = call("POST", f"/assets/{asset_id}/unassign")
            check("unassigning an asset nobody holds is refused", code == 400, body)

            code, body = call("PUT", f"/assets/{asset_id}", {"status": "ASSIGNED"})
            check("PUT status=ASSIGNED is refused (use /assign)", code == 400, body)

            code, body = call("POST", f"/assets/{asset_id}/assign", {"user_id": EMPLOYEE_ID})
            await expect_message(ws, "asset", "ASSET_ASSIGNED")
            code, body = call("PUT", f"/assets/{asset_id}", {"status": "RETIRED", "status_remarks": "End of life"})
            check("PUT status=RETIRED releases the assignee",
                  code == 200 and body.get("assigned_to_id") is None and body.get("status") == "RETIRED", body)
            await expect_message(ws, "asset", "ASSET_UPDATED")
            call("PUT", f"/assets/{asset_id}", {"status": "IN_STOCK"})
            await expect_message(ws, "asset", "ASSET_UPDATED")

            code, body = call("GET", "/assets/events?limit=1")
            check("GET /assets/events returns newest with asset + user names",
                  code == 200 and body and body[0]["asset_tag"] == "SMK-1"
                  and body[0]["performed_by_name"] == "Smoke Admin", body)
            code, body = call("GET", "/assets/events?action=STATUS_CHANGE&search=SMK")
            check("events filter by action/search", code == 200 and len(body) == 4
                  and any(e["remarks"] == "End of life" for e in body), body)

            code, body = call("GET", "/assets/counts")
            check("GET /assets/counts has every status", code == 200 and body["by_status"]["IN_STOCK"] == 1
                  and "DISPOSED" in body["by_status"] and body["total"] == 1, body)

            with TestSession() as db:
                actions = [row.action for row in db.query(AssetLifecycle)
                           .filter(AssetLifecycle.asset_id == asset_id)
                           .order_by(AssetLifecycle.timestamp)]
            check("lifecycle rows written", actions == ["CREATED", "STATUS_CHANGE", "STATUS_CHANGE",
                                                        "ASSIGNED", "UNASSIGNED", "ASSIGNED",
                                                        "STATUS_CHANGE", "STATUS_CHANGE"], actions)

            print("Warranty")
            code, body = call("GET", "/warranty-maintenance/coverage")
            check("coverage lists asset with NONE", code == 200 and body and body[0]["coverage"] == "NONE", body)
            call("PUT", f"/assets/{asset_id}", {"warranty_end": "2099-01-01T00:00:00"})
            await expect_message(ws, "asset", "ASSET_UPDATED")
            code, body = call("GET", "/warranty-maintenance/coverage?coverage=ACTIVE")
            check("coverage filter ACTIVE", code == 200 and len(body) == 1 and body[0]["days_remaining"] > 0, body)
            code, body = call("POST", "/warranty-maintenance/claims",
                              {"asset_id": asset_id, "issue_description": "Screen flicker", "claim_number": "C-1"})
            check("POST claim returns 201", code == 201 and body.get("status") == "SUBMITTED"
                  and body.get("asset_tag") == "SMK-1", body)
            claim_id = body.get("id") if code == 201 else ""
            code, body = call("PUT", f"/warranty-maintenance/claims/{claim_id}", {"status": "APPROVED"})
            check("PUT claim status", code == 200 and body.get("status") == "APPROVED", body)
            code, body = call("PUT", f"/warranty-maintenance/claims/{claim_id}", {"status": "BOGUS"})
            check("PUT claim with invalid status is 422", code == 422, body)
            code, body = call("GET", "/warranty-maintenance/claims")
            check("GET claims lists it", code == 200 and len(body) == 1, body)

    async with websockets.connect(f"{WS_BASE}/physical-audit/ws/{SESSION_ID}?token={TOKEN}") as ws:
        print("Audit scan")
        code, body = call("POST", f"/physical-audit/sessions/{SESSION_ID}/scan", {"asset_tag": "SMK-1"})
        check("POST scan (known tag) returns 200 VERIFIED",
              code == 200 and body.get("status") == "VERIFIED", body)
        msg = await expect_message(ws, "scan", "SCAN_UPDATE")
        check("SCAN_UPDATE broadcast received", msg["scanned_tag"] == "SMK-1" and msg["is_verified"], msg)

        code, body = call("POST", f"/physical-audit/sessions/{SESSION_ID}/scan", {"asset_tag": "NOPE"})
        check("POST scan (unknown tag) returns 200 UNRECOGNIZED_TAG",
              code == 200 and body.get("status") == "UNRECOGNIZED_TAG", body)
        msg = await expect_message(ws, "scan", "SCAN_UPDATE")
        check("SCAN_UPDATE broadcast for exception", msg["is_verified"] is False, msg)

    print("IT Agent sign-up and user management")
    code, body = call("POST", "/auth/register",
                      {"name": "Rahul Sharma", "email": "Rahul@Example.com", "password": "password123", "role": "IT_AGENT"})
    check("IT Agent signs up with name/email/password only, no organization",
          code == 200 and body.get("access_token") and body.get("company_id") is None, body)
    with TestSession() as db:
        rahul = db.query(User).filter(User.email == "rahul@example.com").first()
        check("account is an IT Agent with an auto Agent ID and no company",
              rahul is not None and rahul.role == PlatformRole.EMPLOYEE and rahul.company_id is None
              and rahul.agent_id == "RAHULSHARMA01")
        rahul_id = rahul.id if rahul else ""

    code, body = call("POST", "/auth/login",
                      {"email": "rahul@example.com", "password": "password123", "role": "IT_AGENT"})
    check("IT Agent can log in choosing the IT Agent role, and gets role IT_AGENT back",
          code == 200 and body.get("access_token") and body.get("role") == "IT_AGENT", body)

    code, body = call("POST", "/auth/register",
                      {"name": "Rahul Again", "email": "RAHUL@example.com", "password": "password123", "role": "IT_AGENT"})
    check("same email in another case is refused", code == 400, body)

    code, body = call("GET", "/users/unassigned")
    check("admin sees the new sign-up under unassigned agents",
          code == 200 and any(u["id"] == rahul_id for u in body), body)
    code, body = call("GET", "/users")
    check("unassigned agent is not in the organization list yet",
          code == 200 and all(u["id"] != rahul_id for u in body), body)

    code, body = call("POST", f"/users/{rahul_id}/add-to-organization")
    check("admin adds the agent to the organization", code == 200 and body.get("company_id") == COMPANY_ID, body)
    code, body = call("POST", f"/users/{rahul_id}/add-to-organization")
    check("adding twice is refused", code == 400, body)
    code, body = call("GET", "/users")
    check("agent now listed in the organization with Agent ID",
          code == 200 and any(u["id"] == rahul_id and u["agent_id"] == "RAHULSHARMA01" for u in body), body)

    code, body = call("POST", "/users", {"email": "neha@example.com", "full_name": "Neha Verma",
                                         "password": "password123", "role": "EMPLOYEE"})
    check("admin creates an IT Agent from the dashboard (gets an Agent ID)",
          code == 201 and body.get("agent_id") == "NEHAVERMA01" and body.get("company_id") == COMPANY_ID, body)
    neha_id = body.get("id", "")

    code, body = call("DELETE", f"/users/{neha_id}")
    check("admin removes a user (deactivated)", code == 204, body)
    with TestSession() as db:
        check("removed user is INACTIVE", db.get(User, neha_id).status == "INACTIVE")
    code, body = call("POST", f"/users/{neha_id}/reactivate")
    check("admin reactivates the user", code == 200 and body.get("status") == "ACTIVE", body)

    code, body = call("DELETE", f"/users/{ADMIN_ID}")
    check("admin cannot remove themselves", code == 400, body)

    print("Reports")
    code, body = call("GET", "/reports/types")
    type_keys = [t["key"] for t in body] if code == 200 else []
    check("GET /reports/types lists the six report types", code == 200 and len(type_keys) == 6, body)

    for key in type_keys:
        code, body = call("POST", "/reports/runs", {"report_type": key})
        check(f"generate {key}", code == 201 and body.get("format") == "CSV", body)

    code, body = call("POST", "/reports/runs", {
        "report_type": "asset_inventory", "name": "In-stock laptops",
        "filters": {"status": "IN_STOCK", "category": "Laptop", "date_from": "ignored-for-this-type"},
        "save": True})
    check("filtered inventory report counts 1 row and is saved",
          code == 201 and body.get("row_count") == 1 and body.get("report_config_id")
          and body.get("filters") == {"status": "IN_STOCK", "category": "Laptop"}
          and body.get("generated_by_name") == "Smoke Admin", body)
    run_id, config_id = body.get("id", ""), body.get("report_config_id", "")

    code, headers, text = call_raw(f"/reports/runs/{run_id}/download")
    lines = text.strip().splitlines()
    check("download returns the CSV with header + 1 row",
          code == 200 and "text/csv" in headers.get("content-type", "") and lines[0].startswith("Asset tag,Name")
          and len(lines) == 2 and "SMK-1" in lines[1], text[:300])
    check("download names the file", "in-stock-laptops-" in headers.get("content-disposition", ""),
          headers.get("content-disposition"))

    code, body = call("POST", "/reports/runs", {"report_type": "asset_inventory", "filters": {"status": "BOGUS"}})
    check("invalid filter value is 422", code == 422, body)
    code, body = call("POST", "/reports/runs", {"report_type": "nope"})
    check("unknown report type is 400", code == 400, body)

    code, body = call("GET", "/reports/saved")
    check("saved report listed with last run time",
          code == 200 and len(body) == 1 and body[0]["id"] == config_id and body[0]["last_run_at"], body)
    code, body = call("POST", f"/reports/saved/{config_id}/run")
    check("re-run saved report", code == 201 and body.get("report_config_id") == config_id, body)

    code, body = call("GET", "/reports/runs?limit=3")
    check("recent runs newest first", code == 200 and len(body) == 3 and body[0]["report_config_id"] == config_id, body)
    code, body = call("GET", "/reports/summary")
    check("summary counts runs and saved reports",
          code == 200 and body.get("generated_this_month") == 8 and body.get("saved_reports") == 1, body)

    code, body = call("DELETE", f"/reports/saved/{config_id}")
    check("delete saved report", code == 204, body)
    code, _, _ = call_raw(f"/reports/runs/{run_id}/download")
    check("its generated report is still downloadable", code == 200)

    code, body = call("GET", "/reports/runs/does-not-exist/download")
    check("unknown report download is 404", code == 404, body)

    print("Departments")
    code, body = call("POST", "/departments", {"name": "  Engineering ", "department_head": "Priya"})
    check("create department (name trimmed)", code == 201 and body.get("name") == "Engineering", body)
    dept_id = body.get("id", "")
    code, body = call("POST", "/departments", {"name": "engineering"})
    check("duplicate name (any case) is refused", code == 400, body)
    code, body = call("GET", "/departments")
    check("list shows the department with counts",
          code == 200 and len(body) == 1 and body[0]["user_count"] == 0 and body[0]["asset_count"] == 0, body)
    code, body = call("PUT", f"/assets/{asset_id}", {"department_id": dept_id}) if asset_id else (0, {})
    code, body = call("GET", "/departments")
    check("asset count reflects an asset moved into it", code == 200 and body[0]["asset_count"] == 1, body)
    code, body = call("POST", "/reports/runs", {"report_type": "asset_inventory", "filters": {"department_id": dept_id}})
    check("inventory report filtered by department", code == 201 and body.get("row_count") == 1, body)
    code, body = call("DELETE", f"/departments/{dept_id}")
    check("deleting a department in use is refused with 409", code == 409 and "asset" in str(body), body)

    print("Audit sessions")
    code, body = call("POST", "/physical-audit/sessions", {"title": "Second audit"})
    check("POST /physical-audit/sessions returns 201", code == 201 and "session_id" in body, body)

    code, body = call("GET", "/physical-audit/sessions")
    check("GET /physical-audit/sessions returns 200 with both sessions", code == 200 and len(body) == 2, body)
    if code == 200:
        smoke = next(s for s in body if s["id"] == SESSION_ID)
        check("list counts verified/exceptions", (smoke["verified_count"], smoke["exception_count"]) == (1, 1), smoke)

    code, body = call("GET", f"/physical-audit/sessions/{SESSION_ID}")
    check("GET /physical-audit/sessions/{id} returns 200", code == 200 and body.get("id") == SESSION_ID, body)

    code, body = call("GET", f"/physical-audit/sessions/{SESSION_ID}/scans")
    check("GET .../scans returns both scans", code == 200 and sorted(s["scanned_tag"] for s in body) == ["NOPE", "SMK-1"], body)

    code, body = call("POST", f"/physical-audit/sessions/{SESSION_ID}/complete")
    check("POST .../complete returns 200 with completed_at",
          code == 200 and body.get("status") == "COMPLETED" and body.get("completed_at"), body)

    code, body = call("GET", "/physical-audit/sessions/does-not-exist")
    check("GET unknown session returns 404", code == 404, body)

    print("IT Agent workspace")
    # Admin sets up a category, an in-stock asset and an inventory item.
    code, body = call("POST", "/assets/categories", {"name": "Laptops"})
    category_id = body.get("id", "")
    code, body = call("POST", "/assets", {"asset_tag": "AGT-1", "serial_number": "SN-AGT-1",
                                          "name": "Agent Laptop", "category": "Laptop"})
    stock_asset_id = body.get("id", "")
    code, body = call("POST", "/inventory", {"name": "USB-C cable", "category": "Cables",
                                             "quantity": 5, "reorder_level": 3})
    item_id = body.get("id", "")

    ACTING["user_id"] = rahul_id  # an IT Agent in the organization from here on
    try:
        code, body = call("POST", "/assets/categories", {"name": " Monitors "})
        check("agent adds an asset category (name trimmed)", code == 201 and body.get("name") == "Monitors", body)
        code, body = call("POST", "/assets/categories", {"name": "laptops"})
        check("duplicate category name (any case) is refused", code == 400, body)
        code, body = call("POST", "/asset-requests", {"asset_category_id": "", "reason": "x"})
        check("ticket without a valid category is refused", code == 400, body)

        ACTING["user_id"] = None
        code, body = call("POST", "/departments", {"name": "Support"})
        support_dept = body.get("id", "")
        ACTING["user_id"] = rahul_id
        code, body = call("POST", "/asset-requests", {"asset_category_id": category_id,
                                                      "requested_for_user_id": neha_id,
                                                      "department_id": support_dept,
                                                      "reason": "New joiner needs a laptop"})
        check("ticket records its department", code == 201 and body.get("department_name") == "Support", body)
        check("agent raises a ticket on behalf of a user (recorded as raised by the agent)",
              code == 201 and body.get("requested_by") == neha_id and body.get("raised_by") == rahul_id
              and body.get("category_name") == "Laptops"
              and body.get("requested_by_name") == "Neha Verma", body)
        ticket_id = body.get("id", "")
        code, body = call("POST", "/asset-requests", {"asset_category_id": category_id, "reason": "Spare"})
        reject_id = body.get("id", "")

        code, body = call("GET", "/asset-requests?status=PENDING")
        check("agent sees the company ticket queue, filtered by status",
              code == 200 and {t["id"] for t in body} >= {ticket_id, reject_id}
              and all(t["status"] == "PENDING" for t in body), body)

        code, body = call("PUT", f"/asset-requests/{ticket_id}", {"status": "APPROVED", "assigned_asset_id": stock_asset_id})
        check("agent approves a ticket, assigning an in-stock asset to the requester",
              code == 200 and body.get("status") == "APPROVED" and body.get("assigned_asset_tag") == "AGT-1", body)
        code, body = call("GET", f"/assets/{stock_asset_id}")
        check("approved asset is now with that user",
              code == 200 and body.get("status") == "ASSIGNED" and body.get("assigned_to_id") == neha_id, body)

        code, body = call("PUT", f"/asset-requests/{reject_id}", {"status": "REJECTED", "rejection_reason": "No budget"})
        check("agent rejects a ticket with a reason",
              code == 200 and body.get("status") == "REJECTED" and body.get("rejection_reason") == "No budget", body)

        code, body = call("POST", f"/assets/{stock_asset_id}/unassign")
        check("agent unassigns an asset", code == 200 and body.get("status") == "IN_STOCK", body)
        code, body = call("POST", f"/assets/{stock_asset_id}/assign", {"user_id": neha_id})
        check("agent assigns an asset to a user", code == 200 and body.get("assigned_to_id") == neha_id, body)

        code, body = call("PUT", f"/assets/{stock_asset_id}", {"status": "IN_REPAIR", "status_remarks": "Keyboard"})
        check("agent changes asset status", code == 200 and body.get("status") == "IN_REPAIR", body)
        code, body = call("PUT", f"/assets/{stock_asset_id}", {"purchase_price": "1"})
        check("agent cannot edit asset purchase details (403)", code == 403, body)
        code, body = call("POST", "/assets", {"asset_tag": "AGT-2", "serial_number": "SN-AGT-2",
                                              "name": "Nope", "category": "Laptop"})
        check("agent cannot register assets (403)", code == 403, body)

        code, body = call("POST", f"/inventory/{item_id}/adjust", {"change": -2, "reason": "Issued to Neha"})
        check("agent issues stock; status turns LOW_STOCK at reorder level",
              code == 200 and body.get("quantity") == 3 and body.get("status") == "LOW_STOCK", body)
        code, body = call("POST", f"/inventory/{item_id}/adjust", {"change": -10, "reason": "Too many"})
        check("issuing more than in stock is refused", code == 400, body)
        code, body = call("POST", f"/inventory/{item_id}/adjust", {"change": 10, "reason": "Delivery"})
        check("agent receives stock", code == 200 and body.get("quantity") == 13 and body.get("status") == "IN_STOCK", body)
        code, body = call("PUT", f"/inventory/{item_id}", {"reorder_level": 1})
        check("agent cannot edit inventory settings (403)", code == 403, body)

        code, body = call("POST", "/reports/runs", {"report_type": "asset_inventory"})
        check("agent generates a report", code == 201, body)

        code, body = call("GET", "/users")
        check("agent cannot read full user records (403)", code == 403, body)
        code, body = call("GET", "/users/directory")
        check("agent gets a names-only directory (no emails or roles)",
              code == 200 and len(body) >= 3 and all(set(u) == {"id", "full_name", "department_id"} for u in body), body)
        code, body = call("DELETE", f"/users/{neha_id}")
        check("agent cannot remove users (403)", code == 403, body)

        code, body = call("POST", "/auth/change-password", {"current_password": "wrong-pass", "new_password": "newpassword1"})
        check("change password with wrong current password is refused", code == 400, body)
        code, body = call("POST", "/auth/change-password", {"current_password": "password123", "new_password": "newpassword1"})
        check("agent changes their password", code == 200, body)
        code, body = call("POST", "/auth/login", {"email": "rahul@example.com", "password": "newpassword1", "role": "IT_AGENT"})
        check("new password works for login", code == 200 and body.get("role") == "IT_AGENT", body)
    finally:
        ACTING["user_id"] = None

    print("Admin reviews an IT Agent's work")
    code, body = call("GET", f"/users/{rahul_id}/activity")
    summary = body.get("summary", {}) if code == 200 else {}
    check("activity summary counts the agent's work",
          code == 200 and summary.get("tickets_raised") == 2 and summary.get("tickets_approved") == 1
          and summary.get("tickets_rejected") == 1 and summary.get("assets_assigned") == 1
          and summary.get("assets_unassigned") == 1 and summary.get("stock_adjustments") == 2
          and summary.get("reports_generated") == 1, summary)
    actions = [entry["action"] for entry in body.get("recent", [])]
    check("activity feed lists their actions newest first",
          code == 200 and actions[:1] == ["CHANGE_PASSWORD"] and "PROCESS_ASSET_REQUEST" in actions
          and "USER_LOGIN" not in actions, actions)
    code, body = call("GET", f"/asset-requests?processed_by={rahul_id}")
    check("tickets processed by the agent, with processor name",
          code == 200 and len(body) == 2 and all(t["processed_by_name"] == "Rahul Sharma" for t in body), body)
    ACTING["user_id"] = rahul_id
    call("POST", "/asset-requests", {"asset_category_id": category_id, "reason": "Second monitor"})
    ACTING["user_id"] = None
    code, body = call("GET", f"/asset-requests?raised_by={rahul_id}&status=PENDING")
    pending_by_agent = body if code == 200 else []
    check("pending tickets raised by the agent", code == 200 and len(pending_by_agent) == 1, body)
    code, body = call("PUT", f"/asset-requests/{pending_by_agent[0]['id']}",
                      {"status": "REJECTED", "rejection_reason": "Reviewed by admin"}) if pending_by_agent else (0, {})
    check("admin changes the agent's pending ticket status",
          code == 200 and body.get("status") == "REJECTED" and body.get("processed_by_name") == "Smoke Admin", body)
    code, body = call("GET", f"/assets?assigned_to={neha_id}")
    check("assets a user holds", code == 200 and [a["asset_tag"] for a in body] == ["AGT-1"], body)
    ACTING["user_id"] = rahul_id
    code, body = call("GET", f"/users/{neha_id}/activity")
    ACTING["user_id"] = None
    check("an IT Agent cannot review other users' activity (403)", code == 403, body)

    print("Procurement and software")
    code, body = call("POST", "/vendors", {"name": "Dell India", "contact": "Asha", "email": "sales@dell.example.com"})
    check("create vendor", code == 201 and body.get("contact") == "Asha", body)
    vendor_id = body.get("id", "")
    code, body = call("GET", "/vendors")
    check("list vendors", code == 200 and len(body) == 1, body)
    code, body = call("PUT", f"/vendors/{vendor_id}", {"phone": "+91 80 1234"})
    check("update vendor", code == 200 and body.get("phone") == "+91 80 1234", body)

    code, body = call("POST", "/purchase-orders", {"po_number": "PO-001", "vendor_id": vendor_id, "total_amount": "125000"})
    check("create purchase order (PENDING, with vendor name)",
          code == 201 and body.get("status") == "PENDING" and body.get("vendor_name") == "Dell India", body)
    po_id = body.get("id", "")
    code, body = call("POST", "/purchase-orders", {"po_number": "PO-001", "vendor_id": vendor_id, "total_amount": "1"})
    check("duplicate PO number is refused", code == 400, body)
    code, body = call("PUT", f"/purchase-orders/{po_id}/status", {"status": "RECEIVED"})
    check("PO cannot skip from PENDING to RECEIVED", code == 400, body)
    code, body = call("PUT", f"/purchase-orders/{po_id}/status", {"status": "ORDERED"})
    check("PO moves to ORDERED", code == 200 and body.get("status") == "ORDERED", body)
    code, body = call("GET", "/purchase-orders")
    check("list purchase orders", code == 200 and len(body) == 1 and body[0]["status"] == "ORDERED", body)

    code, body = call("POST", "/software", {"name": "Microsoft 365", "vendor": "Microsoft", "total_licenses": 2})
    check("create software", code == 201 and body.get("used_licenses") == 0, body)
    sw_id = body.get("id", "")
    code, body = call("POST", f"/software/{sw_id}/assign", {"user_id": neha_id})
    check("assign a license", code == 201, body)
    code, body = call("GET", "/software")
    check("license usage is counted", code == 200 and body[0]["used_licenses"] == 1, body)

    print("Maintenance, depreciation and finance")
    code, body = call("POST", "/assets", {"asset_tag": "MNT-1", "serial_number": "SN-MNT-1", "name": "Repair Laptop",
                                          "category": "Laptop", "purchase_price": "120000",
                                          "purchase_date": "2024-01-01T00:00:00"})
    mnt_asset = body.get("id", "")
    call("POST", f"/assets/{mnt_asset}/assign", {"user_id": neha_id})
    code, body = call("POST", "/maintenance", {"asset_id": mnt_asset, "issue": "Battery swelling", "vendor_id": vendor_id, "cost": "4500"})
    check("log maintenance (asset moves to IN_REPAIR, names attached)",
          code == 201 and body.get("asset_tag") == "MNT-1" and body.get("vendor_name") == "Dell India", body)
    mnt_id = body.get("id", "")
    code, body = call("GET", f"/assets/{mnt_asset}")
    check("asset is IN_REPAIR during maintenance", code == 200 and body.get("status") == "IN_REPAIR", body)
    code, body = call("POST", "/maintenance", {"asset_id": mnt_asset, "issue": "Again"})
    check("second open maintenance on the same asset is refused", code == 400, body)
    code, body = call("PUT", f"/maintenance/{mnt_id}", {"status": "COMPLETED"})
    check("complete maintenance", code == 200 and body.get("status") == "COMPLETED" and body.get("completion_date"), body)
    code, body = call("GET", f"/assets/{mnt_asset}")
    check("asset returns to its holder (ASSIGNED) after repair",
          code == 200 and body.get("status") == "ASSIGNED" and body.get("assigned_to_id") == neha_id, body)
    code, body = call("GET", "/maintenance?status=COMPLETED")
    check("list maintenance by status", code == 200 and len(body) == 1, body)

    code, body = call("POST", f"/depreciation/calculate/{mnt_asset}", {"method": "STRAIGHT_LINE", "useful_life_years": 4})
    check("calculate depreciation (saves the method and book value)",
          code == 200 and 0 < body.get("current_value", 0) < 120000 and body.get("method") == "STRAIGHT_LINE", body)
    code, body = call("GET", "/financial/summary")
    check("financial summary includes the depreciated asset",
          code == 200 and body.get("total_asset_cost", 0) >= 120000 and body.get("accumulated_depreciation", 0) > 0, body)
    code, body = call("GET", "/financial/department-breakdown")
    check("department breakdown", code == 200 and isinstance(body, list), body)

    print("Notifications")
    code, body = call("GET", "/notifications?limit=100")
    titles = [n["title"] for n in body] if code == 200 else []
    check("admin is notified of tickets raised by others and of low stock",
          any(t.startswith("New ticket from") for t in titles) and any("running low" in t for t in titles), titles)
    code, body = call("GET", "/notifications/unread-count")
    unread = body.get("unread", 0) if code == 200 else 0
    check("unread count", code == 200 and unread >= 2, body)
    code, body = call("PUT", "/notifications/read-all")
    code, body = call("GET", "/notifications/unread-count")
    check("mark all read", code == 200 and body.get("unread") == 0, body)
    ACTING["user_id"] = neha_id
    code, body = call("GET", "/notifications")
    ACTING["user_id"] = None
    neha_titles = [n["title"] for n in body] if code == 200 else []
    check("requester is told the ticket was approved and the asset assigned (link to their workspace)",
          "Your ticket was approved" in neha_titles and any("was assigned to you" in t for t in neha_titles)
          and body[0]["link"] in ("/agent/assets", "/agent/tickets"), body[:3])
    ACTING["user_id"] = rahul_id
    code, body = call("GET", "/notifications?limit=100")
    ACTING["user_id"] = None
    check("agent is told they were added to the organization",
          code == 200 and any(n["title"].startswith("You've been added to") for n in body), [n["title"] for n in body])
    code, body = call("PUT", "/notifications/does-not-exist/read")
    check("cannot touch another user's / unknown notification (404)", code == 404, body)

    print("Discovery and cloud")
    code, body = call("POST", "/discovery/agent-ingest", {"hostname": "FIN-PC-07", "ip_address": "10.0.4.7",
                                                          "mac_address": "AA:BB:CC:00:11:22", "os_name": "Windows 11",
                                                          "cpu_model": "i5-1345U", "ram_gb": 16, "serial_number": "DISC-SN-7"})
    check("ingest a discovered device", code == 201 and body.get("status") == "UNMANAGED", body)
    dev_id = body.get("device_id", "")
    call("POST", "/discovery/agent-ingest", {"hostname": "FIN-PC-07b", "ip_address": "10.0.4.8", "mac_address": "aa:bb:cc:00:11:22"})
    code, body = call("GET", "/discovery/unmanaged")
    check("re-ingesting the same MAC updates the device (with OS / CPU kept)",
          code == 200 and len(body) == 1 and body[0]["hostname"] == "FIN-PC-07b" and body[0]["os_name"] == "Windows 11", body)
    code, body = call("POST", f"/discovery/reconcile/{dev_id}", {"asset_tag": "DSC-1", "category": "Desktop"})
    check("promote discovered device to an asset", code == 200 and body.get("asset_id"), body)
    code, body = call("GET", f"/assets/{body.get('asset_id', 'x')}")
    check("promoted asset has category, serial and specs",
          code == 200 and body.get("category") == "Desktop" and body.get("serial_number") == "DISC-SN-7"
          and "Windows 11" in (body.get("description") or ""), body)
    code, body = call("POST", f"/discovery/reconcile/{dev_id}", {"asset_tag": "DSC-2", "category": "Desktop"})
    check("cannot promote the same device twice", code == 400, body)
    code, body = call("POST", "/discovery/agent-ingest", {"hostname": "guest-phone", "ip_address": "10.0.9.9", "mac_address": "de:ad:be:ef:00:01"})
    code, body = call("POST", f"/discovery/devices/{body.get('device_id')}/ignore")
    check("ignore a device", code == 200 and body.get("status") == "IGNORED", body)
    code, body = call("GET", "/discovery/devices")
    check("list all devices with status", code == 200 and {d["status"] for d in body} == {"MANAGED", "IGNORED"}, body)

    code, body = call("POST", "/cloud/resources", {"provider": "AWS", "account_id": "1234", "resource_id": "i-0abc",
                                                   "resource_type": "EC2", "region": "ap-south-1", "monthly_cost": "4200"})
    check("register a cloud resource", code == 201 and body.get("provider") == "AWS", body)
    cloud_id = body.get("id", "")
    code, body = call("POST", "/cloud/resources", {"provider": "AWS", "account_id": "1234", "resource_id": "i-0abc",
                                                   "resource_type": "EC2"})
    check("same cloud resource cannot be tracked twice", code == 400, body)
    code, body = call("PUT", f"/cloud/resources/{cloud_id}", {"status": "STOPPED", "monthly_cost": "0"})
    check("update cloud resource status", code == 200 and body.get("status") == "STOPPED", body)
    code, body = call("GET", "/cloud/resources")
    check("list cloud resources", code == 200 and len(body) == 1, body)

    print("Password reset without email")
    from app.core import rate_limit
    rate_limit._hits.clear()
    code, body = call("POST", "/auth/forgot-password", {"email": "neha@example.com"})
    check("forgot password answers generically", code == 200 and "administrator" in body.get("message", ""), body)
    code, body = call("POST", "/auth/forgot-password", {"email": "nobody-here@example.com"})
    check("same answer for unknown email (no account enumeration)", code == 200, body)
    code, body = call("GET", "/notifications?limit=5")
    check("IT Admin is notified of the reset request, linked to the user",
          code == 200 and body and body[0]["title"] == "Neha Verma asked for a password reset"
          and body[0]["link"] == f"/users/{neha_id}", body[:1])
    code, body = call("POST", f"/users/{neha_id}/reset-password", {"new_password": "temporary123"})
    check("admin sets a temporary password", code == 200, body)
    code, body = call("POST", "/auth/login", {"email": "neha@example.com", "password": "temporary123", "role": "IT_AGENT"})
    check("user signs in with the temporary password", code == 200, body)
    ACTING["user_id"] = rahul_id
    code, body = call("POST", f"/users/{neha_id}/reset-password", {"new_password": "hijacked123"})
    ACTING["user_id"] = None
    check("an IT Agent cannot reset passwords (403)", code == 403, body)

    print("Profile")
    code, body = call("GET", "/profile")
    check("profile with organization, member since", code == 200 and body["user"]["companyName"] and body["user"]["memberSince"], body)
    code, body = call("PUT", "/profile", {"name": "Smoke Admin", "location": "Bengaluru HQ"})
    check("update own name and location", code == 200 and body["user"]["location"] == "Bengaluru HQ", body)
    code, body = call("PUT", "/profile", {"name": "X"})
    check("too-short name refused", code == 422, body)
    code, body = call("GET", "/profile/activity?limit=5")
    check("own activity, newest first", code == 200 and body and body[0]["action"] == "UPDATE_PROFILE", body[:2])
    ACTING["user_id"] = rahul_id
    code, body = call("GET", "/profile")
    ACTING["user_id"] = None
    check("agent profile has Agent ID and previous sign-in", code == 200 and body["user"]["agentId"] == "RAHULSHARMA01"
          and body["user"]["previousLoginAt"], body)

    print("Organization settings")
    code, body = call("GET", "/organization")
    check("organization profile with real headcount by role",
          code == 200 and body.get("name") == "Smoke Co" and body.get("users_by_role", {}).get("IT_AGENT", 0) >= 2
          and body.get("users_by_role", {}).get("IT_ADMIN") == 1, body)
    code, body = call("PUT", "/organization", {"name": "Smoke Company Ltd"})
    check("rename organization", code == 200 and body.get("name") == "Smoke Company Ltd", body)
    ACTING["user_id"] = rahul_id
    code, body = call("GET", "/organization")
    ACTING["user_id"] = None
    check("IT Agents cannot open organization settings (403)", code == 403, body)

    print("Super Admin key")
    code, body = call("GET", "/auth/super-admin-key")
    check("no Super Admin key exists yet", code == 200 and body == {"exists": False}, body)
    def register_super(email, key, confirm=None):
        return call("POST", "/auth/register", {"name": "Super Person", "email": email, "password": "password123",
                                               "role": "SUPER_ADMIN", "registrationKey": key,
                                               "registrationKeyConfirm": confirm})
    code, body = register_super("sa1@example.com", "short", "short")
    check("first Super Admin must create a key of 8+ characters", code == 400, body)
    code, body = register_super("sa1@example.com", "my-platform-key", "different-key")
    check("mismatched key confirmation is refused", code == 400 and "match" in str(body), body)
    code, body = register_super("sa1@example.com", "my-platform-key", "my-platform-key")
    check("first Super Admin registers and creates the key", code == 200 and body.get("role") == "SUPER_ADMIN", body)
    code, body = call("GET", "/auth/super-admin-key")
    check("key now exists (value never returned)", code == 200 and body == {"exists": True}, body)
    with TestSession() as db:
        from app.models.models import PlatformSetting
        stored = db.get(PlatformSetting, "super_admin_key_hash").value
    check("only a hash of the key is stored", "my-platform-key" not in stored and stored.startswith("$2"), stored[:10])
    code, body = register_super("sa2@example.com", "wrong-key-123")
    check("later Super Admin with the wrong key is refused", code == 400, body)
    code, body = register_super("sa2@example.com", "my-platform-key")
    check("later Super Admin with the right key registers", code == 200, body)
    code, body = call("PUT", "/auth/super-admin-key", {"current_key": "my-platform-key", "new_key": "another-key-99"})
    check("an IT Admin cannot change the Super Admin key (403)", code == 403, body)

    print("Super Admin workspace")
    with TestSession() as db:
        boss = db.query(User).filter(User.email == "sa1@example.com").first()
        boss_id = boss.id
    code, body = call("GET", "/super-admin/overview")
    check("IT Admin cannot open the Super Admin overview (403)", code == 403, body)
    ACTING["user_id"] = boss_id
    try:
        code, body = call("GET", "/super-admin/overview")
        check("overview has real counts",
              code == 200 and body.get("companies_total", 0) >= 2 and body.get("users_by_role", {}).get("IT_AGENT", 0) >= 2
              and "plans" in body, body)
        code, body = call("POST", "/super-admin/companies", {
            "name": "Orbit Logistics", "plan": "STARTER", "user_limit": 3, "asset_limit": 50,
            "admin_name": "Orbit Admin", "admin_email": "it@orbit.example.com", "admin_password": "password123"})
        check("create company with its first IT Admin",
              code == 201 and body.get("primary_admin", {}).get("email") == "it@orbit.example.com"
              and body.get("subscription", {}).get("plan") == "STARTER" and body.get("code", "").startswith("ORBITLOGIS"), body)
        orbit_id = body.get("id", "")
        code, body = call("POST", "/super-admin/companies", {"name": "orbit logistics"})
        check("duplicate company name refused", code == 400, body)
        code, body = call("GET", "/super-admin/companies?search=orbit")
        check("search companies", code == 200 and len(body) == 1 and body[0]["active_users"] == 1, body)

        code, body = call("PUT", f"/super-admin/subscriptions/{orbit_id}", {"plan": "BUSINESS", "user_limit": 10})
        check("edit subscription", code == 200 and body["subscription"]["plan"] == "BUSINESS"
              and body["subscription"]["user_limit"] == 10, body)

        code, body = call("PUT", f"/super-admin/companies/{orbit_id}", {"status": "SUSPENDED"})
        check("suspend company", code == 200 and body.get("status") == "SUSPENDED", body)
        code, body = call("POST", "/auth/login", {"email": "it@orbit.example.com", "password": "password123"})
        check("users of a suspended company cannot sign in (403)", code == 403 and "suspended" in str(body), body)
        call("PUT", f"/super-admin/companies/{orbit_id}", {"status": "ACTIVE"})
        code, body = call("POST", "/auth/login", {"email": "it@orbit.example.com", "password": "password123"})
        check("reactivated company can sign in again", code == 200, body)

        code, body = call("GET", "/super-admin/admins")
        check("list Super Admins", code == 200 and len(body) == 2, body)
        code, body = call("POST", "/super-admin/admins", {"name": "Third Admin", "email": "sa3@example.com", "password": "password123"})
        check("add a Super Admin", code == 201 and body.get("role") == "SUPER_ADMIN", body)
        third_id = body.get("id", "")
        code, body = call("POST", f"/super-admin/admins/{third_id}/deactivate")
        check("deactivate a Super Admin", code == 200 and body.get("status") == "INACTIVE", body)
        code, body = call("POST", f"/super-admin/admins/{boss_id}/deactivate")
        check("cannot deactivate yourself", code == 400, body)

        code, body = call("GET", "/super-admin/audit-logs?search=Orbit")
        check("platform audit log with names",
              code == 200 and any(e["action"] == "CREATE_COMPANY_TENANT" and e["user_name"] == "Super Person" for e in body), body)
        code, body = call("GET", "/super-admin/audit-actions")
        check("audit action list", code == 200 and "UPDATE_SUBSCRIPTION" in body, body)

        code, body = call("PUT", "/super-admin/settings", {"plan": "TRIAL", "user_limit": 5, "asset_limit": 25})
        check("set provisioning defaults", code == 200 and body.get("plan") == "TRIAL", body)
    finally:
        ACTING["user_id"] = None
    code, body = call("POST", "/auth/register", {"name": "Trial Admin", "email": "trial@example.com",
                                                 "password": "password123", "role": "IT_ADMIN"})
    with TestSession() as db:
        from app.models.models import Subscription
        sub = db.query(Subscription).filter(Subscription.company_id == body.get("company_id")).first()
    check("new IT Admin sign-up gets the platform default plan", sub is not None and sub.plan == "TRIAL" and sub.user_limit == 5)

    print("Sign-in rate limit")
    from app.core.config import settings as app_settings
    saved_limit = app_settings.AUTH_RATE_LIMIT_PER_MINUTE
    app_settings.AUTH_RATE_LIMIT_PER_MINUTE = 3
    from app.core import rate_limit
    rate_limit._hits.clear()  # earlier sign-ins in this run are still inside the window
    try:
        codes = [call("POST", "/auth/login", {"email": "nobody@example.com", "password": "wrongpass1",
                                              "role": "IT_ADMIN"}, )[0] for _ in range(4)]
    finally:
        app_settings.AUTH_RATE_LIMIT_PER_MINUTE = saved_limit
    check("4th sign-in attempt in a minute from one address is refused (429)", codes == [401, 401, 401, 429], codes)

    print("New organization starter data")
    code, body = call("POST", "/auth/register", {"name": "Fresh Admin", "email": "fresh@example.com",
                                                 "password": "password123", "role": "IT_ADMIN"})
    fresh_company = body.get("company_id")
    with TestSession() as db:
        from app.models.models import AssetCategory, Department
        cats = db.query(AssetCategory).filter(AssetCategory.company_id == fresh_company).count()
        depts = db.query(Department).filter(Department.company_id == fresh_company).count()
    check("a new IT Admin organization starts with categories and departments",
          code == 200 and cats == 10 and depts == 8, (cats, depts))

    print("More notifications")
    def titles_for(user_id=None, limit=100):
        ACTING["user_id"] = user_id
        try:
            code, body = call("GET", f"/notifications?limit={limit}")
        finally:
            ACTING["user_id"] = None
        return [n["title"] for n in body] if code == 200 else []

    admin_titles = titles_for()
    check("IT Admin was told about the new IT Agent sign-up",
          "New IT Agent sign-up: Rahul Sharma" in admin_titles, admin_titles[:15])
    call("POST", "/auth/register", {"name": "Late Agent", "email": "late.agent@example.com",
                                    "password": "password123", "role": "IT_AGENT"})
    check("Super Admin was told about the sign-up and the new organizations",
          "New IT Agent sign-up: Late Agent" in titles_for(boss_id)
          and any(t.startswith("New organization: Fresh Admin") for t in titles_for(boss_id)), titles_for(boss_id)[:10])
    neha_titles = titles_for(neha_id)
    check("asset holder told when it went for repair and came back",
          "Your Repair Laptop (MNT-1) went for repair" in neha_titles
          and "Your Repair Laptop (MNT-1) is back from repair" in neha_titles, neha_titles[:10])

    with TestSession() as db:
        from app.models.models import Asset as AssetModel, Subscription as SubscriptionModel, User as UserModel
        from app.services.warranty_alerts import run_warranty_alerts
        mnt = db.query(AssetModel).filter(AssetModel.asset_tag == "MNT-1").first()
        from datetime import datetime as _dt, timedelta as _td
        mnt.warranty_end = _dt.utcnow() + _td(days=10)
        db.commit()
        first_run = run_warranty_alerts(db)
        second_run = run_warranty_alerts(db)
    check("daily warranty check warns admins once per asset", first_run >= 1 and second_run == 0, (first_run, second_run))
    check("warranty warning reaches the IT Admin",
          any(t.startswith("Warranty for MNT-1 ends on") for t in titles_for()), titles_for()[:5])

    with TestSession() as db:
        active = db.query(UserModel).filter(UserModel.company_id == COMPANY_ID, UserModel.status == "ACTIVE").count()
        db.add(SubscriptionModel(company_id=COMPANY_ID, plan="STARTER", user_limit=active + 1, asset_limit=1000))
        db.commit()
    code, body = call("POST", "/users", {"email": "last.seat@example.com", "full_name": "Last Seat",
                                         "password": "password123", "role": "EMPLOYEE"})
    check("filling the last seat warns the IT Admin and Super Admin",
          code == 201 and any("has reached its users limit" in t for t in titles_for())
          and any("has reached its users limit" in t for t in titles_for(boss_id)), titles_for()[:5])

    ACTING["user_id"] = boss_id
    call("PUT", f"/super-admin/subscriptions/{COMPANY_ID}", {"user_limit": 100})
    ACTING["user_id"] = None
    check("IT Admin told when their plan changes", "Your plan was updated" in titles_for(), titles_for()[:5])



def main():
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=PORT, log_level="warning"))
    threading.Thread(target=server.run, daemon=True).start()
    while not server.started:
        time.sleep(0.05)
    try:
        asyncio.run(run_checks())
    finally:
        server.should_exit = True
    print(f"\n{'ALL PASSED' if not failures else f'{len(failures)} FAILED'}")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
