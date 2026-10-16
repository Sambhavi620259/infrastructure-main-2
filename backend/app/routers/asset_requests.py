"""Implementation file: app/routers/asset_requests.py

Tickets: users raise requests (hardware, software, access), report problems
and return devices; the IT team reviews, approves, fulfils and resolves them.

Status flow (stored value -> label):
PENDING (Submitted) -> UNDER_REVIEW -> PENDING_APPROVAL -> APPROVED ->
IN_PROGRESS -> FULFILLED (Resolved) -> CLOSED, with WAITING_INVENTORY,
WAITING_LICENSE and WAITING_USER on the way, and REJECTED / CANCELLED ending
a ticket early. Every transition is checked here, not only in the UI.
"""
import base64
import binascii
import os
from datetime import datetime, timedelta
from typing import Dict, List, Optional
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import case, func, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user, require_roles, get_tenant_company_id
from app.models.models import (
    AccessGrant, AccessResource, AssetRequest, AssetReturnRequest, Asset, AssetAssignment, AssetCategory,
    AssetLifecycle, Department, AssetStatusEnum, RequestStatusEnum, PlatformRole, Software,
    SoftwareLicenseAssignment, TicketApproval, TicketAttachment, TicketComment, TicketEvent, User
)
from app.services.access_service import check_access_until, needs_owner_approval, record_grant
from app.services.approval_service import TICKET_REQUEST_TYPE, require_approver
from app.services.software_service import assign_seat
from app.services.stock_service import record_movement
from app.schemas.schemas import (
    AssetRequestCreate, AssetRequestResponse, AssetRequestUpdate, AssetReturnCreate, OwnerDecision,
    TicketApprovalResponse, TicketAsset, TicketAssign, TicketAttachmentCreate, TicketAttachmentResponse,
    TicketCommentCreate, TicketCommentResponse, TicketEventResponse, TicketPage, TicketReopen
)
from app.services.audit_service import log_audit_event
from app.services.notification_service import home_link, notify, notify_company

router = APIRouter(prefix="/asset-requests", tags=["Asset Requests"])

# Admins work the ticket queue. Users (stored as EMPLOYEE) raise tickets,
# see only their own, and may cancel their own while it is open.
_HANDLERS = {PlatformRole.SUPER_ADMIN, PlatformRole.IT_ADMIN, PlatformRole.SUB_ADMIN}


S = RequestStatusEnum
# Plain-language names used in messages and the history.
STATUS_LABEL = {
    S.PENDING: "submitted", S.UNDER_REVIEW: "under review", S.PENDING_APPROVAL: "pending approval",
    S.APPROVED: "approved", S.IN_PROGRESS: "in progress", S.WAITING_INVENTORY: "waiting for inventory",
    S.WAITING_LICENSE: "waiting for license", S.WAITING_USER: "waiting for you", S.FULFILLED: "resolved",
    S.CLOSED: "closed", S.REJECTED: "rejected", S.CANCELLED: "cancelled",
}
PRIORITY_RANK = {"LOW": 1, "MEDIUM": 2, "HIGH": 3, "CRITICAL": 4}


def _own_tickets(query, user: User):
    """Limit a ticket query to the ones a user raised or that are for them."""
    return query.filter(or_(AssetRequest.requested_by == user.id, AssetRequest.raised_by == user.id))


def _visible_to_user(query, user: User):
    """A user sees their own tickets, and access requests for resources they own (to approve them)."""
    owned = AssetRequest.access_resource_id.in_(
        AccessResource.__table__.select().with_only_columns(AccessResource.id).where(AccessResource.owner_id == user.id)
    )
    return query.filter(or_(AssetRequest.requested_by == user.id, AssetRequest.raised_by == user.id, owned))


def _number(req: AssetRequest) -> str:
    return f"TKT-{req.ticket_no:06d}" if req.ticket_no else f"#{req.id[:6].upper()}"


def _event(db: Session, req: AssetRequest, actor: Optional[User], action: str, from_status=None, to_status=None,
           note: Optional[str] = None, internal: bool = False) -> None:
    db.add(TicketEvent(
        company_id=req.company_id, ticket_id=req.id, actor_id=actor.id if actor else None, action=action,
        from_status=from_status.value if hasattr(from_status, "value") else from_status,
        to_status=to_status.value if hasattr(to_status, "value") else to_status,
        note=(note or None) and note[:2000], internal=internal,
    ))


def _has_approval(db: Session, req: AssetRequest, kind: str) -> bool:
    return db.query(TicketApproval.id).filter(
        TicketApproval.ticket_id == req.id, TicketApproval.kind == kind, TicketApproval.decision == "APPROVED",
    ).first() is not None


def _record_approval(db: Session, req: AssetRequest, approver: User, kind: str, decision: str, note: Optional[str]) -> None:
    db.add(TicketApproval(company_id=req.company_id, ticket_id=req.id, approver_id=approver.id, kind=kind,
                          decision=decision, note=(note or None) and note[:2000]))


def _resource_of(db: Session, req: AssetRequest) -> Optional[AccessResource]:
    return db.get(AccessResource, req.access_resource_id) if req.access_resource_id else None


def _owner_pending(db: Session, req: AssetRequest, resource: Optional[AccessResource]) -> bool:
    return needs_owner_approval(resource, req.requested_by) and not _has_approval(db, req, "OWNER")


def _team(db: Session, company_id: str) -> List[User]:
    return db.query(User).filter(
        User.company_id == company_id, User.status == "ACTIVE",
        User.role.in_([PlatformRole.IT_ADMIN, PlatformRole.SUB_ADMIN]),
    ).all()


def _with_names(db: Session, requests: List[AssetRequest], viewer: Optional[User] = None) -> List[AssetRequestResponse]:
    """Attach names, approvals and counts in batched lookups. Users do not see internal-note counts."""
    if not requests:
        return []
    ids = [r.id for r in requests]
    resource_ids = {r.access_resource_id for r in requests if r.access_resource_id}
    resources = (
        {res.id: res for res in db.query(AccessResource).filter(AccessResource.id.in_(resource_ids)).all()}
        if resource_ids else {}
    )
    user_ids = (
        {r.requested_by for r in requests}
        | {r.processed_by for r in requests if r.processed_by}
        | {r.raised_by for r in requests if r.raised_by}
        | {r.assignee_id for r in requests if r.assignee_id}
        | {res.owner_id for res in resources.values() if res.owner_id}
    )
    approvals_by_ticket: Dict[str, list] = {}
    for approval in db.query(TicketApproval).filter(TicketApproval.ticket_id.in_(ids)).order_by(TicketApproval.created_at).all():
        approvals_by_ticket.setdefault(approval.ticket_id, []).append(approval)
        user_ids.add(approval.approver_id)
    staff_view = viewer is None or viewer.role != PlatformRole.EMPLOYEE
    comment_query = db.query(TicketComment.ticket_id, func.count(TicketComment.id)).filter(TicketComment.ticket_id.in_(ids))
    if not staff_view:
        comment_query = comment_query.filter(TicketComment.internal.is_(False))
    comment_counts = dict(comment_query.group_by(TicketComment.ticket_id).all())
    attachment_counts = dict(
        db.query(TicketAttachment.ticket_id, func.count(TicketAttachment.id))
        .filter(TicketAttachment.ticket_id.in_(ids)).group_by(TicketAttachment.ticket_id).all()
    )
    employee_ids = {
        uid: code or agent for uid, code, agent in
        db.query(User.id, User.employee_code, User.agent_id).filter(User.id.in_({r.requested_by for r in requests})).all()
    }
    category_ids = {r.asset_category_id for r in requests if r.asset_category_id}
    asset_ids = {r.assigned_asset_id for r in requests if r.assigned_asset_id}
    users = dict(db.query(User.id, User.full_name).filter(User.id.in_(user_ids)).all()) if user_ids else {}
    categories = (
        dict(db.query(AssetCategory.id, AssetCategory.name).filter(AssetCategory.id.in_(category_ids)).all())
        if category_ids else {}
    )
    # Tag, else serial number, else name: tags and serial numbers are optional.
    tags = {a.id: a.label for a in db.query(Asset).filter(Asset.id.in_(asset_ids)).all()} if asset_ids else {}
    software_ids = {r.software_id for r in requests if r.software_id}
    software_names = (
        dict(db.query(Software.id, Software.name).filter(Software.id.in_(software_ids)).all()) if software_ids else {}
    )
    issue_asset_ids = {r.asset_id for r in requests if r.asset_id}
    issue_assets = (
        {a.id: a for a in db.query(Asset).filter(Asset.id.in_(issue_asset_ids)).all()} if issue_asset_ids else {}
    )
    department_ids = {r.department_id for r in requests if r.department_id}
    departments = (
        dict(db.query(Department.id, Department.name).filter(Department.id.in_(department_ids)).all())
        if department_ids else {}
    )
    result = []
    for req in requests:
        response = AssetRequestResponse.model_validate(req)
        response.requested_by_name = users.get(req.requested_by)
        response.category_name = categories.get(req.asset_category_id)
        response.assigned_asset_tag = tags.get(req.assigned_asset_id)
        response.department_name = departments.get(req.department_id)
        response.processed_by_name = users.get(req.processed_by)
        response.raised_by_name = users.get(req.raised_by)
        response.software_name = software_names.get(req.software_id) or req.requested_software_name
        if response.software_name and not response.category_name:
            response.category_name = "Software"
        asset = issue_assets.get(req.asset_id)
        response.assignee_name = users.get(req.assignee_id)
        response.requester_employee_id = employee_ids.get(req.requested_by)
        response.comment_count = comment_counts.get(req.id, 0)
        response.attachment_count = attachment_counts.get(req.id, 0)
        resource = resources.get(req.access_resource_id)
        approvals = approvals_by_ticket.get(req.id, [])
        response.approvals = [
            TicketApprovalResponse(id=a.id, approver_id=a.approver_id, approver_name=users.get(a.approver_id),
                                   kind=a.kind, decision=a.decision, note=a.note, created_at=a.created_at)
            for a in approvals
        ]
        if resource is not None:
            response.access_resource_name = resource.name
            response.category_name = response.category_name or "Access"
            response.owner_id = resource.owner_id
            response.owner_name = users.get(resource.owner_id)
            response.needs_owner_approval = (
                needs_owner_approval(resource, req.requested_by)
                and not any(a.kind == "OWNER" and a.decision == "APPROVED" for a in approvals)
            )
        if asset is not None:
            response.asset = TicketAsset(
                id=asset.id, asset_tag=asset.asset_tag, name=asset.name, category=asset.category,
                brand=asset.brand, model=asset.model, serial_number=asset.serial_number,
                status=asset.status.value, condition=asset.condition, warranty_end=asset.warranty_end,
            )
            if not response.category_name:
                response.category_name = asset.category
        result.append(response)
    return result


