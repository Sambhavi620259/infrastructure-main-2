"""Implementation file: app/routers/asset_requests.py"""
from datetime import datetime
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user, require_roles, get_tenant_company_id
from app.models.models import (
    AssetRequest, AssetReturnRequest, Asset, AssetAssignment, AssetCategory, AssetLifecycle, Department,
    AssetStatusEnum, RequestStatusEnum, PlatformRole, Software, SoftwareLicenseAssignment, User
)
from app.services.approval_service import TICKET_REQUEST_TYPE, require_approver
from app.services.software_service import assign_seat
from app.services.stock_service import record_movement
from app.schemas.schemas import (
    AssetRequestCreate, AssetRequestResponse, AssetRequestUpdate, AssetReturnCreate, TicketAsset
)
from app.services.audit_service import log_audit_event
from app.services.notification_service import home_link, notify, notify_company

router = APIRouter(prefix="/asset-requests", tags=["Asset Requests"])

# Admins work the ticket queue. Users (stored as EMPLOYEE) raise tickets,
# see only their own, and may cancel their own while it is open.
_HANDLERS = {PlatformRole.SUPER_ADMIN, PlatformRole.IT_ADMIN, PlatformRole.SUB_ADMIN}


def _own_tickets(query, user: User):
    """Limit a ticket query to the ones a user raised or that are for them."""
    return query.filter(or_(AssetRequest.requested_by == user.id, AssetRequest.raised_by == user.id))


