"""Implementation file: app/routers/asset_requests.py"""
from datetime import datetime
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user, require_roles, get_tenant_company_id
from app.models.models import (
    AssetRequest, AssetReturnRequest, Asset, AssetAssignment, AssetCategory, AssetLifecycle, Department,
    AssetStatusEnum, RequestStatusEnum, PlatformRole, User
)
from app.schemas.schemas import (
    AssetRequestCreate, AssetRequestResponse, AssetRequestUpdate, AssetReturnCreate
)
from app.services.audit_service import log_audit_event
from app.services.notification_service import home_link, notify, notify_company

router = APIRouter(prefix="/asset-requests", tags=["Asset Requests"])

# IT Agents (stored as EMPLOYEE) work the ticket queue alongside admins.
_operators = require_roles([
    PlatformRole.SUPER_ADMIN, PlatformRole.IT_ADMIN, PlatformRole.SUB_ADMIN, PlatformRole.EMPLOYEE,
])


def _with_names(db: Session, requests: List[AssetRequest]) -> List[AssetRequestResponse]:
    """Attach requester, category and assigned-asset names in three batched lookups."""
    user_ids = (
        {r.requested_by for r in requests}
        | {r.processed_by for r in requests if r.processed_by}
        | {r.raised_by for r in requests if r.raised_by}
    )
    category_ids = {r.asset_category_id for r in requests}
    asset_ids = {r.assigned_asset_id for r in requests if r.assigned_asset_id}
    users = dict(db.query(User.id, User.full_name).filter(User.id.in_(user_ids)).all()) if user_ids else {}
    categories = (
        dict(db.query(AssetCategory.id, AssetCategory.name).filter(AssetCategory.id.in_(category_ids)).all())
        if category_ids else {}
    )
    tags = dict(db.query(Asset.id, Asset.asset_tag).filter(Asset.id.in_(asset_ids)).all()) if asset_ids else {}
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
    if request_in.requested_for_user_id and request_in.requested_for_user_id != current_user.id:
        requester = db.query(User).filter(
            User.id == request_in.requested_for_user_id,
            User.company_id == company_id,
            User.status == "ACTIVE",
        ).first()
        if not requester:
            raise HTTPException(status_code=404, detail="That user is not an active member of your organization.")

    category = db.query(AssetCategory.id).filter(
        AssetCategory.id == request_in.asset_category_id, AssetCategory.company_id == company_id
    ).first()
    if not category:
        raise HTTPException(status_code=400, detail="Unknown asset category.")

    if request_in.department_id and not db.query(Department.id).filter(
        Department.id == request_in.department_id, Department.company_id == company_id
    ).first():
        raise HTTPException(status_code=400, detail="Unknown department.")

    new_request = AssetRequest(
        company_id=company_id,
        requested_by=requester.id,
        raised_by=current_user.id,
        asset_category_id=request_in.asset_category_id,
        department_id=request_in.department_id or None,
        requested_for=request_in.requested_for or requester.full_name,
        reason=request_in.reason,
        status=RequestStatusEnum.PENDING
    )
    db.add(new_request)
    notify_company(
        db, company_id, [PlatformRole.IT_ADMIN, PlatformRole.SUB_ADMIN, PlatformRole.EMPLOYEE],
        title=f"New ticket from {requester.full_name}",
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
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id)
):
    """
    Company-wide ticket queue, newest first. mine=true limits it to tickets
    the caller raised.
    """
    query = db.query(AssetRequest)
    if current_user.role != PlatformRole.SUPER_ADMIN:
        query = query.filter(AssetRequest.company_id == tenant_company_id)

    if mine:
        query = query.filter(AssetRequest.requested_by == current_user.id)
    if requested_by:
        query = query.filter(AssetRequest.requested_by == requested_by)
    if raised_by:
        query = query.filter(AssetRequest.raised_by == raised_by)
    if processed_by:
        query = query.filter(AssetRequest.processed_by == processed_by)

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


def _hand_over_asset(db: Session, asset_req: AssetRequest, asset_id: Optional[str], actor: User) -> Asset:
    """Assign an in-stock asset to the ticket's requester and record it in the asset history."""
    if not asset_id:
        raise HTTPException(status_code=400, detail="Choose the asset to hand over.")
    asset = db.query(Asset).filter(Asset.id == asset_id, Asset.company_id == asset_req.company_id).first()
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
    current_user: User = Depends(_operators),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id)
):
    """
    Move a ticket along as it is worked:
    PENDING -> IN_PROGRESS (someone picks it up; PENDING again releases it)
    -> APPROVED (agreed, waiting for stock) -> FULFILLED (asset handed over).
    REJECTED (needs a reason) and CANCELLED close it early.
    Approving with an asset hands it over at once, so the ticket is FULFILLED.
    """
    query = db.query(AssetRequest).filter(AssetRequest.id == request_id)
    if current_user.role != PlatformRole.SUPER_ADMIN:
        query = query.filter(AssetRequest.company_id == tenant_company_id)

    asset_req = query.first()
    if not asset_req:
        raise HTTPException(status_code=404, detail="Asset request not found.")

    new_status = update_in.status
    if new_status == RequestStatusEnum.APPROVED and update_in.assigned_asset_id:
        new_status = RequestStatusEnum.FULFILLED

    old_status = asset_req.status
    if new_status not in _NEXT_STATUS.get(old_status, set()):
        if old_status not in _NEXT_STATUS:
            raise HTTPException(status_code=400, detail=f"This ticket is already {old_status.value.lower()}.")
        raise HTTPException(
            status_code=400,
            detail=f"A {old_status.value.lower().replace('_', ' ')} ticket cannot be moved to {new_status.value.lower().replace('_', ' ')}.",
        )
    if new_status == RequestStatusEnum.REJECTED and not (update_in.rejection_reason or "").strip():
        raise HTTPException(status_code=400, detail="Give a reason for rejecting the ticket.")

    asset = None
    if new_status == RequestStatusEnum.FULFILLED:
        asset = _hand_over_asset(db, asset_req, update_in.assigned_asset_id, current_user)
    if new_status == RequestStatusEnum.REJECTED:
        asset_req.rejection_reason = update_in.rejection_reason.strip()

    asset_req.status = new_status
    if new_status == RequestStatusEnum.PENDING:
        # Released back to the queue: nobody is handling it now.
        asset_req.processed_by = None
        asset_req.processed_at = None
    else:
        asset_req.processed_by = current_user.id
        asset_req.processed_at = datetime.utcnow()

    requester = db.query(User).filter(User.id == asset_req.requested_by).first()
    notice = _REQUESTER_NOTICE.get(new_status)
    if requester and notice and requester.id != current_user.id:
        title, message, kind = notice
        notify(
            db, requester,
            title=title,
            message=message.format(
                actor=current_user.full_name,
                asset=f"{asset.asset_tag} ({asset.name})" if asset else "an asset",
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