@router.post("", response_model=AssetRequestResponse, status_code=status.HTTP_201_CREATED)
def create_asset_request(
    request_in: AssetRequestCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id)
):
    """
    Submit a new asset requisition request. Only users raise tickets; IT Admins
    and other admins work and resolve them.
    """
    if current_user.role != PlatformRole.EMPLOYEE:
        raise HTTPException(status_code=403, detail="Tickets are raised by users. IT Admins resolve them.")
    company_id = tenant_company_id or current_user.company_id
    if not company_id:
        raise HTTPException(status_code=400, detail="Company context required.")

    requester = current_user
    if (request_in.requested_for_user_id and request_in.requested_for_user_id != current_user.id
            and current_user.role == PlatformRole.EMPLOYEE):
        raise HTTPException(status_code=403, detail="You can raise tickets only for yourself.")
    if request_in.requested_for_user_id and request_in.requested_for_user_id != current_user.id:
        requester = db.query(User).filter(
            User.id == request_in.requested_for_user_id,
            User.company_id == company_id,
            User.status == "ACTIVE",
        ).first()
        if not requester:
            raise HTTPException(status_code=404, detail="That user is not an active member of your organization.")

    issue_asset = None
    software = None
    resource = None
    category_id = request_in.asset_category_id
    if request_in.required_date and request_in.required_date.date() < datetime.utcnow().date():
        raise HTTPException(status_code=400, detail="The required date cannot be in the past.")
    if request_in.ticket_type == "ACCESS":
        resource = db.query(AccessResource).filter(
            AccessResource.id == request_in.access_resource_id, AccessResource.company_id == company_id,
            AccessResource.status == "ACTIVE",
        ).first() if request_in.access_resource_id else None
        if not resource:
            raise HTTPException(status_code=400, detail="Choose the application or resource you need access to.")
        level = (request_in.access_level or "").strip()
        if level not in (resource.access_levels or []):
            raise HTTPException(status_code=400, detail=f"Choose an access level for {resource.name}: "
                                                        f"{', '.join(resource.access_levels or [])}.")
        check_access_until(resource, request_in.access_until)
        if db.query(AccessGrant.id).filter(
            AccessGrant.resource_id == resource.id, AccessGrant.user_id == requester.id,
            AccessGrant.access_level == level, AccessGrant.is_active.is_(True),
        ).first():
            raise HTTPException(status_code=400, detail=f"You already have {level} access to {resource.name}.")
        if db.query(AssetRequest.id).filter(
            AssetRequest.access_resource_id == resource.id, AssetRequest.requested_by == requester.id,
            AssetRequest.status.in_(OPEN_TICKET_STATUSES),
        ).first():
            raise HTTPException(status_code=400, detail=f"You already have an open request for {resource.name}.")
        category_id = None
    elif request_in.ticket_type in ("ISSUE", "RETURN"):
        # Problems and returns are about an asset the requester holds right now.
        if not request_in.asset_id:
            raise HTTPException(status_code=400, detail="Choose the asset.")
        issue_asset = db.query(Asset).join(AssetAssignment, AssetAssignment.asset_id == Asset.id).filter(
            Asset.id == request_in.asset_id, Asset.company_id == company_id,
            AssetAssignment.user_id == requester.id, AssetAssignment.is_active == True,
        ).first()
        if not issue_asset:
            raise HTTPException(status_code=400, detail="You can raise this only for an asset assigned to you.")
        if request_in.ticket_type == "RETURN" and db.query(AssetRequest.id).filter(
            AssetRequest.asset_id == issue_asset.id, AssetRequest.ticket_type == "RETURN",
            AssetRequest.status.in_(OPEN_TICKET_STATUSES),
        ).first():
            raise HTTPException(status_code=400, detail="A return for this asset is already open.")
        category_id = db.query(AssetCategory.id).filter(
            AssetCategory.company_id == company_id, AssetCategory.name == issue_asset.category
        ).scalar()
    elif request_in.ticket_type == "SOFTWARE":
        software = db.query(Software).filter(
            Software.id == request_in.software_id, Software.company_id == company_id, Software.status == "ACTIVE"
        ).first() if request_in.software_id else None
        requested_name = (request_in.requested_software_name or "").strip()
        if request_in.software_id and not software:
            raise HTTPException(status_code=400, detail="That software is not available.")
        if not software and not requested_name:
            raise HTTPException(status_code=400, detail="Choose the software you need, or type its name.")
        if software and db.query(SoftwareLicenseAssignment.id).filter(
            SoftwareLicenseAssignment.software_id == software.id, SoftwareLicenseAssignment.user_id == requester.id,
            SoftwareLicenseAssignment.is_active.is_(True),
        ).first():
            raise HTTPException(status_code=400, detail=f"{requester.full_name} already has {software.name}.")
        category_id = None
    elif not category_id or not db.query(AssetCategory.id).filter(
        AssetCategory.id == category_id, AssetCategory.company_id == company_id
    ).first():
        raise HTTPException(status_code=400, detail="Unknown asset category.")

    if request_in.department_id and not db.query(Department.id).filter(
        Department.id == request_in.department_id, Department.company_id == company_id
    ).first():
        raise HTTPException(status_code=400, detail="Unknown department.")

    new_request = AssetRequest(
        company_id=company_id,
        priority=request_in.priority,
        required_date=request_in.required_date,
        additional_comments=(request_in.additional_comments or "").strip() or None,
        access_resource_id=resource.id if resource else None,
        access_level=(request_in.access_level or "").strip() if resource else None,
        access_until=request_in.access_until if resource else None,
        requested_by=requester.id,
        raised_by=current_user.id,
        ticket_type=request_in.ticket_type,
        asset_id=issue_asset.id if issue_asset else None,
        software_id=software.id if software else None,
        requested_software_name=(
            (request_in.requested_software_name or "").strip() or None
            if request_in.ticket_type == "SOFTWARE" and not software else None
        ),
        asset_category_id=category_id,
        department_id=request_in.department_id or None,
        requested_for=request_in.requested_for or requester.full_name,
        reason=request_in.reason,
        status=RequestStatusEnum.PENDING
    )
    # Ticket numbers run per organization; a clash (two at once) just takes the next one.
    for attempt in range(5):
        new_request.ticket_no = (
            db.query(func.max(AssetRequest.ticket_no)).filter(AssetRequest.company_id == company_id).scalar() or 0
        ) + 1
        db.add(new_request)
        try:
            with db.begin_nested():
                db.flush()
            break
        except IntegrityError:
            db.expunge(new_request)
            if attempt == 4:
                raise HTTPException(status_code=409, detail="Could not number the ticket. Please try again.")
    _event(db, new_request, current_user, "CREATED", to_status=S.PENDING,
           note=f"{request_in.priority.title()} priority" + (
               f", needed by {request_in.required_date:%d %b %Y}" if request_in.required_date else ""))
    if resource and needs_owner_approval(resource, requester.id):
        owner = db.get(User, resource.owner_id)
        if owner and owner.status == "ACTIVE":
            notify(db, owner, f"{requester.full_name} asked for {new_request.access_level} access to {resource.name}",
                   "You own this resource: please approve or reject the request.",
                   home_link(owner, "/requests", "/agent/tickets"), "INFO")
    notify_company(
        db, company_id, [PlatformRole.IT_ADMIN, PlatformRole.SUB_ADMIN],
        title=(
            f"Problem reported with {issue_asset.label} by {requester.full_name}" if request_in.ticket_type == "ISSUE"
            else f"{requester.full_name} wants to return {issue_asset.label}" if request_in.ticket_type == "RETURN"
            else f"{requester.full_name} requested {new_request.access_level} access to {resource.name}" if resource
            else f"{requester.full_name} requested {software.name}" if software
            else f"{requester.full_name} requested {new_request.requested_software_name} (not registered yet)"
            if new_request.requested_software_name
            else f"New ticket from {requester.full_name}"
        ),
        message=new_request.reason[:200],
        admin_link="/tickets", agent_link="/agent/tickets",
        exclude_user_id=current_user.id,
    )
    db.commit()
    db.refresh(new_request)

    log_audit_event(
        db=db,
        action="CREATE_ASSET_REQUEST",
        entity="AssetRequest",
        company_id=company_id,
        user_id=current_user.id,
        entity_id=new_request.id,
        new_value=f"{_number(new_request)} for {requester.full_name}: {new_request.reason[:120]}"
    )

    return _with_names(db, [new_request], current_user)[0]


