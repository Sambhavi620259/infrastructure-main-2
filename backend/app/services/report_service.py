"""
Report generation: each report type turns a company's data into a table
(header + rows), which is rendered to CSV and stored as a ReportRun.
"""
import csv
import io
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any, Callable, Dict, List, Optional, Sequence

from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from sqlalchemy import or_

from app.models.models import (
    Asset, AssetAssignment, AssetCategory, AssetLifecycle, AssetRequest, AssetStatusEnum, AuditScanRecord,
    AuditSession, Department, InventoryItem, InventoryRequest, Software, User,
)

# Large enough for any realistic tenant export, small enough to keep a stored
# report and its download reasonable.
MAX_ROWS = 10000


class ReportFilters(BaseModel):
    """Every filter any report understands; each report type reads only its own."""
    status: Optional[AssetStatusEnum] = None
    category: Optional[str] = None
    department_id: Optional[str] = None
    coverage: Optional[str] = Field(None, pattern="^(ACTIVE|EXPIRING|EXPIRED|NONE)$")
    expiring_days: int = Field(60, ge=1, le=365)
    action: Optional[str] = None
    date_from: Optional[datetime] = None
    date_to: Optional[datetime] = None
    session_id: Optional[str] = None


@dataclass
class ReportTable:
    header: List[str]
    rows: List[List[Any]]


@dataclass
class ReportType:
    key: str
    label: str
    description: str
    filters: Sequence[str]
    # (db, company_id, filters, user_id) -> table. user_id is the person running it.
    build: Callable[[Session, str, ReportFilters, str], ReportTable]
    # Personal reports cover only the requester's own data; they are the only
    # ones users (EMPLOYEE) may run, and only users see them.
    personal: bool = False


def _day(value: Optional[datetime]) -> str:
    return value.strftime("%Y-%m-%d") if value else ""


def _stamp(value: Optional[datetime]) -> str:
    return value.strftime("%Y-%m-%d %H:%M") if value else ""


def _active_assignees(db: Session, asset_ids: List[str]) -> Dict[str, User]:
    if not asset_ids:
        return {}
    rows = (
        db.query(AssetAssignment.asset_id, User)
        .join(User, User.id == AssetAssignment.user_id)
        .filter(AssetAssignment.asset_id.in_(asset_ids), AssetAssignment.is_active.is_(True))
        .all()
    )
    return {asset_id: user for asset_id, user in rows}


def _department_names(db: Session, company_id: str) -> Dict[str, str]:
    return {d.id: d.name for d in db.query(Department).filter(Department.company_id == company_id).all()}


def _asset_inventory(db: Session, company_id: str, f: ReportFilters, user_id: str = "") -> ReportTable:
    query = db.query(Asset).filter(Asset.company_id == company_id)
    if f.status:
        query = query.filter(Asset.status == f.status)
    if f.category:
        query = query.filter(Asset.category == f.category)
    if f.department_id:
        query = query.filter(Asset.department_id == f.department_id)
    assets = query.order_by(Asset.asset_tag).limit(MAX_ROWS).all()
    holders = _active_assignees(db, [a.id for a in assets])
    departments = _department_names(db, company_id)
    return ReportTable(
        header=["Asset tag", "Name", "Category", "Type", "Brand", "Model", "Serial number", "Status",
                "Condition", "Assigned to", "Assignee email", "Department", "Location", "Purchase date",
                "Purchase price", "Warranty end"],
        rows=[
            [a.asset_tag, a.name, a.category, a.type or "", a.brand or "", a.model or "", a.serial_number,
             a.status.value, a.condition or "",
             holders[a.id].full_name if a.id in holders else "",
             holders[a.id].email if a.id in holders else "",
             departments.get(a.department_id, ""), a.location_id or "", _day(a.purchase_date),
             f"{a.purchase_price or 0:.2f}", _day(a.warranty_end)]
            for a in assets
        ],
    )


def _asset_assignments(db: Session, company_id: str, f: ReportFilters, user_id: str = "") -> ReportTable:
    query = (
        db.query(AssetAssignment, Asset, User)
        .join(Asset, Asset.id == AssetAssignment.asset_id)
        .join(User, User.id == AssetAssignment.user_id)
        .filter(AssetAssignment.company_id == company_id, AssetAssignment.is_active.is_(True))
    )
    if f.department_id:
        query = query.filter(User.department_id == f.department_id)
    rows = query.order_by(User.full_name, Asset.asset_tag).limit(MAX_ROWS).all()
    departments = _department_names(db, company_id)
    return ReportTable(
        header=["Employee", "Email", "Department", "Asset tag", "Asset", "Category", "Serial number",
                "Assigned on"],
        rows=[
            [user.full_name, user.email, departments.get(user.department_id, ""), asset.asset_tag,
             asset.name, asset.category, asset.serial_number, _day(assignment.assigned_at)]
            for assignment, asset, user in rows
        ],
    )


