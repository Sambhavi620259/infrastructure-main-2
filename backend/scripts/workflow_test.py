"""
End-to-end checks for the inventory, asset, software-license and approval workflows.

Runs the real app (with the access guard) on a throwaway SQLite database and
signs requests with real JWTs.

    cd backend && .venv/bin/python scripts/workflow_test.py

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
import uuid

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

import uvicorn  # noqa: E402
from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.exc import IntegrityError  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402

from app.core.database import Base, get_db  # noqa: E402
from app.core.security import create_access_token  # noqa: E402
from app.main import app  # noqa: E402
from app.models.models import AssetAssignment, AuditLog, Company, PlatformRole, Subscription, User  # noqa: E402

PORT = 8771
# WORKFLOW_DATABASE_URL runs against a real, empty, already-migrated database (e.g. PostgreSQL).
if os.environ.get("WORKFLOW_DATABASE_URL"):
    engine = create_engine(os.environ["WORKFLOW_DATABASE_URL"])
else:
    engine = create_engine(f"sqlite:///{os.path.join(tempfile.mkdtemp(), 'workflow.db')}",
                           connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
Session = sessionmaker(bind=engine)

TOKENS, IDS, COMPANY = {}, {}, {}
with Session() as db:
    for org, people in (("A", [("admin", PlatformRole.IT_ADMIN, None), ("ham", PlatformRole.SUB_ADMIN, ["HAM", "SAM"]),
                               ("u1", PlatformRole.EMPLOYEE, None), ("u2", PlatformRole.EMPLOYEE, None)]),
                        ("B", [("admin", PlatformRole.IT_ADMIN, None)])):
        company = Company(name=f"Org {org}", code=org)
        db.add(company)
        db.flush()
        COMPANY[org] = company.id
        db.add(Subscription(company_id=company.id, plan="ENTERPRISE", user_limit=100, asset_limit=100))
        for key, role, modules in people:
            user = User(email=f"{key}.{org.lower()}@example.com", hashed_password="x", full_name=f"{key.upper()} {org}",
                        role=role, company_id=company.id, status="ACTIVE", modules=modules)
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


def call(who, method, path, body=None):
    request = urllib.request.Request(
        f"http://127.0.0.1:{PORT}/api{path}", data=json.dumps(body).encode() if body is not None else None,
        method=method, headers={"Content-Type": "application/json", "Authorization": f"Bearer {TOKENS[who]}"},
    )
    try:
        with urllib.request.urlopen(request) as response:
            return response.status, json.loads(response.read() or b"{}")
    except urllib.error.HTTPError as error:
        raw = error.read().decode()
        try:
            return error.code, json.loads(raw)
        except ValueError:
            return error.code, raw


RESULTS = []


def check(label, ok, detail=""):
    RESULTS.append(bool(ok))
    print(f"  {'PASS' if ok else 'FAIL'}  {label}" + ("" if ok else f"  -> {str(detail)[:220]}"))


def ref():
    return uuid.uuid4().hex


def row_for(stock, model):
    return next((r for r in stock if r["model"] == model), {})


print("Purchase order approval")
code, vendor = call("adminA", "POST", "/vendors", {"name": "Dell"})
code, po = call("adminA", "POST", "/purchase-orders", {"po_number": "PO-1", "vendor_id": vendor["id"], "total_amount": "200000"})
po_id = po["id"]
code, body = call("adminA", "POST", "/inventory/receipts", {"purchase_order_id": po_id, "category": "Laptop", "quantity": 1})
check("stock cannot be received against an unapproved PO", code == 400, body)
code, body = call("adminA", "PUT", f"/purchase-orders/{po_id}/status", {"status": "ORDERED"})
check("the PO's creator cannot approve it (self-approval off)", code == 403, body)
code, body = call("hamA", "PUT", f"/purchase-orders/{po_id}/status", {"status": "ORDERED"})
check("another approver (HAM sub-admin) approves the PO", code == 200 and body["status"] == "ORDERED", body)

print("Receiving stock and registering devices")
receipt_ref = ref()
receipt_body = {"purchase_order_id": po_id, "category": "Laptop", "brand": "Dell", "model": "Latitude 5440",
                "specifications": "i7, 16 GB, 512 GB SSD", "quantity": 2, "unit_cost": 85000, "location": "Store room",
                "reference": receipt_ref}
code, receipt = call("adminA", "POST", "/inventory/receipts", receipt_body)
check("stock received against the approved PO", code == 201 and receipt["quantity"] == 2 and receipt["registered"] == 0, receipt)
code, body = call("adminA", "POST", "/inventory/receipts", receipt_body)
check("the same receipt submitted twice is recorded once (409)", code == 409, body)
code, stock = call("adminA", "GET", "/inventory/hardware-stock")
row = row_for(stock, "Latitude 5440")
check("hardware stock: 2 purchased, 2 awaiting registration", row.get("purchased") == 2 and row.get("awaiting_registration") == 2, stock)

code, laptop1 = call("adminA", "POST", "/assets", {"serial_number": "DL-001", "name": "Latitude 5440", "category": "Laptop",
                                                     "asset_tag": "  ", "receipt_id": receipt["id"]})
check("a device is registered without an asset tag", code == 201 and laptop1.get("asset_tag") is None, laptop1)
check("registration copies the receipt's model, cost and location",
      laptop1.get("brand") == "Dell" and laptop1.get("model") == "Latitude 5440"
      and float(laptop1.get("purchase_price") or 0) == 85000 and laptop1.get("location_id") == "Store room", laptop1)
code, laptop2 = call("adminA", "POST", "/assets", {"serial_number": "DL-002", "name": "Latitude 5440", "category": "Laptop",
                                                     "asset_tag": "LAP-002", "receipt_id": receipt["id"]})
check("a device is registered with a valid asset tag", code == 201 and laptop2.get("asset_tag") == "LAP-002", laptop2)
code, body = call("adminA", "POST", "/assets", {"serial_number": "DL-003", "name": "x", "category": "Laptop",
                                                "receipt_id": receipt["id"]})
check("a receipt cannot register more devices than were received", code == 400, body)
code, body = call("adminA", "POST", "/assets", {"serial_number": "X-1", "name": "x", "category": "Laptop", "asset_tag": "LAP-002"})
check("a duplicate non-empty asset tag is refused", code == 400, body)
code, body = call("adminA", "POST", "/assets", {"serial_number": "X-2", "name": "x", "category": "Laptop", "asset_tag": "bad tag!"})
check("a malformed asset tag is refused", code == 422, body)
code, untagged = call("adminA", "POST", "/assets", {"serial_number": "MON-1", "name": "Monitor", "category": "Monitor"})
check("several assets can be untagged (no collision)", code == 201 and untagged.get("asset_tag") is None, untagged)
code, body = call("adminA", "PUT", f"/assets/{untagged['id']}", {"asset_tag": "MON-001"})
check("a tag can be added later", code == 200 and body.get("asset_tag") == "MON-001", body)
code, stock = call("adminA", "GET", "/inventory/hardware-stock")
row = row_for(stock, "Latitude 5440")
check("after registering: nothing awaiting, 2 available", row.get("awaiting_registration") == 0 and row.get("available") == 2, row)

print("Hardware request -> approval -> assignment")
code, cats = call("adminA", "GET", "/assets/categories")
laptop_cat = next((c["id"] for c in cats if c["name"].lower().startswith("laptop")), None)
if not laptop_cat:
    code, created_cat = call("adminA", "POST", "/assets/categories", {"name": "Laptop"})
    laptop_cat = created_cat["id"]
code, ticket = call("u1A", "POST", "/asset-requests", {"asset_category_id": laptop_cat, "reason": "New joiner laptop"})
check("a user requests a laptop", code == 201 and ticket["status"] == "PENDING", ticket)
code, body = call("u1A", "PUT", f"/asset-requests/{ticket['id']}", {"status": "APPROVED"})
check("the requester cannot approve their own request", code == 403, body)
code, body = call("u1A", "POST", f"/assets/{laptop1['id']}/assign", {"user_id": IDS["u1A"]})
check("a user cannot assign an asset to themselves", code == 403, body)
code, body = call("adminA", "PUT", f"/asset-requests/{ticket['id']}", {"status": "APPROVED"})
check("the admin approves (approved, not yet fulfilled)", code == 200 and body["status"] == "APPROVED", body)
code, asset_now = call("adminA", "GET", f"/assets/{laptop1['id']}")
check("approval alone does not assign anything", asset_now["status"] == "IN_STOCK" and asset_now["assigned_to_id"] is None, asset_now)
code, body = call("adminA", "PUT", f"/asset-requests/{ticket['id']}", {"status": "FULFILLED", "assigned_asset_id": laptop1["id"]})
check("fulfilment assigns the device", code == 200 and body["status"] == "FULFILLED", body)
code, asset_now = call("adminA", "GET", f"/assets/{laptop1['id']}")
check("the device is assigned to the user", asset_now["status"] == "ASSIGNED" and asset_now["assigned_to_id"] == IDS["u1A"], asset_now)
code, body = call("adminA", "POST", f"/assets/{laptop1['id']}/assign", {"user_id": IDS["u2A"]})
check("an assigned device cannot be assigned again", code == 400, body)
with Session() as db:
    db.add(AssetAssignment(company_id=COMPANY["A"], asset_id=laptop1["id"], user_id=IDS["u2A"], is_active=True))
    try:
        db.commit()
        duplicate_blocked = False
    except IntegrityError:
        db.rollback()
        duplicate_blocked = True
check("the database refuses a second active holder for one device", duplicate_blocked)
code, mine = call("u1A", "GET", "/assets")
check("the user sees the device on My Assets", code == 200 and [a["id"] for a in mine] == [laptop1["id"]], mine)
code, stock = call("adminA", "GET", "/inventory/hardware-stock")
row = row_for(stock, "Latitude 5440")
check("stock: 1 available, 1 assigned", row.get("available") == 1 and row.get("assigned") == 1, row)

code, self_ticket = call("adminA", "POST", "/asset-requests", {"asset_category_id": laptop_cat, "reason": "Spare for me"})
code, body = call("adminA", "PUT", f"/asset-requests/{self_ticket['id']}", {"status": "APPROVED"})
check("an admin cannot approve a ticket raised for themselves", code == 403, body)

print("Return")
code, ret = call("u1A", "POST", "/asset-requests", {"ticket_type": "RETURN", "asset_id": laptop1["id"], "reason": "Leaving the team"})
check("the user asks to return their device", code == 201 and ret["ticket_type"] == "RETURN", ret)
code, body = call("u1A", "POST", "/asset-requests", {"ticket_type": "RETURN", "asset_id": laptop1["id"], "reason": "again"})
check("a second open return for the same device is refused", code == 400, body)
code, body = call("u2A", "POST", "/asset-requests", {"ticket_type": "RETURN", "asset_id": laptop1["id"], "reason": "not mine"})
check("someone else cannot return the device", code == 400, body)
code, body = call("adminA", "PUT", f"/asset-requests/{ret['id']}", {"status": "APPROVED"})
code, asset_now = call("adminA", "GET", f"/assets/{laptop1['id']}")
check("approved return: the device is marked return requested", asset_now["status"] == "RETURN_REQUESTED", asset_now)
code, body = call("adminA", "PUT", f"/asset-requests/{ret['id']}", {"status": "FULFILLED"})
check("the handover needs the returned condition", code == 400, body)
code, body = call("adminA", "PUT", f"/asset-requests/{ret['id']}", {"status": "FULFILLED", "return_condition": "POOR"})
check("handover confirmed in poor condition", code == 200 and body["return_condition"] == "POOR", body)
code, asset_now = call("adminA", "GET", f"/assets/{laptop1['id']}")
check("a poor device goes to repair, not back to stock",
      asset_now["status"] == "IN_REPAIR" and asset_now["assigned_to_id"] is None and asset_now["condition"] == "POOR", asset_now)
code, mine = call("u1A", "GET", "/assets")
check("the returned device leaves the user's My Assets", mine == [], mine)

print("Software products, licenses and seats")
code, body = call("adminA", "POST", "/software", {"name": "Adobe", "license": {"seats": 0}})
check("license count 0 is refused", code == 422, body)
code, body = call("adminA", "POST", "/software", {"name": "Adobe", "license": {"seats": "ten"}})
check("license count must be a whole number", code == 422, body)
code, body = call("adminA", "POST", "/software", {"name": "Adobe", "license": {"seats": -3}})
check("a negative license count is refused", code == 422, body)
code, product = call("adminA", "POST", "/software", {
    "name": "Microsoft 365", "vendor": "Microsoft", "version": "E3",
    "license": {"license_type": "SUBSCRIPTION", "license_number": "M365-ABCD-1234-XYZ9", "seats": 2,
                "purchase_date": "2026-01-01T00:00:00", "expiry_date": "2027-01-01T00:00:00", "cost": 50000}})
check("a product is registered with license number and count",
      code == 201 and product["total_licenses"] == 2 and product["licenses"][0]["license_number"] == "M365-ABCD-1234-XYZ9", product)
sw_id, license_id = product["id"], product["licenses"][0]["id"]
code, body = call("adminA", "POST", "/software", {"name": "Other", "license": {"seats": 1, "license_number": "M365-ABCD-1234-XYZ9"}})
check("a duplicate license number is refused", code == 400, body)
code, reread = call("adminA", "GET", f"/software/{sw_id}")
check("license number and count persist after reload",
      reread["licenses"][0]["license_number"] == "M365-ABCD-1234-XYZ9" and reread["licenses"][0]["seats"] == 2, reread)
code, body = call("u1A", "GET", "/software")
check("users cannot list the organization's licenses", code == 403, body)
code, catalog = call("u1A", "GET", "/software/catalog")
check("users see the catalogue (names only) to request from",
      code == 200 and catalog and set(catalog[0]) == {"id", "name", "vendor", "version"}, catalog)

code, sw_ticket = call("u1A", "POST", "/asset-requests", {"ticket_type": "SOFTWARE", "software_id": sw_id, "reason": "Need Office"})
check("a user requests software access", code == 201 and sw_ticket["software_name"] == "Microsoft 365", sw_ticket)
call("adminA", "PUT", f"/asset-requests/{sw_ticket['id']}", {"status": "APPROVED"})
code, body = call("adminA", "POST", f"/software/{sw_id}/assign", {"user_id": IDS["u2A"]})
code, seat_admin = call("adminA", "POST", f"/software/{sw_id}/assign", {"user_id": IDS["adminA"]})
check("seats can be assigned directly by an admin", code == 201, seat_admin)
code, body = call("adminA", "POST", f"/software/{sw_id}/assign", {"user_id": IDS["hamA"]})
check("over-allocation is refused (2 of 2 seats used)", code == 400, body)
code, body = call("adminA", "PUT", f"/asset-requests/{sw_ticket['id']}", {"status": "FULFILLED"})
check("an approved request is not fulfilled when seats ran out meanwhile", code == 400, body)
code, body = call("adminA", "PUT", f"/software/licenses/{license_id}", {"seats": 1})
check("seats cannot drop below those in use", code == 400, body)
code, body = call("adminA", "POST", f"/software/assignments/{seat_admin['assignment_id']}/release")
check("a seat is released", code == 200 and body["is_active"] is False, body)
code, body = call("adminA", "PUT", f"/asset-requests/{sw_ticket['id']}", {"status": "FULFILLED"})
check("with a seat free again, fulfilment assigns it", code == 200 and body["status"] == "FULFILLED"
      and body["license_assignment_id"], body)
code, listed = call("adminA", "GET", "/software/licenses")
lic = next(l for l in listed if l["id"] == license_id)
check("Software Licenses: 2 purchased, 2 assigned, 0 available", (lic["seats"], lic["assigned"], lic["available"]) == (2, 2, 0), lic)
code, history = call("adminA", "GET", f"/software/assignments?active=false&software_id={sw_id}")
check("released seats stay as history", code == 200 and len(history) == 1 and history[0]["released_by_name"], history)
code, mine = call("u1A", "GET", "/software/mine")
check("the user sees their software with the license number masked",
      code == 200 and len(mine) == 1 and mine[0]["license_number"] == "••••-XYZ9", mine)
code, body = call("u1A", "POST", f"/software/{sw_id}/assign", {"user_id": IDS["u1A"]})
check("users cannot assign seats", code == 403, body)
code, body = call("adminA", "POST", f"/software/{sw_id}/licenses", {"seats": 3, "license_type": "PER_USER", "license_number": "M365-EXTRA-0001"})
check("more seats are added as a second license", code == 201 and body["available"] == 3, body)
code, body = call("adminA", "GET", f"/software/{sw_id}")
check("product totals follow its licenses (5 seats, 2 used)", body["total_licenses"] == 5 and body["used_licenses"] == 2, body)

print("Consumable stock movements")
code, item = call("adminA", "POST", "/inventory", {"name": "USB-C cable", "category": "Cables", "quantity": 2, "reorder_level": 1})
move_ref = ref()
code, body = call("adminA", "POST", "/inventory/movements", {"movement_type": "RECEIPT", "item_kind": "CONSUMABLE",
                                                             "inventory_item_id": item["id"], "quantity": 5,
                                                             "purchase_order_id": po_id, "reason": "Delivery", "reference": move_ref})
check("consumables received against the PO", code == 201 and body["quantity"] == 5 and body["po_number"] == "PO-1", body)
code, body = call("adminA", "POST", "/inventory/movements", {"movement_type": "RECEIPT", "item_kind": "CONSUMABLE",
                                                             "inventory_item_id": item["id"], "quantity": 5, "reason": "Delivery",
                                                             "reference": move_ref})
check("a duplicate movement is refused", code == 409, body)
code, body = call("adminA", "POST", "/inventory/movements", {"movement_type": "ISSUE", "item_kind": "CONSUMABLE",
                                                             "inventory_item_id": item["id"], "quantity": 50, "reason": "Too many"})
check("stock cannot go negative", code == 400, body)
code, body = call("adminA", "POST", "/inventory/movements", {"movement_type": "TRANSFER", "item_kind": "HARDWARE",
                                                             "asset_id": laptop2["id"], "to_location": "Pune office", "reason": "Moved"})
check("a device is transferred to another location", code == 201 and body["from_location"] == "Store room"
      and body["to_location"] == "Pune office", body)
code, body = call("u1A", "POST", "/inventory/movements", {"movement_type": "ISSUE", "item_kind": "CONSUMABLE",
                                                          "inventory_item_id": item["id"], "quantity": 1, "reason": "x"})
check("users cannot record stock movements", code == 403, body)
code, body = call("u1A", "POST", "/inventory/receipts", receipt_body | {"reference": ref()})
check("users cannot receive stock", code == 403, body)
code, req = call("u1A", "POST", "/inventory/requests", {"item_id": item["id"], "quantity": 2, "reason": "Desk setup"})
code, body = call("adminA", "PUT", f"/inventory/requests/{req['id']}", {"status": "APPROVED"})
check("a stock request is approved and issued", code == 200 and body["status"] == "APPROVED", body)
code, ledger = call("adminA", "GET", "/inventory/movements?limit=100")
kinds = {m["movement_type"] for m in ledger}
check("the ledger holds receipts, registrations, assignments, returns, transfers and issues",
      {"RECEIPT", "REGISTER", "ASSIGN", "RETURN", "TRANSFER", "ISSUE"} <= kinds, kinds)

print("Approval rules")
code, policies = call("adminA", "GET", "/approval-policies")
check("approval rules are listed for every request type", code == 200 and len(policies) == 6, policies)
code, body = call("hamA", "PUT", "/approval-policies/SOFTWARE", {"approver_roles": ["SUB_ADMIN"]})
check("sub-admins cannot change approval rules", code == 403, body)
code, body = call("adminA", "PUT", "/approval-policies/SOFTWARE", {"approver_roles": ["EMPLOYEE"]})
check("users can never be made approvers", code == 400, body)
code, body = call("adminA", "PUT", "/approval-policies/SOFTWARE", {"approver_roles": ["IT_ADMIN"]})
check("the admin limits software approvals to IT Admins", code == 200 and body["approver_roles"] == ["IT_ADMIN"], body)
code, ticket2 = call("u2A", "POST", "/asset-requests", {"ticket_type": "SOFTWARE", "software_id": sw_id, "reason": "x"})
check("a user who already has the software cannot request it again", code == 400, ticket2)
code, product2 = call("adminA", "POST", "/software", {"name": "Slack", "license": {"seats": 5}})
code, ticket2 = call("u2A", "POST", "/asset-requests", {"ticket_type": "SOFTWARE", "software_id": product2["id"], "reason": "Chat"})
code, body = call("hamA", "PUT", f"/asset-requests/{ticket2['id']}", {"status": "APPROVED"})
check("a sub-admin is refused once the rule names only IT Admins", code == 403, body)
code, body = call("adminA", "PUT", f"/asset-requests/{ticket2['id']}", {"status": "APPROVED"})
check("an IT Admin approves under the rule", code == 200, body)

print("Optional fields and reports")
code, only_name = call("adminA", "POST", "/assets", {"name": "Spare keyboard"})
check("an asset can be registered with only a name",
      code == 201 and only_name["serial_number"] is None and only_name["asset_tag"] is None
      and only_name["category"] == "Uncategorised", only_name)
code, body = call("adminA", "POST", "/assets", {"name": "Spare mouse"})
check("several assets can have no serial number", code == 201, body)
code, body = call("adminA", "POST", "/assets", {"name": "Copy", "serial_number": "DL-001"})
check("a duplicate serial number is still refused", code == 400, body)
code, body = call("adminA", "POST", "/assets", {"name": ""})
check("the name is still required", code == 422, body)
code, body = call("adminA", "PUT", f"/assets/{only_name['id']}", {"serial_number": "KB-77"})
check("a serial number can be added later", code == 200 and body["serial_number"] == "KB-77", body)

code, run = call("adminA", "POST", "/reports/runs", {"report_type": "approvals"})
check("the approvals & work done report lists decided requests", code == 201 and run["row_count"] >= 5, run)
code, types = call("adminA", "GET", "/reports/types")
check("admins are offered the approvals report", "approvals" in [t["key"] for t in types], types)
code, user_run = call("u1A", "POST", "/reports/runs", {"report_type": "my_assets"})
code, body = call("u1A", "DELETE", f"/reports/runs/{run['id']}")
check("a user cannot remove the admin's report", code == 404, body)
code, body = call("u1A", "DELETE", f"/reports/runs/{user_run['id']}")
check("a user removes their own report", code == 204, body)
code, body = call("adminA", "DELETE", f"/reports/runs/{run['id']}")
check("the admin removes a report", code == 204, body)
code, runs = call("adminA", "GET", "/reports/runs")
check("removed reports are gone", all(r["id"] not in (run["id"], user_run["id"]) for r in runs), runs)

print("Organization isolation")
code, body = call("adminB", "GET", "/inventory/receipts")
check("org B sees none of org A's receipts", code == 200 and body == [], body)
code, body = call("adminB", "GET", "/inventory/movements")
check("org B sees none of org A's movements", code == 200 and body == [], body)
code, body = call("adminB", "GET", "/software/licenses")
check("org B sees none of org A's licenses", code == 200 and body == [], body)
code, body = call("adminB", "GET", f"/software/{sw_id}")
check("org B cannot open org A's software", code == 404, body)
code, body = call("adminB", "POST", "/inventory/receipts", receipt_body | {"reference": ref()})
check("org B cannot receive stock on org A's PO", code == 404, body)
code, body = call("adminB", "POST", "/assets", {"serial_number": "B-1", "name": "x", "category": "Laptop", "receipt_id": receipt["id"]})
check("org B cannot register devices from org A's receipt", code == 404, body)
code, body = call("adminB", "POST", f"/software/assignments/{history[0]['id']}/release")
check("org B cannot release org A's seats", code == 404, body)
code, body = call("adminB", "PUT", f"/software/licenses/{license_id}", {"seats": 100})
check("org B cannot change org A's license", code == 404, body)

print("Audit history")
with Session() as db:
    actions = {a for (a,) in db.query(AuditLog.action).filter(AuditLog.company_id == COMPANY["A"]).all()}
for action in ("RECEIVE_STOCK", "CREATE_ASSET", "ASSIGN_SOFTWARE_LICENSE", "RELEASE_SOFTWARE_SEAT",
               "UPDATE_APPROVAL_POLICY", "STOCK_MOVEMENT", "PROCESS_ASSET_REQUEST"):
    check(f"audit log records {action}", action in actions, sorted(actions))

print(f"\n{sum(RESULTS)}/{len(RESULTS)} passed")
server.should_exit = True
sys.exit(0 if all(RESULTS) else 1)