def _ticket_query(
    db: Session, current_user: User, tenant_company_id: Optional[str], *,
    status_filter: Optional[str] = None, mine: bool = False, requested_by: Optional[str] = None,
    raised_by: Optional[str] = None, processed_by: Optional[str] = None, asset_id: Optional[str] = None,
    q: Optional[str] = None, ticket_type: Optional[str] = None, priority: Optional[str] = None,
    department_id: Optional[str] = None, requester: Optional[str] = None, assignee_id: Optional[str] = None,
    created_from: Optional[datetime] = None, created_to: Optional[datetime] = None,
    awaiting_my_approval: bool = False,
):
    """Tickets the caller may see, narrowed by the filters. Users only ever see their own (and ones they approve)."""
    query = db.query(AssetRequest)
    if current_user.role != PlatformRole.SUPER_ADMIN:
        query = query.filter(AssetRequest.company_id == tenant_company_id)
    if current_user.role == PlatformRole.EMPLOYEE:
        query = _visible_to_user(query, current_user)

    if mine:
        query = query.filter(AssetRequest.requested_by == current_user.id)
    if requested_by:
        query = query.filter(AssetRequest.requested_by == requested_by)
    if raised_by:
        query = query.filter(AssetRequest.raised_by == raised_by)
    if processed_by:
        query = query.filter(AssetRequest.processed_by == processed_by)
    if asset_id:
        query = query.filter(AssetRequest.asset_id == asset_id)
    if status_filter:
        try:
            statuses = [S(value.strip()) for value in status_filter.split(",") if value.strip()]
        except ValueError:
            raise HTTPException(status_code=422, detail="Unknown ticket status.")
        query = query.filter(AssetRequest.status.in_(statuses))
    if ticket_type:
        query = query.filter(AssetRequest.ticket_type.in_([t.strip().upper() for t in ticket_type.split(",")]))
    if priority:
        query = query.filter(AssetRequest.priority.in_([p.strip().upper() for p in priority.split(",")]))
    if department_id:
        query = query.filter(AssetRequest.department_id == department_id)
    if assignee_id:
        query = query.filter(AssetRequest.assignee_id == (current_user.id if assignee_id == "me" else assignee_id))
    if created_from:
        query = query.filter(AssetRequest.created_at >= created_from)
    if created_to:
        query = query.filter(AssetRequest.created_at < created_to + timedelta(days=1))
    if requester:
        names = db.query(User.id).filter(User.full_name.ilike(f"%{requester.strip()}%"))
        query = query.filter(AssetRequest.requested_by.in_(names))
    if q:
        text_q = q.strip()
        digits = "".join(ch for ch in text_q if ch.isdigit())
        conditions = [AssetRequest.reason.ilike(f"%{text_q}%"), AssetRequest.id.ilike(f"{text_q.lstrip('#').lower()}%")]
        if digits and text_q.upper().replace("TKT", "").replace("-", "").replace("#", "").strip().isdigit():
            conditions.append(AssetRequest.ticket_no == int(digits))
        query = query.filter(or_(*conditions))
    if awaiting_my_approval:
        owned = db.query(AccessResource.id).filter(AccessResource.owner_id == current_user.id)
        decided = db.query(TicketApproval.ticket_id).filter(TicketApproval.kind == "OWNER")
        query = query.filter(
            AssetRequest.access_resource_id.in_(owned), AssetRequest.requested_by != current_user.id,
            AssetRequest.status.in_(OPEN_TICKET_STATUSES), ~AssetRequest.id.in_(decided),
        )
    return query


def _sorted(query, sort: str, order: str):
    columns = {
        "created_at": AssetRequest.created_at,
        "ticket_no": AssetRequest.ticket_no,
        "status": AssetRequest.status,
        "required_date": AssetRequest.required_date,
        "priority": case(PRIORITY_RANK, value=AssetRequest.priority, else_=0),
    }
    column = columns.get(sort, AssetRequest.created_at)
    primary = column.asc() if order == "asc" else column.desc()
    return query.order_by(primary, AssetRequest.created_at.desc())


@router.get("", response_model=List[AssetRequestResponse])
def list_asset_requests(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    status_filter: Optional[str] = Query(None, alias="status"),
    mine: bool = False,
    requested_by: Optional[str] = None,
    raised_by: Optional[str] = None,
    processed_by: Optional[str] = None,
    asset_id: Optional[str] = None,
    awaiting_my_approval: bool = False,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id)
):
    """
    Ticket queue, newest first. mine=true limits it to the caller's own;
    status takes one status or several separated by commas. Users only ever
    see their own tickets (and access requests waiting for their approval as
    resource owner).
    """
    query = _ticket_query(db, current_user, tenant_company_id, status_filter=status_filter, mine=mine,
                          requested_by=requested_by, raised_by=raised_by, processed_by=processed_by,
                          asset_id=asset_id, awaiting_my_approval=awaiting_my_approval)
    return _with_names(db, query.order_by(AssetRequest.created_at.desc()).offset(skip).limit(limit).all(), current_user)


@router.get("/search", response_model=TicketPage)
def search_asset_requests(
    q: Optional[str] = None,
    status_filter: Optional[str] = Query(None, alias="status"),
    ticket_type: Optional[str] = None,
    priority: Optional[str] = None,
    department_id: Optional[str] = None,
    requester: Optional[str] = None,
    assignee_id: Optional[str] = None,
    created_from: Optional[datetime] = None,
    created_to: Optional[datetime] = None,
    sort: str = Query("created_at", pattern="^(created_at|ticket_no|status|required_date|priority)$"),
    order: str = Query("desc", pattern="^(asc|desc)$"),
    skip: int = Query(0, ge=0),
    limit: int = Query(25, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id)
):
    """
    One page of tickets with its total, for the ticket tables: search by ticket
    number or text, filter by requester, type, department, priority, status,
    assignee ("me") and creation date, and sort.
    """
    query = _ticket_query(db, current_user, tenant_company_id, status_filter=status_filter, q=q,
                          ticket_type=ticket_type, priority=priority, department_id=department_id,
                          requester=requester, assignee_id=assignee_id, created_from=created_from,
                          created_to=created_to)
    total = query.count()
    items = _sorted(query, sort, order).offset(skip).limit(limit).all()
    return TicketPage(items=_with_names(db, items, current_user), total=total)


@router.get("/counts")
def get_ticket_counts(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id)
):
    """
    Ticket counts for dashboards and badges: one per status, plus open,
    high-priority, needing admin action and (for owners) waiting for my approval.
    """
    company_id = tenant_company_id or current_user.company_id
    if not company_id and current_user.role != PlatformRole.SUPER_ADMIN:
        raise HTTPException(status_code=400, detail="Company context required")

    base = db.query(AssetRequest)
    if current_user.role != PlatformRole.SUPER_ADMIN:
        base = base.filter(AssetRequest.company_id == company_id)
    if current_user.role == PlatformRole.EMPLOYEE:
        base = _own_tickets(base, current_user)

    by_status = dict(base.with_entities(AssetRequest.status, func.count(AssetRequest.id)).group_by(AssetRequest.status).all())
    count = lambda *statuses: sum(by_status.get(st, 0) for st in statuses)  # noqa: E731
    open_tickets = base.filter(AssetRequest.status.in_(OPEN_TICKET_STATUSES))
    owned = db.query(AccessResource.id).filter(AccessResource.owner_id == current_user.id)
    decided = db.query(TicketApproval.ticket_id).filter(TicketApproval.kind == "OWNER")
    awaiting_owner = db.query(AssetRequest).filter(
        AssetRequest.access_resource_id.in_(owned), AssetRequest.requested_by != current_user.id,
        AssetRequest.status.in_(OPEN_TICKET_STATUSES), ~AssetRequest.id.in_(decided),
    ).count()
    return {
        "total": sum(by_status.values()),
        "pending": count(S.PENDING),
        "submitted": count(S.PENDING),
        "under_review": count(S.UNDER_REVIEW),
        "pending_approval": count(S.PENDING_APPROVAL),
        "in_progress": count(S.IN_PROGRESS),
        "approved": count(S.APPROVED),
        "waiting_inventory": count(S.WAITING_INVENTORY),
        "waiting_license": count(S.WAITING_LICENSE),
        "waiting_user": count(S.WAITING_USER),
        "fulfilled": count(S.FULFILLED),
        "resolved": count(S.FULFILLED),
        "closed": count(S.CLOSED),
        "rejected": count(S.REJECTED),
        "cancelled": count(S.CANCELLED),
        # Every ticket still being worked on.
        "open": open_tickets.count(),
        "high_priority": open_tickets.filter(AssetRequest.priority.in_(["HIGH", "CRITICAL"])).count(),
        # Waiting on the IT team (not on the user, stock or a license).
        "needs_action": count(S.PENDING, S.UNDER_REVIEW, S.PENDING_APPROVAL, S.APPROVED, S.IN_PROGRESS),
        "my_open": open_tickets.filter(AssetRequest.requested_by == current_user.id).count(),
        "assigned_to_me": open_tickets.filter(AssetRequest.assignee_id == current_user.id).count(),
        "awaiting_my_approval": awaiting_owner,
    }