def _warranty(db: Session, company_id: str, f: ReportFilters, user_id: str = "") -> ReportTable:
    now = datetime.utcnow()
    cutoff = now + timedelta(days=f.expiring_days)
    query = db.query(Asset).filter(Asset.company_id == company_id)
    if f.coverage == "NONE":
        query = query.filter(Asset.warranty_end.is_(None))
    elif f.coverage == "EXPIRED":
        query = query.filter(Asset.warranty_end < now)
    elif f.coverage == "EXPIRING":
        query = query.filter(Asset.warranty_end >= now, Asset.warranty_end <= cutoff)
    elif f.coverage == "ACTIVE":
        query = query.filter(Asset.warranty_end > cutoff)
    assets = query.order_by(Asset.warranty_end.is_(None), Asset.warranty_end).limit(MAX_ROWS).all()

    def coverage(end: Optional[datetime]) -> str:
        if end is None:
            return "No warranty"
        if end < now:
            return "Expired"
        return "Expiring soon" if end <= cutoff else "Covered"

    return ReportTable(
        header=["Asset tag", "Name", "Category", "Status", "Warranty start", "Warranty end", "Coverage",
                "Days remaining"],
        rows=[
            [a.asset_tag, a.name, a.category, a.status.value, _day(a.warranty_start), _day(a.warranty_end),
             coverage(a.warranty_end), (a.warranty_end - now).days if a.warranty_end else ""]
            for a in assets
        ],
    )


def _lifecycle_events(db: Session, company_id: str, f: ReportFilters, user_id: str = "") -> ReportTable:
    query = (
        db.query(AssetLifecycle, Asset.asset_tag, Asset.name, User.full_name)
        .join(Asset, Asset.id == AssetLifecycle.asset_id)
        .outerjoin(User, User.id == AssetLifecycle.performed_by)
        .filter(AssetLifecycle.company_id == company_id)
    )
    if f.action:
        query = query.filter(AssetLifecycle.action == f.action)
    if f.date_from:
        query = query.filter(AssetLifecycle.timestamp >= f.date_from)
    if f.date_to:
        query = query.filter(AssetLifecycle.timestamp <= f.date_to)
    rows = query.order_by(AssetLifecycle.timestamp.desc()).limit(MAX_ROWS).all()
    return ReportTable(
        header=["Timestamp", "Asset tag", "Asset", "Event", "From status", "To status", "Performed by",
                "Remarks"],
        rows=[
            [_stamp(event.timestamp), tag, name, event.action, event.previous_status or "", event.new_status,
             by or "", event.remarks or ""]
            for event, tag, name, by in rows
        ],
    )


def _license_utilization(db: Session, company_id: str, f: ReportFilters, user_id: str = "") -> ReportTable:
    items = db.query(Software).filter(Software.company_id == company_id).order_by(Software.name).limit(MAX_ROWS).all()
    rows = []
    for sw in items:
        total = sw.total_licenses or 0
        used = sw.used_licenses or 0
        rows.append([
            sw.name, sw.vendor or "", sw.version or "", sw.license_type or "", total, used, total - used,
            f"{(used / total * 100) if total else 0:.1f}", f"{sw.cost or 0:.2f}", _day(sw.expiry_date),
            sw.status or "",
        ])
    return ReportTable(
        header=["Software", "Vendor", "Version", "License type", "Total seats", "Used seats", "Available seats",
                "Utilization %", "Cost", "Expiry date", "Status"],
        rows=rows,
    )


def _audit_results(db: Session, company_id: str, f: ReportFilters, user_id: str = "") -> ReportTable:
    query = (
        db.query(AuditScanRecord, AuditSession, Asset.name, User.full_name)
        .join(AuditSession, AuditSession.id == AuditScanRecord.audit_session_id)
        .outerjoin(Asset, Asset.id == AuditScanRecord.asset_id)
        .outerjoin(User, User.id == AuditScanRecord.scanned_by)
        .filter(AuditSession.company_id == company_id)
    )
    if f.session_id:
        query = query.filter(AuditSession.id == f.session_id)
    if f.date_from:
        query = query.filter(AuditScanRecord.scanned_at >= f.date_from)
    if f.date_to:
        query = query.filter(AuditScanRecord.scanned_at <= f.date_to)
    rows = query.order_by(AuditSession.started_at.desc(), AuditScanRecord.scanned_at).limit(MAX_ROWS).all()
    return ReportTable(
        header=["Audit session", "Session status", "Started", "Completed", "Scanned tag", "Asset", "Result",
                "Scanned by", "Scanned at"],
        rows=[
            [session.title, session.status, _stamp(session.started_at), _stamp(session.completed_at),
             scan.scanned_tag, asset_name or "", "Verified" if scan.is_verified else "Exception",
             scanned_by or "", _stamp(scan.scanned_at)]
            for scan, session, asset_name, scanned_by in rows
        ],
    )