def _with_names(db: Session, requests: List[AssetRequest]) -> List[AssetRequestResponse]:
    """Attach requester, category and assigned-asset names in three batched lookups."""
    user_ids = (
        {r.requested_by for r in requests}
        | {r.processed_by for r in requests if r.processed_by}
        | {r.raised_by for r in requests if r.raised_by}
    )
    category_ids = {r.asset_category_id for r in requests if r.asset_category_id}
    asset_ids = {r.assigned_asset_id for r in requests if r.assigned_asset_id}
    users = dict(db.query(User.id, User.full_name).filter(User.id.in_(user_ids)).all()) if user_ids else {}
    categories = (
        dict(db.query(AssetCategory.id, AssetCategory.name).filter(AssetCategory.id.in_(category_ids)).all())
        if category_ids else {}
    )
    tags = dict(db.query(Asset.id, Asset.asset_tag).filter(Asset.id.in_(asset_ids)).all()) if asset_ids else {}
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
        response.software_name = software_names.get(req.software_id)
        if response.software_name and not response.category_name:
            response.category_name = "Software"
        asset = issue_assets.get(req.asset_id)
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
    Submit a new asset requisition request.
    """
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
    category_id = request_in.asset_category_id
    if request_in.ticket_type in ("ISSUE", "RETURN"):
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
        if not software:
            raise HTTPException(status_code=400, detail="Choose the software you need.")
        if db.query(SoftwareLicenseAssignment.id).filter(
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
        requested_by=requester.id,
        raised_by=current_user.id,
        ticket_type=request_in.ticket_type,
        asset_id=issue_asset.id if issue_asset else None,
        software_id=software.id if software else None,
        asset_category_id=category_id,
        department_id=request_in.department_id or None,
        requested_for=request_in.requested_for or requester.full_name,
        reason=request_in.reason,
        status=RequestStatusEnum.PENDING
    )
    db.add(new_request)
    notify_company(
        db, company_id, [PlatformRole.IT_ADMIN, PlatformRole.SUB_ADMIN],
        title=(
            f"Problem reported with {issue_asset.label} by {requester.full_name}" if request_in.ticket_type == "ISSUE"
            else f"{requester.full_name} wants to return {issue_asset.label}" if request_in.ticket_type == "RETURN"
            else f"{requester.full_name} requested {software.name}" if software
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
        new_value=f"Ticket for {requester.full_name}: {new_request.reason[:120]}"
    )

    return _with_names(db, [new_request])[0]


@router.get("", response_model=List[AssetRequestResponse])
def list_asset_requests(
    skip: int = 0,
    limit: int = 100,
    status_filter: Optional[RequestStatusEnum] = Query(None, alias="status"),
    mine: bool = False,
    requested_by: Optional[str] = None,
    raised_by: Optional[str] = None,
    processed_by: Optional[str] = None,
    asset_id: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id)
):
    """
    Company-wide ticket queue, newest first. mine=true limits it to tickets
    the caller raised. Users only ever see their own tickets.
    """
    query = db.query(AssetRequest)
    if current_user.role != PlatformRole.SUPER_ADMIN:
        query = query.filter(AssetRequest.company_id == tenant_company_id)
    if current_user.role == PlatformRole.EMPLOYEE:
        query = _own_tickets(query, current_user)

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
        query = query.filter(AssetRequest.status == status_filter)

    return _with_names(db, query.order_by(AssetRequest.created_at.desc()).offset(skip).limit(limit).all())


@router.get("/counts")
def get_ticket_counts(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id)
):
    """
    Get ticket counts for dashboard badges.
    """
    company_id = tenant_company_id or current_user.company_id
    if not company_id and current_user.role != PlatformRole.SUPER_ADMIN:
        raise HTTPException(status_code=400, detail="Company context required")

    base = db.query(AssetRequest)
    if current_user.role != PlatformRole.SUPER_ADMIN:
        base = base.filter(AssetRequest.company_id == company_id)
    if current_user.role == PlatformRole.EMPLOYEE:
        base = _own_tickets(base, current_user)

    return {
        "pending": base.filter(AssetRequest.status == RequestStatusEnum.PENDING).count(),
        "in_progress": base.filter(AssetRequest.status == RequestStatusEnum.IN_PROGRESS).count(),
        # Approved but waiting for stock.
        "approved": base.filter(AssetRequest.status == RequestStatusEnum.APPROVED).count(),
        "fulfilled": base.filter(AssetRequest.status == RequestStatusEnum.FULFILLED).count(),
        # Every ticket still being worked: pending, in progress or approved.
        "open": base.filter(AssetRequest.status.in_(OPEN_TICKET_STATUSES)).count(),
        "my_open": base.filter(
            AssetRequest.requested_by == current_user.id,
            AssetRequest.status.in_(OPEN_TICKET_STATUSES)
        ).count(),
    }


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
    query = db.query(AssetRequest).filter(AssetRequest.id == request_id)
    if current_user.role != PlatformRole.SUPER_ADMIN:
        query = query.filter(AssetRequest.company_id == tenant_company_id)
    if current_user.role == PlatformRole.EMPLOYEE:
        query = _own_tickets(query, current_user)

    req = query.first()
    if not req:
        raise HTTPException(status_code=404, detail="Asset request not found.")

    return _with_names(db, [req])[0]


# Where a ticket may go next. FULFILLED, REJECTED and CANCELLED are final.
_NEXT_STATUS = {
    RequestStatusEnum.PENDING: {
        RequestStatusEnum.IN_PROGRESS, RequestStatusEnum.APPROVED, RequestStatusEnum.FULFILLED,
        RequestStatusEnum.REJECTED, RequestStatusEnum.CANCELLED,
    },
    RequestStatusEnum.IN_PROGRESS: {
        RequestStatusEnum.PENDING, RequestStatusEnum.APPROVED, RequestStatusEnum.FULFILLED,
        RequestStatusEnum.REJECTED, RequestStatusEnum.CANCELLED,
    },
    RequestStatusEnum.APPROVED: {RequestStatusEnum.FULFILLED, RequestStatusEnum.CANCELLED},
}
OPEN_TICKET_STATUSES = list(_NEXT_STATUS)

# What the requester is told at each step: (title, message, notification type).
_REQUESTER_NOTICE = {
    RequestStatusEnum.IN_PROGRESS: ("Your ticket is being worked on", "{actor} has started working on it.", "INFO"),
    RequestStatusEnum.APPROVED: ("Your ticket was approved", "{actor} approved it. The asset will be assigned when stock is available.", "SUCCESS"),
    RequestStatusEnum.FULFILLED: ("Your ticket is fulfilled", "{actor} assigned you {asset}.", "SUCCESS"),
    RequestStatusEnum.REJECTED: ("Your ticket was rejected", "{actor}: {reason}", "WARNING"),
    RequestStatusEnum.CANCELLED: ("Your ticket was cancelled", "{actor} cancelled it.", "INFO"),
}


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
    # Locked and re-checked now: approval alone does not reserve stock.
    asset = db.query(Asset).filter(Asset.id == asset_id, Asset.company_id == asset_req.company_id) \
        .with_for_update().first()
    if not asset or asset.status not in (AssetStatusEnum.IN_STOCK, AssetStatusEnum.REQUESTED):
        raise HTTPException(status_code=400, detail="That asset is not available in stock.")

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
    Move a ticket along as it is worked:
    PENDING -> IN_PROGRESS (someone picks it up; PENDING again releases it)
    -> APPROVED (agreed, waiting for stock) -> FULFILLED (asset handed over).
    REJECTED (needs a reason) and CANCELLED close it early.
    Approving with an asset hands it over at once, so the ticket is FULFILLED.
    Only admins move tickets; a user may only cancel their own open ticket.
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
    if not is_handler and update_in.status != RequestStatusEnum.CANCELLED:
        raise HTTPException(status_code=403, detail="Only an IT Admin can work on tickets. You can cancel your own ticket.")

    new_status = update_in.status
    if new_status == RequestStatusEnum.APPROVED and update_in.assigned_asset_id:
        new_status = RequestStatusEnum.FULFILLED

    old_status = asset_req.status
    is_issue = asset_req.ticket_type == "ISSUE"
    if is_issue and new_status == RequestStatusEnum.APPROVED:
        raise HTTPException(status_code=400, detail="A problem ticket is resolved, not approved. Resolve it with a note.")
    if new_status not in _NEXT_STATUS.get(old_status, set()):
        if old_status not in _NEXT_STATUS:
            raise HTTPException(status_code=400, detail=f"This ticket is already {old_status.value.lower()}.")
        raise HTTPException(
            status_code=400,
            detail=f"A {old_status.value.lower().replace('_', ' ')} ticket cannot be moved to {new_status.value.lower().replace('_', ' ')}.",
        )
    if new_status == RequestStatusEnum.REJECTED and not (update_in.rejection_reason or "").strip():
        raise HTTPException(status_code=400, detail="Give a reason for rejecting the ticket.")
    # Decisions follow the organization's approval rule for this kind of request.
    if is_handler and new_status in (RequestStatusEnum.APPROVED, RequestStatusEnum.REJECTED, RequestStatusEnum.FULFILLED):
        # The requester is the person the ticket is for: an admin may raise one on someone's
        # behalf and approve it, but may not approve a ticket for themselves.
        require_approver(db, current_user, asset_req.company_id, TICKET_REQUEST_TYPE.get(asset_req.ticket_type, "ASSET"),
                         [asset_req.requested_by])

    asset = None
    software_name = None
    ticket_type = asset_req.ticket_type
    if ticket_type == "RETURN" and new_status == RequestStatusEnum.APPROVED:
        asset = _lock_held_asset(db, asset_req)
        _set_status(db, asset, AssetStatusEnum.RETURN_REQUESTED, current_user, "Return approved; waiting for the device.")
    if ticket_type == "RETURN" and old_status == RequestStatusEnum.APPROVED and new_status in (
        RequestStatusEnum.REJECTED, RequestStatusEnum.CANCELLED
    ):
        held = db.query(Asset).filter(Asset.id == asset_req.asset_id).with_for_update().first()
        if held and held.status == AssetStatusEnum.RETURN_REQUESTED:
            _set_status(db, held, AssetStatusEnum.ASSIGNED, current_user, "Return withdrawn; the device stays with its holder.")

    if new_status == RequestStatusEnum.FULFILLED and ticket_type == "SOFTWARE":
        # Re-check seat availability at fulfilment, under a lock (approval alone grants nothing).
        software = db.query(Software).filter(Software.id == asset_req.software_id).first()
        requester = db.query(User).filter(User.id == asset_req.requested_by).first()
        if not software or not requester:
            raise HTTPException(status_code=400, detail="The software or the requester no longer exists.")
        seat = assign_seat(db, software, requester, current_user, license_id=update_in.license_id)
        asset_req.license_assignment_id = seat.id
        software_name = software.name
    elif new_status == RequestStatusEnum.FULFILLED and ticket_type == "RETURN":
        if not update_in.return_condition:
            raise HTTPException(status_code=400, detail="Confirm the condition the device came back in.")
        asset = _lock_held_asset(db, asset_req)
        _receive_return(db, asset, update_in.return_condition, current_user)
        asset_req.return_condition = update_in.return_condition
    elif new_status == RequestStatusEnum.FULFILLED and is_issue:
        # Resolving a problem: record what was done; the asset stays with the user.
        note = (update_in.resolution_note or "").strip()
        if not note:
            raise HTTPException(status_code=400, detail="Describe how the problem was resolved.")
        asset_req.resolution_note = note
        asset = db.query(Asset).filter(Asset.id == asset_req.asset_id).first()
    elif new_status == RequestStatusEnum.FULFILLED:
        asset = _hand_over_asset(db, asset_req, update_in.assigned_asset_id, current_user)
    if new_status == RequestStatusEnum.REJECTED:
        asset_req.rejection_reason = update_in.rejection_reason.strip()

    previous_handler = asset_req.processed_by
    asset_req.status = new_status
    if new_status == RequestStatusEnum.PENDING:
        # Released back to the queue: nobody is handling it now.
        asset_req.processed_by = None
        asset_req.processed_at = None
    else:
        asset_req.processed_by = current_user.id
        asset_req.processed_at = datetime.utcnow()

    # A user withdrawing a ticket someone is already working on: tell that admin.
    if not is_handler and previous_handler and previous_handler != current_user.id:
        handler = db.query(User).filter(User.id == previous_handler).first()
        if handler:
            notify(
                db, handler,
                title=f"{current_user.full_name} cancelled ticket #{asset_req.id[:6].upper()}",
                message=asset_req.reason[:200],
                link=home_link(handler, "/tickets", "/agent/tickets"),
                type="INFO",
            )

    requester = db.query(User).filter(User.id == asset_req.requested_by).first()
    notice = _REQUESTER_NOTICE.get(new_status)
    if ticket_type == "SOFTWARE" and new_status == RequestStatusEnum.FULFILLED:
        notice = (f"You now have {software_name}", "{actor} assigned you a seat. It is listed under My Software.", "SUCCESS")
    if ticket_type == "RETURN" and new_status == RequestStatusEnum.FULFILLED:
        notice = (f"Return of {asset.label} confirmed", "{actor} received the device. Thank you.", "SUCCESS")
    if is_issue and new_status == RequestStatusEnum.FULFILLED:
        notice = (f"Your problem with {asset.label if asset else 'your asset'} is resolved",
                  "{actor}: " + asset_req.resolution_note.replace("{", "(").replace("}", ")"), "SUCCESS")
    if requester and notice and requester.id != current_user.id:
        title, message, kind = notice
        notify(
            db, requester,
            title=title,
            message=message.format(
                actor=current_user.full_name,
                asset=f"{asset.label} ({asset.name})" if asset else "an asset",
                reason=asset_req.rejection_reason,
            )[:300],
            link=home_link(requester, "/tickets/mine", "/agent/tickets"),
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
        new_value=f"Ticket #{asset_req.id[:6].upper()} {new_status.value.lower().replace('_', ' ')}"
    )

    return _with_names(db, [asset_req])[0]


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