@router.get("/team")
def ticket_team(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(list(_HANDLERS))),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id)
):
    """IT team members a ticket can be assigned to."""
    company_id = tenant_company_id or current_user.company_id
    return [{"id": u.id, "full_name": u.full_name, "role": u.role.value} for u in _team(db, company_id)]


@router.get("/{request_id}", response_model=AssetRequestResponse)
def get_asset_request(
    request_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id)
):
    """
    Get detailed information for a specific asset request.
    """
    return _with_names(db, [_visible_ticket(db, request_id, current_user, tenant_company_id)], current_user)[0]


def _visible_ticket(db: Session, request_id: str, user: User, tenant_company_id: Optional[str]) -> AssetRequest:
    """A ticket the caller may see (404 otherwise, so other people's tickets are not revealed)."""
    query = db.query(AssetRequest).filter(AssetRequest.id == request_id)
    if user.role != PlatformRole.SUPER_ADMIN:
        query = query.filter(AssetRequest.company_id == tenant_company_id)
    if user.role == PlatformRole.EMPLOYEE:
        query = _visible_to_user(query, user)
    req = query.first()
    if not req:
        raise HTTPException(status_code=404, detail="Asset request not found.")
    return req


# Where an admin may move a ticket next. CLOSED, REJECTED and CANCELLED are final;
# a resolved (FULFILLED) ticket is closed, or reopened through /reopen.
_WORKING = {S.PENDING, S.UNDER_REVIEW, S.IN_PROGRESS}
_NEXT_STATUS = {
    S.PENDING: {S.UNDER_REVIEW, S.IN_PROGRESS, S.PENDING_APPROVAL, S.APPROVED, S.WAITING_USER,
                S.WAITING_INVENTORY, S.WAITING_LICENSE, S.FULFILLED, S.REJECTED, S.CANCELLED},
    S.UNDER_REVIEW: {S.PENDING, S.IN_PROGRESS, S.PENDING_APPROVAL, S.APPROVED, S.WAITING_USER,
                     S.WAITING_INVENTORY, S.WAITING_LICENSE, S.FULFILLED, S.REJECTED, S.CANCELLED},
    S.PENDING_APPROVAL: {S.APPROVED, S.REJECTED, S.WAITING_USER, S.CANCELLED},
    S.APPROVED: {S.IN_PROGRESS, S.WAITING_INVENTORY, S.WAITING_LICENSE, S.WAITING_USER, S.FULFILLED, S.CANCELLED},
    S.IN_PROGRESS: {S.PENDING, S.UNDER_REVIEW, S.PENDING_APPROVAL, S.APPROVED, S.WAITING_USER,
                    S.WAITING_INVENTORY, S.WAITING_LICENSE, S.FULFILLED, S.REJECTED, S.CANCELLED},
    S.WAITING_INVENTORY: {S.IN_PROGRESS, S.APPROVED, S.FULFILLED, S.REJECTED, S.CANCELLED},
    S.WAITING_LICENSE: {S.IN_PROGRESS, S.APPROVED, S.FULFILLED, S.REJECTED, S.CANCELLED},
    S.WAITING_USER: {S.UNDER_REVIEW, S.IN_PROGRESS, S.PENDING_APPROVAL, S.APPROVED, S.REJECTED, S.CANCELLED},
    S.FULFILLED: {S.CLOSED},
}
# Still being worked on (everything before Resolved).
OPEN_TICKET_STATUSES = [st for st in _NEXT_STATUS if st != S.FULFILLED]
_FINAL = {S.CLOSED, S.REJECTED, S.CANCELLED}

# Statuses that make no sense for a ticket type.
_NOT_FOR_TYPE = {
    "ISSUE": {S.PENDING_APPROVAL, S.APPROVED, S.WAITING_INVENTORY, S.WAITING_LICENSE},
    "RETURN": {S.WAITING_INVENTORY, S.WAITING_LICENSE},
    "REQUEST": {S.WAITING_LICENSE},
    "SOFTWARE": {S.WAITING_INVENTORY},
    "ACCESS": {S.WAITING_INVENTORY, S.WAITING_LICENSE},
}

# What the requester is told at each step: (title, message, notification type).
_REQUESTER_NOTICE = {
    S.UNDER_REVIEW: ("Your ticket is under review", "{actor} is reviewing it.", "INFO"),
    S.IN_PROGRESS: ("Your ticket is being worked on", "{actor} has started working on it.", "INFO"),
    S.PENDING_APPROVAL: ("Your ticket is waiting for approval", "{actor} sent it for approval.", "INFO"),
    S.APPROVED: ("Your ticket was approved", "{actor} approved it.", "SUCCESS"),
    S.WAITING_INVENTORY: ("Your request is waiting for stock", "{actor}: {waiting}", "INFO"),
    S.WAITING_LICENSE: ("Your request is waiting for a license", "{actor}: {waiting}", "INFO"),
    S.WAITING_USER: ("More information needed on your ticket", "{actor}: {note}", "WARNING"),
    S.FULFILLED: ("Your ticket is fulfilled", "{actor} assigned you {asset}. Please confirm or reopen it.", "SUCCESS"),
    S.CLOSED: ("Your ticket is closed", "{actor} closed it.", "INFO"),
    S.REJECTED: ("Your ticket was rejected", "{actor}: {reason}", "WARNING"),
    S.CANCELLED: ("Your ticket was cancelled", "{actor} cancelled it.", "INFO"),
}


def _reserve(db: Session, asset_req: AssetRequest, asset_id: str, actor: User) -> Asset:
    """Hold an in-stock device for an approved hardware request until it is handed over."""
    asset = db.query(Asset).filter(Asset.id == asset_id, Asset.company_id == asset_req.company_id) \
        .with_for_update().first()
    if not asset or asset.status != AssetStatusEnum.IN_STOCK:
        raise HTTPException(status_code=400, detail="That asset is not available: it is assigned, reserved or not in stock.")
    if asset_req.assigned_asset_id and asset_req.assigned_asset_id != asset.id:
        _release_reservation(db, asset_req, actor)
    _set_status(db, asset, AssetStatusEnum.REQUESTED, actor, f"Reserved for ticket {_number(asset_req)}.")
    asset_req.assigned_asset_id = asset.id
    return asset


def _release_reservation(db: Session, asset_req: AssetRequest, actor: User) -> None:
    """Put a device reserved for this ticket back in stock (the ticket was cancelled, rejected or changed)."""
    if not asset_req.assigned_asset_id or asset_req.status in (S.FULFILLED, S.CLOSED):
        return
    asset = db.query(Asset).filter(Asset.id == asset_req.assigned_asset_id).with_for_update().first()
    if asset and asset.status == AssetStatusEnum.REQUESTED:
        _set_status(db, asset, AssetStatusEnum.IN_STOCK, actor, f"Reservation for ticket {_number(asset_req)} released.")
    asset_req.assigned_asset_id = None


def _set_status(db: Session, asset: Asset, status: AssetStatusEnum, actor: User, remarks: str) -> None:
    if asset.status == status:
        return
    db.add(AssetLifecycle(company_id=asset.company_id, asset_id=asset.id, action="STATUS_CHANGE",
                          previous_status=asset.status.value, new_status=status.value,
                          performed_by=actor.id, remarks=remarks))
    asset.status = status


def _lock_held_asset(db: Session, asset_req: AssetRequest) -> Asset:
    """The asset of a RETURN ticket, locked, and still held by the requester."""
    asset = db.query(Asset).filter(Asset.id == asset_req.asset_id).with_for_update().first()
    holder = db.query(AssetAssignment.user_id).filter(
        AssetAssignment.asset_id == asset_req.asset_id, AssetAssignment.is_active == True
    ).scalar() if asset else None
    if not asset or holder != asset_req.requested_by:
        raise HTTPException(status_code=400, detail="This device is no longer assigned to the requester.")
    return asset