def _my_assets(db: Session, company_id: str, f: ReportFilters, user_id: str = "") -> ReportTable:
    rows = (
        db.query(Asset, AssetAssignment.assigned_at)
        .join(AssetAssignment, AssetAssignment.asset_id == Asset.id)
        .filter(Asset.company_id == company_id, AssetAssignment.user_id == user_id,
                AssetAssignment.is_active.is_(True))
        .order_by(Asset.asset_tag)
        .limit(MAX_ROWS)
        .all()
    )
    return ReportTable(
        header=["Asset tag", "Name", "Category", "Brand", "Model", "Serial number", "Status", "Condition",
                "Assigned to me on", "Warranty end"],
        rows=[
            [a.asset_tag, a.name, a.category, a.brand or "", a.model or "", a.serial_number, a.status.value,
             a.condition or "", _day(since), _day(a.warranty_end)]
            for a, since in rows
        ],
    )


def _my_tickets(db: Session, company_id: str, f: ReportFilters, user_id: str = "") -> ReportTable:
    query = db.query(AssetRequest).filter(
        AssetRequest.company_id == company_id,
        or_(AssetRequest.requested_by == user_id, AssetRequest.raised_by == user_id),
    )
    if f.date_from:
        query = query.filter(AssetRequest.created_at >= f.date_from)
    if f.date_to:
        query = query.filter(AssetRequest.created_at <= f.date_to)
    tickets = query.order_by(AssetRequest.created_at.desc()).limit(MAX_ROWS).all()
    categories = dict(db.query(AssetCategory.id, AssetCategory.name).filter(AssetCategory.company_id == company_id).all())
    handler_ids = {t.processed_by for t in tickets if t.processed_by}
    handlers = dict(db.query(User.id, User.full_name).filter(User.id.in_(handler_ids)).all()) if handler_ids else {}
    asset_ids = {t.assigned_asset_id for t in tickets if t.assigned_asset_id} | {t.asset_id for t in tickets if t.asset_id}
    tags = dict(db.query(Asset.id, Asset.asset_tag).filter(Asset.id.in_(asset_ids)).all()) if asset_ids else {}
    return ReportTable(
        header=["Ticket", "Type", "Raised", "Category", "Asset", "Description", "Status", "Handled by",
                "Outcome"],
        rows=[
            [f"#{t.id[:6].upper()}", "Problem with asset" if t.ticket_type == "ISSUE" else "Asset request",
             _stamp(t.created_at), categories.get(t.asset_category_id, ""),
             tags.get(t.asset_id or t.assigned_asset_id, ""), t.reason,
             ("RESOLVED" if t.ticket_type == "ISSUE" and t.status.value == "FULFILLED" else t.status.value),
             handlers.get(t.processed_by, ""), t.resolution_note or t.rejection_reason or ""]
            for t in tickets
        ],
    )