# Condition on return -> where the device goes. Only good devices become available again.
_RETURN_STATUS = {
    "EXCELLENT": AssetStatusEnum.IN_STOCK, "GOOD": AssetStatusEnum.IN_STOCK, "FAIR": AssetStatusEnum.IN_STOCK,
    "POOR": AssetStatusEnum.IN_REPAIR, "DAMAGED": AssetStatusEnum.DAMAGED,
}


def _receive_return(db: Session, asset: Asset, condition: str, actor: User) -> None:
    """Close the holder's assignment and file the device by the condition it came back in."""
    db.query(AssetAssignment).filter(AssetAssignment.asset_id == asset.id, AssetAssignment.is_active == True) \
        .update({"is_active": False, "returned_at": datetime.utcnow()})
    asset.condition = condition
    target = _RETURN_STATUS[condition]
    _set_status(db, asset, target, actor, f"Returned in {condition.lower()} condition.")
    record_movement(db, asset.company_id, "RETURN", "HARDWARE", actor.id, asset_id=asset.id,
                    reason=f"Returned in {condition.lower()} condition" +
                           ("" if target == AssetStatusEnum.IN_STOCK else f"; filed as {target.value.lower().replace('_', ' ')}"))


def _hand_over_asset(db: Session, asset_req: AssetRequest, asset_id: Optional[str], actor: User) -> Asset:
    """Assign an in-stock asset to the ticket's requester and record it in the asset history."""
    if not asset_id:
        raise HTTPException(status_code=400, detail="Choose the asset to hand over.")
    # Locked and re-checked now. A reserved device can only go to the ticket it is reserved for.
    asset = db.query(Asset).filter(Asset.id == asset_id, Asset.company_id == asset_req.company_id) \
        .with_for_update().first()
    reserved_here = asset is not None and asset.status == AssetStatusEnum.REQUESTED and asset_req.assigned_asset_id == asset.id
    if not asset or not (asset.status == AssetStatusEnum.IN_STOCK or reserved_here):
        raise HTTPException(status_code=400, detail="That asset is not available in stock.")
    if asset_req.assigned_asset_id and asset_req.assigned_asset_id != asset.id:
        _release_reservation(db, asset_req, actor)

    previous_status = asset.status.value
    asset.status = AssetStatusEnum.ASSIGNED
    asset_req.assigned_asset_id = asset.id
    db.query(AssetAssignment).filter(
        AssetAssignment.asset_id == asset.id, AssetAssignment.is_active == True
    ).update({"is_active": False})
    db.add(AssetAssignment(
        company_id=asset_req.company_id, asset_id=asset.id, user_id=asset_req.requested_by, is_active=True,
    ))
    record_movement(db, asset_req.company_id, "ASSIGN", "HARDWARE", actor.id, asset_id=asset.id,
                    reason=f"Assigned to fulfil ticket #{asset_req.id[:6].upper()}")
    db.add(AssetLifecycle(
        company_id=asset_req.company_id,
        asset_id=asset.id,
        action="ASSIGNED_VIA_REQUEST",
        previous_status=previous_status,
        new_status=AssetStatusEnum.ASSIGNED.value,
        performed_by=actor.id,
        remarks=f"Assigned to fulfil ticket #{asset_req.id[:6].upper()}.",
    ))
    return asset


@router.put("/{request_id}", response_model=AssetRequestResponse)
def update_asset_request_status(
    request_id: str,
    update_in: AssetRequestUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id)
):
    """
    Move a ticket along its workflow (see the module docstring). Rules:
    approving, rejecting and fulfilling follow the organization's approval
    rule; rejections need a reason; waiting for inventory / a license needs
    an expected date or procurement note; waiting for the user needs a note.
    Software that needs approval, and every access request, must be approved
    before a seat or access is given; access to a resource with an owner also
    needs the owner's approval. A shortage is never marked resolved: fulfilling
    hands over a device, takes a seat or records a grant, or fails.
    Users may only cancel their own open ticket (confirm / reopen have their own endpoints).
    """
    is_handler = current_user.role in _HANDLERS
    if not is_handler and current_user.role != PlatformRole.EMPLOYEE:
        raise HTTPException(status_code=403, detail="Only an IT Admin can work on tickets.")

    query = db.query(AssetRequest).filter(AssetRequest.id == request_id)
    if current_user.role != PlatformRole.SUPER_ADMIN:
        query = query.filter(AssetRequest.company_id == tenant_company_id)
    if not is_handler:
        query = _own_tickets(query, current_user)

    asset_req = query.first()
    if not asset_req:
        raise HTTPException(status_code=404, detail="Asset request not found.")
    if not is_handler and update_in.status != S.CANCELLED:
        raise HTTPException(status_code=403, detail="Only an IT Admin can work on tickets. You can cancel your own ticket.")

    new_status = update_in.status
    # Approving with a device hands it over at once.
    if new_status == S.APPROVED and update_in.assigned_asset_id:
        new_status = S.FULFILLED

    old_status = asset_req.status
    ticket_type = asset_req.ticket_type
    is_issue = ticket_type == "ISSUE"
    if is_issue and new_status == S.APPROVED:
        raise HTTPException(status_code=400, detail="A problem ticket is resolved, not approved. Resolve it with a note.")
    if new_status in _NOT_FOR_TYPE.get(ticket_type, set()):
        raise HTTPException(status_code=400, detail=f"A {ticket_type.lower()} ticket cannot be {STATUS_LABEL[new_status]}.")
    if new_status not in _NEXT_STATUS.get(old_status, set()):
        if old_status in _FINAL:
            raise HTTPException(status_code=400, detail=f"This ticket is already {STATUS_LABEL[old_status]}.")
        raise HTTPException(
            status_code=400,
            detail=f"A {STATUS_LABEL[old_status]} ticket cannot be moved to {STATUS_LABEL[new_status]}.",
        )
    if not is_handler and old_status == S.FULFILLED:
        raise HTTPException(status_code=400, detail="This ticket is resolved. Confirm it, or reopen it if something is wrong.")
    if new_status == S.REJECTED and not (update_in.rejection_reason or "").strip():
        raise HTTPException(status_code=400, detail="Give a reason for rejecting the ticket.")
    note = (update_in.note or "").strip()
    if new_status == S.WAITING_USER and not note:
        raise HTTPException(status_code=400, detail="Say what you need from the requester.")
    if new_status in (S.WAITING_INVENTORY, S.WAITING_LICENSE):
        if not update_in.expected_date and not (update_in.procurement_note or "").strip():
            raise HTTPException(status_code=400, detail="Give the expected date or procurement notes for the shortage.")
        if update_in.expected_date and update_in.expected_date.date() < datetime.utcnow().date():
            raise HTTPException(status_code=400, detail="The expected date cannot be in the past.")
    # Decisions follow the organization's approval rule for this kind of request.
    if is_handler and new_status in (S.APPROVED, S.REJECTED, S.FULFILLED):
        require_approver(db, current_user, asset_req.company_id, TICKET_REQUEST_TYPE.get(ticket_type, "ASSET"),
                         [asset_req.requested_by])

    resource = _resource_of(db, asset_req)
    approved_before = _has_approval(db, asset_req, "APPROVER")
    if ticket_type == "ACCESS" and new_status == S.APPROVED and _owner_pending(db, asset_req, resource):
        if resource.owner_id == current_user.id:
            _record_approval(db, asset_req, current_user, "OWNER", "APPROVED", note or "Approved as resource owner")
        else:
            owner = db.get(User, resource.owner_id)
            raise HTTPException(status_code=400, detail=f"{owner.full_name if owner else 'The owner'} (resource owner) must approve "
                                                        f"access to {resource.name} first. Send it for approval.")

    asset = None
    software_name = None
    if ticket_type == "RETURN" and new_status == S.APPROVED:
        asset = _lock_held_asset(db, asset_req)
        _set_status(db, asset, AssetStatusEnum.RETURN_REQUESTED, current_user, "Return approved; waiting for the device.")
    if ticket_type == "RETURN" and old_status == S.APPROVED and new_status in (S.REJECTED, S.CANCELLED):
        held = db.query(Asset).filter(Asset.id == asset_req.asset_id).with_for_update().first()
        if held and held.status == AssetStatusEnum.RETURN_REQUESTED:
            _set_status(db, held, AssetStatusEnum.ASSIGNED, current_user, "Return withdrawn; the device stays with its holder.")
    if ticket_type == "REQUEST" and update_in.reserve_asset_id:
        if new_status not in (S.APPROVED, S.IN_PROGRESS):
            raise HTTPException(status_code=400, detail="A device is reserved when the request is approved.")
        if not (approved_before or new_status == S.APPROVED):
            raise HTTPException(status_code=400, detail="Approve the request before reserving a device.")
        asset = _reserve(db, asset_req, update_in.reserve_asset_id, current_user)

    if new_status == S.FULFILLED and ticket_type == "SOFTWARE":
        # Re-check seat availability at fulfilment, under a lock (approval alone grants nothing).
        if not asset_req.software_id:
            # Asked for by name: the admin picks the registered software to give.
            if not update_in.software_id:
                raise HTTPException(
                    status_code=400,
                    detail=f"Register {asset_req.requested_software_name or 'the software'} first, then choose it to assign a seat.",
                )
            chosen = db.query(Software).filter(
                Software.id == update_in.software_id, Software.company_id == asset_req.company_id,
                Software.status == "ACTIVE",
            ).first()
            if not chosen:
                raise HTTPException(status_code=400, detail="That software is not available.")
            asset_req.software_id = chosen.id
        software = db.query(Software).filter(Software.id == asset_req.software_id).first()
        requester = db.query(User).filter(User.id == asset_req.requested_by).first()
        if not software or not requester:
            raise HTTPException(status_code=400, detail="The software or the requester no longer exists.")
        needs_approval = software.approval_required or bool(asset_req.requested_software_name)
        if needs_approval and not approved_before:
            raise HTTPException(status_code=400, detail=f"{software.name} needs approval before a seat is given. Approve the request first.")
        seat = assign_seat(db, software, requester, current_user, license_id=update_in.license_id)
        if update_in.deployment_status:
            seat.deployment_status = update_in.deployment_status
            seat.deployment_updated_at = datetime.utcnow()
            seat.deployment_updated_by = current_user.id
        asset_req.license_assignment_id = seat.id
        software_name = software.name
    elif new_status == S.FULFILLED and ticket_type == "ACCESS":
        # Access is only ever recorded after the approvals; nothing is granted automatically.
        if not resource or resource.status != "ACTIVE":
            raise HTTPException(status_code=400, detail="This resource is no longer available.")
        if not approved_before:
            raise HTTPException(status_code=400, detail="Access is granted only after the request is approved.")
        if _owner_pending(db, asset_req, resource):
            raise HTTPException(status_code=400, detail="The resource owner has not approved this access yet.")
        until = update_in.access_until or asset_req.access_until
        check_access_until(resource, until)
        requester = db.get(User, asset_req.requested_by)
        if not requester or requester.status != "ACTIVE":
            raise HTTPException(status_code=400, detail="The requester is no longer active.")
        grant = record_grant(db, resource, requester, asset_req.access_level, current_user, until, ticket_id=asset_req.id)
        asset_req.access_grant_id = grant.id
        asset_req.access_until = until
    elif new_status == S.FULFILLED and ticket_type == "RETURN":
        if not update_in.return_condition:
            raise HTTPException(status_code=400, detail="Confirm the condition the device came back in.")
        asset = _lock_held_asset(db, asset_req)
        _receive_return(db, asset, update_in.return_condition, current_user)
        asset_req.return_condition = update_in.return_condition
    elif new_status == S.FULFILLED and is_issue:
        # Resolving a problem: record what was done; the asset stays with the user.
        resolution = (update_in.resolution_note or "").strip()
        if not resolution:
            raise HTTPException(status_code=400, detail="Describe how the problem was resolved.")
        asset_req.resolution_note = resolution
        asset = db.query(Asset).filter(Asset.id == asset_req.asset_id).first()
    elif new_status == S.FULFILLED:
        asset = _hand_over_asset(db, asset_req, update_in.assigned_asset_id or asset_req.assigned_asset_id, current_user)

    if new_status in (S.REJECTED, S.CANCELLED):
        _release_reservation(db, asset_req, current_user)
    if new_status == S.REJECTED:
        asset_req.rejection_reason = update_in.rejection_reason.strip()
        if is_handler:
            _record_approval(db, asset_req, current_user, "APPROVER", "REJECTED", asset_req.rejection_reason)
    if new_status == S.APPROVED and not approved_before:
        _record_approval(db, asset_req, current_user, "APPROVER", "APPROVED", note or None)
    if new_status in (S.WAITING_INVENTORY, S.WAITING_LICENSE):
        asset_req.expected_date = update_in.expected_date
        asset_req.procurement_note = (update_in.procurement_note or "").strip() or None
    if new_status == S.FULFILLED:
        asset_req.resolved_at = datetime.utcnow()
        if note and not asset_req.resolution_note:
            asset_req.resolution_note = note
    if new_status == S.CLOSED:
        asset_req.closed_at = datetime.utcnow()
    if new_status == S.WAITING_USER:
        # The question goes to the requester as a comment they can reply to.
        db.add(TicketComment(company_id=asset_req.company_id, ticket_id=asset_req.id, author_id=current_user.id,
                             body=note, internal=False))

    previous_handler = asset_req.processed_by
    asset_req.status = new_status
    if new_status == S.PENDING:
        # Released back to the queue: nobody is handling it now.
        asset_req.processed_by = None
        asset_req.processed_at = None
    else:
        asset_req.processed_by = current_user.id
        asset_req.processed_at = datetime.utcnow()

    waiting = ", ".join(filter(None, [
        f"expected {asset_req.expected_date:%d %b %Y}" if asset_req.expected_date else None,
        asset_req.procurement_note,
    ]))
    _event(db, asset_req, current_user, "STATUS", old_status, new_status,
           note=asset_req.rejection_reason if new_status == S.REJECTED
           else waiting if new_status in (S.WAITING_INVENTORY, S.WAITING_LICENSE)
           else asset_req.resolution_note if new_status == S.FULFILLED and is_issue
           else (f"Reserved {asset.label}" if update_in.reserve_asset_id and asset else note or None))

    # A user withdrawing a ticket someone is already working on: tell that admin.
    if not is_handler and previous_handler and previous_handler != current_user.id:
        handler = db.query(User).filter(User.id == previous_handler).first()
        if handler:
            notify(
                db, handler,
                title=f"{current_user.full_name} cancelled ticket {_number(asset_req)}",
                message=asset_req.reason[:200],
                link=home_link(handler, "/requests", "/agent/tickets"),
                type="INFO",
            )
    # Sent for approval: tell the resource owner (access) or the other approvers.
    if new_status == S.PENDING_APPROVAL:
        owner = db.get(User, resource.owner_id) if _owner_pending(db, asset_req, resource) else None
        recipients = [owner] if owner else [u for u in _team(db, asset_req.company_id) if u.id != current_user.id]
        for person in recipients:
            if person and person.status == "ACTIVE":
                notify(db, person, f"Ticket {_number(asset_req)} needs your approval",
                       asset_req.reason[:200], home_link(person, "/requests", "/agent/tickets"), "INFO")

    requester = db.query(User).filter(User.id == asset_req.requested_by).first()
    notice = _REQUESTER_NOTICE.get(new_status)
    if ticket_type == "SOFTWARE" and new_status == S.FULFILLED:
        notice = (f"You now have {software_name}",
                  "{actor} assigned you a seat. It is listed under My Software. Please confirm or reopen the ticket.", "SUCCESS")
    if ticket_type == "ACCESS" and new_status == S.FULFILLED:
        notice = (f"{asset_req.access_level} access to {resource.name} recorded",
                  "{actor} recorded the access as given" + (f" until {asset_req.access_until:%d %b %Y}" if asset_req.access_until else "")
                  + ". Please confirm it works, or reopen the ticket.", "SUCCESS")
    if ticket_type == "RETURN" and new_status == S.FULFILLED:
        notice = (f"Return of {asset.label} confirmed", "{actor} received the device. Thank you.", "SUCCESS")
    if is_issue and new_status == S.FULFILLED:
        notice = (f"Your problem with {asset.label if asset else 'your asset'} is resolved",
                  "{actor}: " + asset_req.resolution_note.replace("{", "(").replace("}", ")"), "SUCCESS")
    if ticket_type == "REQUEST" and new_status == S.APPROVED and asset is not None:
        notice = ("Your request was approved", "{actor} approved it and reserved {asset} for you.", "SUCCESS")
    if requester and notice and requester.id != current_user.id:
        title, message, kind = notice
        notify(
            db, requester,
            title=title,
            message=message.format(
                actor=current_user.full_name,
                asset=f"{asset.label} ({asset.name})" if asset else "an asset",
                reason=asset_req.rejection_reason,
                note=note.replace("{", "(").replace("}", ")"),
                waiting=(waiting or "on order").replace("{", "(").replace("}", ")"),
            )[:300],
            link=home_link(requester, "/requests", "/agent/tickets"),
            type=kind,
        )
    db.commit()
    db.refresh(asset_req)

    log_audit_event(
        db=db,
        action="PROCESS_ASSET_REQUEST",
        entity="AssetRequest",
        company_id=asset_req.company_id,
        user_id=current_user.id,
        entity_id=asset_req.id,
        old_value=f"Status: {old_status.value}",
        new_value=f"Ticket {_number(asset_req)} {STATUS_LABEL[new_status]}"
    )

    return _with_names(db, [asset_req], current_user)[0]


def _handler_ticket(db: Session, request_id: str, user: User, tenant_company_id: Optional[str]) -> AssetRequest:
    if user.role not in _HANDLERS:
        raise HTTPException(status_code=403, detail="Only the IT team can do this.")
    return _visible_ticket(db, request_id, user, tenant_company_id)