def _approvals(db: Session, company_id: str, f: ReportFilters, user_id: str = "") -> ReportTable:
    """Every decided request (tickets of all kinds and stock requests): who decided, when, and the work done."""
    # Decided = moved beyond the queue by an admin (released tickets have no processed_at).
    tickets = db.query(AssetRequest).filter(
        AssetRequest.company_id == company_id, AssetRequest.processed_at.isnot(None),
    )
    stock = db.query(InventoryRequest).filter(
        InventoryRequest.company_id == company_id, InventoryRequest.processed_at.isnot(None)
    )
    if f.date_from:
        tickets = tickets.filter(AssetRequest.processed_at >= f.date_from)
        stock = stock.filter(InventoryRequest.processed_at >= f.date_from)
    if f.date_to:
        tickets = tickets.filter(AssetRequest.processed_at <= f.date_to)
        stock = stock.filter(InventoryRequest.processed_at <= f.date_to)
    tickets = tickets.limit(MAX_ROWS).all()
    stock = stock.limit(MAX_ROWS).all()

    user_ids = {t.requested_by for t in tickets} | {t.processed_by for t in tickets if t.processed_by} \
        | {r.requested_by for r in stock} | {r.processed_by for r in stock if r.processed_by}
    names = dict(db.query(User.id, User.full_name).filter(User.id.in_(user_ids)).all()) if user_ids else {}
    asset_ids = {t.assigned_asset_id for t in tickets if t.assigned_asset_id} | {t.asset_id for t in tickets if t.asset_id}
    tags = {a.id: a.label for a in db.query(Asset).filter(Asset.id.in_(asset_ids)).all()} if asset_ids else {}
    products = dict(db.query(Software.id, Software.name).filter(
        Software.id.in_({t.software_id for t in tickets if t.software_id})).all())
    categories = dict(db.query(AssetCategory.id, AssetCategory.name).filter(AssetCategory.company_id == company_id).all())
    items = dict(db.query(InventoryItem.id, InventoryItem.name).filter(
        InventoryItem.id.in_({r.item_id for r in stock})).all()) if stock else {}

    kind_label = {"REQUEST": "Asset request", "ISSUE": "Problem", "SOFTWARE": "Software access", "RETURN": "Return"}
    rows = []
    for t in tickets:
        status = t.status.value
        if status == "FULFILLED":
            status = {"ISSUE": "RESOLVED", "RETURN": "RETURNED", "SOFTWARE": "SEAT ASSIGNED"}.get(t.ticket_type, "FULFILLED")
        what = (products.get(t.software_id) if t.ticket_type == "SOFTWARE"
                else tags.get(t.asset_id) if t.ticket_type in ("ISSUE", "RETURN")
                else categories.get(t.asset_category_id, ""))
        work = (t.rejection_reason and f"Rejected: {t.rejection_reason}") or t.resolution_note \
            or (t.return_condition and f"Returned in {t.return_condition.lower()} condition") \
            or (t.assigned_asset_id and f"Assigned {tags.get(t.assigned_asset_id, '')}") \
            or (t.license_assignment_id and "Seat assigned") or ""
        rows.append((t.processed_at, [
            f"#{t.id[:6].upper()}", kind_label.get(t.ticket_type, t.ticket_type), names.get(t.requested_by, ""),
            what or "", t.reason, _stamp(t.created_at), status, names.get(t.processed_by, ""), _stamp(t.processed_at), work,
        ]))
    for r in stock:
        rows.append((r.processed_at, [
            f"#{r.id[:6].upper()}", "Stock request", names.get(r.requested_by, ""), f"{r.quantity} × {items.get(r.item_id, '')}",
            r.reason, _stamp(r.created_at), r.status, names.get(r.processed_by, ""), _stamp(r.processed_at),
            f"Rejected: {r.rejection_reason}" if r.rejection_reason else ("Stock issued" if r.status == "APPROVED" else ""),
        ]))
    rows.sort(key=lambda pair: pair[0] or datetime.min, reverse=True)
    return ReportTable(
        header=["Request", "Type", "Requested by", "Item", "Reason", "Raised", "Decision", "Decided by", "Decided at",
                "Work done"],
        rows=[row for _, row in rows[:MAX_ROWS]],
    )


REPORT_TYPES: Dict[str, ReportType] = {
    t.key: t
    for t in [
        ReportType("asset_inventory", "Asset inventory",
                   "Every asset with status, holder, department and purchase details.",
                   ["status", "category", "department_id"], _asset_inventory),
        ReportType("asset_assignments", "Asset assignments",
                   "Who currently holds which asset.", ["department_id"], _asset_assignments),
        ReportType("warranty", "Warranty coverage",
                   "Warranty start, end and coverage state for each asset.",
                   ["coverage", "expiring_days"], _warranty),
        ReportType("lifecycle_events", "Lifecycle events",
                   "Registrations, assignments and status changes over a period.",
                   ["action", "date_from", "date_to"], _lifecycle_events),
        ReportType("license_utilization", "License utilization",
                   "Seats bought, used and available for each software product.", [], _license_utilization),
        ReportType("audit_results", "Physical audit results",
                   "Verified scans and exceptions from audit sessions.",
                   ["session_id", "date_from", "date_to"], _audit_results),
        ReportType("approvals", "Approvals & work done",
                   "Every request decided by an admin: who approved or rejected it, when, and the work done.",
                   ["date_from", "date_to"], _approvals),
        ReportType("my_assets", "My assets",
                   "The assets assigned to you, with status, condition and warranty.", [], _my_assets, personal=True),
        ReportType("my_tickets", "My tickets",
                   "Your tickets with their status, who handled them and the asset given.",
                   ["date_from", "date_to"], _my_tickets, personal=True),
    ]
}


def report_types_for(role) -> List[ReportType]:
    """Users (EMPLOYEE) get only personal reports; everyone else gets the organization reports."""
    personal = getattr(role, "value", role) == "EMPLOYEE"
    return [t for t in REPORT_TYPES.values() if t.personal == personal]


def _csv_safe(value: Any) -> Any:
    """Stop spreadsheet apps from executing cell text as a formula."""
    if isinstance(value, str) and value[:1] in ("=", "+", "-", "@", "\t", "\r"):
        return "'" + value
    return value


def render_csv(table: ReportTable) -> str:
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(table.header)
    for row in table.rows:
        writer.writerow([_csv_safe(cell) for cell in row])
    # Byte-order mark so Excel opens UTF-8 (names, ₹, etc.) correctly.
    return "﻿" + buffer.getvalue()