def _notify_team_member(db: Session, req: AssetRequest, actor: User, title: str, message: str) -> None:
    """Tell whoever handles the ticket (assignee, else last handler, else the IT team)."""
    target_ids = [uid for uid in (req.assignee_id, req.processed_by) if uid and uid != actor.id][:1]
    people = [db.get(User, target_ids[0])] if target_ids else [u for u in _team(db, req.company_id) if u.id != actor.id]
    for person in people:
        if person and person.status == "ACTIVE":
            notify(db, person, title, message[:300], home_link(person, "/requests", "/agent/tickets"), "INFO")


@router.post("/{request_id}/assign", response_model=AssetRequestResponse)
def assign_ticket(
    request_id: str,
    body: TicketAssign,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id)
):
    """Give the ticket to an IT team member (or take it back with null)."""
    req = _handler_ticket(db, request_id, current_user, tenant_company_id)
    if req.status in _FINAL:
        raise HTTPException(status_code=400, detail=f"This ticket is already {STATUS_LABEL[req.status]}.")
    assignee = None
    if body.assignee_id:
        assignee = next((u for u in _team(db, req.company_id) if u.id == body.assignee_id), None)
        if not assignee:
            raise HTTPException(status_code=400, detail="Choose an active member of the IT team.")
    req.assignee_id = assignee.id if assignee else None
    _event(db, req, current_user, "ASSIGNED", note=f"Assigned to {assignee.full_name}" if assignee else "Unassigned",
           internal=True)
    if assignee and assignee.id != current_user.id:
        notify(db, assignee, f"Ticket {_number(req)} was assigned to you", req.reason[:200], "/requests", "INFO")
    db.commit()
    log_audit_event(db=db, action="ASSIGN_TICKET", entity="AssetRequest", company_id=req.company_id,
                    user_id=current_user.id, entity_id=req.id,
                    new_value=f"{_number(req)} -> {assignee.full_name if assignee else 'unassigned'}")
    db.refresh(req)
    return _with_names(db, [req], current_user)[0]


@router.post("/{request_id}/confirm", response_model=AssetRequestResponse)
def confirm_ticket(
    request_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id)
):
    """The requester confirms a resolved ticket did what they needed: it is closed."""
    req = _visible_ticket(db, request_id, current_user, tenant_company_id)
    if req.requested_by != current_user.id:
        raise HTTPException(status_code=403, detail="Only the person the ticket is for can confirm it.")
    if req.status != S.FULFILLED:
        raise HTTPException(status_code=400, detail="Only a resolved ticket can be confirmed.")
    req.status = S.CLOSED
    req.closed_at = datetime.utcnow()
    _event(db, req, current_user, "STATUS", S.FULFILLED, S.CLOSED, note="Confirmed by the requester")
    _notify_team_member(db, req, current_user, f"{current_user.full_name} confirmed ticket {_number(req)}", "It is closed.")
    db.commit()
    log_audit_event(db=db, action="CONFIRM_TICKET", entity="AssetRequest", company_id=req.company_id,
                    user_id=current_user.id, entity_id=req.id, new_value=f"{_number(req)} closed")
    db.refresh(req)
    return _with_names(db, [req], current_user)[0]


@router.post("/{request_id}/reopen", response_model=AssetRequestResponse)
def reopen_ticket(
    request_id: str,
    body: TicketReopen,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id)
):
    """
    Reopen a resolved ticket (the requester, or the IT team) or a closed one
    (the IT team only). It goes back to Under Review with the reason as a comment.
    """
    req = _visible_ticket(db, request_id, current_user, tenant_company_id)
    is_handler = current_user.role in _HANDLERS
    if not is_handler and req.requested_by != current_user.id:
        raise HTTPException(status_code=403, detail="Only the person the ticket is for can reopen it.")
    allowed = {S.FULFILLED, S.CLOSED} if is_handler else {S.FULFILLED}
    if req.status not in allowed:
        raise HTTPException(status_code=400, detail="Only a resolved ticket can be reopened." if not is_handler
                            else "Only a resolved or closed ticket can be reopened.")
    old_status = req.status
    req.status = S.UNDER_REVIEW
    req.resolved_at = None
    req.closed_at = None
    req.reopen_count = (req.reopen_count or 0) + 1
    reason = body.reason.strip()
    db.add(TicketComment(company_id=req.company_id, ticket_id=req.id, author_id=current_user.id,
                         body=f"Reopened: {reason}", internal=False))
    _event(db, req, current_user, "REOPENED", old_status, S.UNDER_REVIEW, note=reason)
    if is_handler:
        requester = db.get(User, req.requested_by)
        if requester and requester.id != current_user.id:
            notify(db, requester, f"Ticket {_number(req)} was reopened", f"{current_user.full_name}: {reason}"[:300],
                   home_link(requester, "/requests", "/agent/tickets"), "INFO")
    else:
        _notify_team_member(db, req, current_user, f"{current_user.full_name} reopened ticket {_number(req)}", reason)
    db.commit()
    log_audit_event(db=db, action="REOPEN_TICKET", entity="AssetRequest", company_id=req.company_id,
                    user_id=current_user.id, entity_id=req.id, new_value=f"{_number(req)} reopened: {reason[:150]}")
    db.refresh(req)
    return _with_names(db, [req], current_user)[0]


@router.post("/{request_id}/owner-decision", response_model=AssetRequestResponse)
def owner_decision(
    request_id: str,
    body: OwnerDecision,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id)
):
    """The owner of a resource approves or rejects an access request for it."""
    req = _visible_ticket(db, request_id, current_user, tenant_company_id)
    resource = _resource_of(db, req)
    if req.ticket_type != "ACCESS" or not resource or resource.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Only the owner of the resource can decide on this request.")
    if req.requested_by == current_user.id:
        raise HTTPException(status_code=403, detail="You cannot approve your own access request.")
    if req.status not in OPEN_TICKET_STATUSES:
        raise HTTPException(status_code=400, detail=f"This ticket is already {STATUS_LABEL[req.status]}.")
    if db.query(TicketApproval.id).filter(TicketApproval.ticket_id == req.id, TicketApproval.kind == "OWNER").first():
        raise HTTPException(status_code=400, detail="You have already decided on this request.")
    note = (body.note or "").strip()
    if body.decision == "REJECTED" and not note:
        raise HTTPException(status_code=400, detail="Give a reason for rejecting the request.")
    _record_approval(db, req, current_user, "OWNER", body.decision, note or None)
    requester = db.get(User, req.requested_by)
    if body.decision == "REJECTED":
        old_status = req.status
        req.status = S.REJECTED
        req.rejection_reason = f"Resource owner: {note}"
        req.processed_by = current_user.id
        req.processed_at = datetime.utcnow()
        _event(db, req, current_user, "OWNER_REJECTED", old_status, S.REJECTED, note=note)
        if requester:
            notify(db, requester, f"Your access request for {resource.name} was rejected",
                   f"{current_user.full_name} (resource owner): {note}"[:300],
                   home_link(requester, "/requests", "/agent/tickets"), "WARNING")
    else:
        _event(db, req, current_user, "OWNER_APPROVED", note=note or None)
    _notify_team_member(db, req, current_user,
                        f"{current_user.full_name} {'approved' if body.decision == 'APPROVED' else 'rejected'} "
                        f"access to {resource.name} ({_number(req)})", note or "As resource owner.")
    db.commit()
    log_audit_event(db=db, action="OWNER_DECISION", entity="AssetRequest", company_id=req.company_id,
                    user_id=current_user.id, entity_id=req.id,
                    new_value=f"{_number(req)}: owner {body.decision.lower()} {req.access_level} access to {resource.name}")
    db.refresh(req)
    return _with_names(db, [req], current_user)[0]


@router.get("/{request_id}/comments", response_model=List[TicketCommentResponse])
def list_comments(
    request_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id)
):
    """The ticket's conversation. Internal notes are left out for users."""
    req = _visible_ticket(db, request_id, current_user, tenant_company_id)
    query = db.query(TicketComment).filter(TicketComment.ticket_id == req.id)
    if current_user.role not in _HANDLERS:
        query = query.filter(TicketComment.internal.is_(False))
    comments = query.order_by(TicketComment.created_at).all()
    authors = {
        u.id: u for u in db.query(User).filter(User.id.in_({c.author_id for c in comments})).all()
    } if comments else {}
    return [
        TicketCommentResponse(
            id=c.id, ticket_id=c.ticket_id, author_id=c.author_id,
            author_name=authors[c.author_id].full_name if c.author_id in authors else None,
            author_is_staff=c.author_id in authors and authors[c.author_id].role != PlatformRole.EMPLOYEE,
            body=c.body, internal=c.internal, created_at=c.created_at,
        )
        for c in comments
    ]


@router.post("/{request_id}/comments", response_model=TicketCommentResponse, status_code=status.HTTP_201_CREATED)
def add_comment(
    request_id: str,
    body: TicketCommentCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id)
):
    """
    Comment on a ticket. The IT team can add internal notes; users comment for
    everyone on the ticket. A reply from the requester while the ticket waits
    for them puts it back under review.
    """
    req = _visible_ticket(db, request_id, current_user, tenant_company_id)
    is_handler = current_user.role in _HANDLERS
    if body.internal and not is_handler:
        raise HTTPException(status_code=403, detail="Only the IT team can add internal notes.")
    if req.status in _FINAL and not body.internal:
        raise HTTPException(status_code=400, detail=f"This ticket is {STATUS_LABEL[req.status]}. Reopen it to add a comment.")
    text = body.body.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Write a comment.")
    comment = TicketComment(company_id=req.company_id, ticket_id=req.id, author_id=current_user.id,
                            body=text, internal=body.internal)
    db.add(comment)
    if not is_handler and req.requested_by == current_user.id and req.status == S.WAITING_USER:
        req.status = S.UNDER_REVIEW
        _event(db, req, current_user, "STATUS", S.WAITING_USER, S.UNDER_REVIEW, note="The requester replied")
    if is_handler and not body.internal:
        requester = db.get(User, req.requested_by)
        if requester and requester.id != current_user.id:
            notify(db, requester, f"New comment on ticket {_number(req)}", f"{current_user.full_name}: {text}"[:300],
                   home_link(requester, "/requests", "/agent/tickets"), "INFO")
    elif not is_handler:
        _notify_team_member(db, req, current_user, f"{current_user.full_name} commented on {_number(req)}", text)
    db.commit()
    db.refresh(comment)
    return TicketCommentResponse(
        id=comment.id, ticket_id=req.id, author_id=current_user.id, author_name=current_user.full_name,
        author_is_staff=is_handler, body=comment.body, internal=comment.internal, created_at=comment.created_at,
    )


@router.get("/{request_id}/history", response_model=List[TicketEventResponse])
def ticket_history(
    request_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id)
):
    """Who did what to the ticket, oldest first. Internal steps are left out for users."""
    req = _visible_ticket(db, request_id, current_user, tenant_company_id)
    query = db.query(TicketEvent).filter(TicketEvent.ticket_id == req.id)
    if current_user.role not in _HANDLERS:
        query = query.filter(TicketEvent.internal.is_(False))
    events = query.order_by(TicketEvent.created_at, TicketEvent.id).all()
    names = dict(db.query(User.id, User.full_name).filter(User.id.in_({e.actor_id for e in events if e.actor_id})).all()) \
        if events else {}
    return [
        TicketEventResponse(id=e.id, action=e.action, from_status=e.from_status, to_status=e.to_status, note=e.note,
                            actor_name=names.get(e.actor_id), internal=e.internal, created_at=e.created_at)
        for e in events
    ]


# --- Attachments: small images and PDFs, checked by their content, not only their name.

MAX_ATTACHMENT_BYTES = 2 * 1024 * 1024
MAX_ATTACHMENTS = 10
_SIGNATURES = {
    "image/png": (b"\x89PNG\r\n\x1a\n",),
    "image/jpeg": (b"\xff\xd8\xff",),
    "image/gif": (b"GIF87a", b"GIF89a"),
    "application/pdf": (b"%PDF-",),
}


def _file_type_ok(content_type: str, data: bytes) -> bool:
    if content_type == "image/webp":
        return data[:4] == b"RIFF" and data[8:12] == b"WEBP"
    return any(data.startswith(sig) for sig in _SIGNATURES.get(content_type, ()))


def _attachment_response(a: TicketAttachment, names: Dict[str, str]) -> TicketAttachmentResponse:
    return TicketAttachmentResponse(id=a.id, ticket_id=a.ticket_id, filename=a.filename, content_type=a.content_type,
                                    size=a.size, uploaded_by=a.uploaded_by, uploaded_by_name=names.get(a.uploaded_by),
                                    created_at=a.created_at)


@router.get("/{request_id}/attachments", response_model=List[TicketAttachmentResponse])
def list_attachments(
    request_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id)
):
    req = _visible_ticket(db, request_id, current_user, tenant_company_id)
    items = db.query(TicketAttachment).filter(TicketAttachment.ticket_id == req.id) \
        .order_by(TicketAttachment.created_at).all()
    names = dict(db.query(User.id, User.full_name).filter(User.id.in_({a.uploaded_by for a in items})).all()) if items else {}
    return [_attachment_response(a, names) for a in items]


@router.post("/{request_id}/attachments", response_model=TicketAttachmentResponse, status_code=status.HTTP_201_CREATED)
def add_attachment(
    request_id: str,
    body: TicketAttachmentCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id)
):
    """Attach an image (PNG, JPEG, GIF, WebP) or PDF of up to 2 MB. Up to 10 files per ticket."""
    req = _visible_ticket(db, request_id, current_user, tenant_company_id)
    if current_user.role not in _HANDLERS and req.requested_by != current_user.id and req.raised_by != current_user.id:
        raise HTTPException(status_code=403, detail="Only the requester and the IT team can add files.")
    if req.status in _FINAL:
        raise HTTPException(status_code=400, detail=f"This ticket is {STATUS_LABEL[req.status]}.")
    content_type = body.content_type.strip().lower()
    if content_type not in (*_SIGNATURES, "image/webp"):
        raise HTTPException(status_code=400, detail="Attach an image (PNG, JPEG, GIF, WebP) or a PDF.")
    raw = body.data.split(",", 1)[1] if body.data.startswith("data:") else body.data
    if len(raw) > MAX_ATTACHMENT_BYTES * 4 // 3 + 8:
        raise HTTPException(status_code=413, detail="A file can be at most 2 MB.")
    try:
        data = base64.b64decode(raw, validate=True)
    except (binascii.Error, ValueError):
        raise HTTPException(status_code=400, detail="The file could not be read.")
    if not data or len(data) > MAX_ATTACHMENT_BYTES:
        raise HTTPException(status_code=413, detail="A file can be at most 2 MB.")
    if not _file_type_ok(content_type, data):
        raise HTTPException(status_code=400, detail="The file's content does not match its type.")
    if db.query(TicketAttachment).filter(TicketAttachment.ticket_id == req.id).count() >= MAX_ATTACHMENTS:
        raise HTTPException(status_code=400, detail=f"A ticket can have at most {MAX_ATTACHMENTS} files.")
    filename = os.path.basename(body.filename.replace("\\", "/")).strip()
    filename = "".join(ch for ch in filename if ch.isprintable() and ch not in '<>:"|?*')[:200] or "attachment"
    attachment = TicketAttachment(company_id=req.company_id, ticket_id=req.id, uploaded_by=current_user.id,
                                  filename=filename, content_type=content_type, size=len(data), data=data)
    db.add(attachment)
    _event(db, req, current_user, "ATTACHMENT", note=f"Attached {filename}")
    db.commit()
    db.refresh(attachment)
    return _attachment_response(attachment, {current_user.id: current_user.full_name})


@router.get("/{request_id}/attachments/{attachment_id}")
def download_attachment(
    request_id: str,
    attachment_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id)
):
    """Download a file. Always as a download (never shown inline), with no content sniffing."""
    req = _visible_ticket(db, request_id, current_user, tenant_company_id)
    attachment = db.query(TicketAttachment).filter(
        TicketAttachment.id == attachment_id, TicketAttachment.ticket_id == req.id
    ).first()
    if not attachment:
        raise HTTPException(status_code=404, detail="File not found.")
    return Response(
        content=attachment.data,
        media_type=attachment.content_type,
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{quote(attachment.filename)}",
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "private, no-store",
        },
    )


@router.post("/returns", status_code=status.HTTP_201_CREATED)
def request_asset_return(
    return_in: AssetReturnCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id)
):
    """
    Submit an asset return request for assigned user equipment.
    """
    company_id = tenant_company_id or current_user.company_id

    asset = db.query(Asset).filter(
        Asset.id == return_in.asset_id,
        Asset.company_id == company_id
    ).first()

    if not asset:
        raise HTTPException(status_code=404, detail="Target asset not found.")
    # Only the holder (or an admin) can start a return. New screens use a RETURN ticket instead.
    holder = db.query(AssetAssignment.user_id).filter(
        AssetAssignment.asset_id == asset.id, AssetAssignment.is_active == True
    ).scalar()
    if current_user.role not in _HANDLERS and holder != current_user.id:
        raise HTTPException(status_code=403, detail="You can return only an asset assigned to you.")
    if holder is None:
        raise HTTPException(status_code=400, detail="This asset is not assigned to anyone.")

    return_req = AssetReturnRequest(
        company_id=company_id,
        asset_id=asset.id,
        requested_by=current_user.id,
        reason=return_in.reason,
        condition_on_return=return_in.condition_on_return,
        status=RequestStatusEnum.PENDING
    )
    asset.status = AssetStatusEnum.RETURN_REQUESTED

    db.add(return_req)
    db.commit()
    db.refresh(return_req)

    log_audit_event(
        db=db,
        action="REQUEST_ASSET_RETURN",
        entity="AssetReturnRequest",
        company_id=company_id,
        user_id=current_user.id,
        entity_id=return_req.id
    )

    return {"message": "Asset return request successfully initiated.", "return_request_id": return_req.id}