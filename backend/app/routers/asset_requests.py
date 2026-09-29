"""Implementation file: app/routers/asset_requests.py"""
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user, require_roles, get_tenant_company_id
from app.models.models import (
    AssetRequest, AssetReturnRequest, Asset, AssetAssignment, AssetLifecycle,
    AssetStatusEnum, RequestStatusEnum, PlatformRole, User
)
from app.schemas.schemas import (
    AssetRequestCreate, AssetRequestResponse, AssetRequestUpdate, AssetReturnCreate
)
from app.services.audit_service import log_audit_event

router = APIRouter(prefix="/asset-requests", tags=["Asset Requests"])


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

    new_request = AssetRequest(
        company_id=company_id,
        requested_by=current_user.id,
        asset_category_id=request_in.asset_category_id,
        requested_for=request_in.requested_for or current_user.full_name,
        reason=request_in.reason,
        status=RequestStatusEnum.PENDING
    )
    db.add(new_request)
    db.commit()
    db.refresh(new_request)

    log_audit_event(
        db=db,
        action="CREATE_ASSET_REQUEST",
        entity="AssetRequest",
        company_id=company_id,
        user_id=current_user.id,
        entity_id=new_request.id,
        new_value=f"Category ID: {new_request.asset_category_id}"
    )

    return new_request


@router.get("", response_model=List[AssetRequestResponse])
def list_asset_requests(
    skip: int = 0,
    limit: int = 100,
    status_filter: Optional[RequestStatusEnum] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id)
):
    """
    Retrieve asset requests. Standard users see their own requests; IT/Admins see company-wide requests.
    """
    query = db.query(AssetRequest)
    if current_user.role != PlatformRole.SUPER_ADMIN:
        query = query.filter(AssetRequest.company_id == tenant_company_id)

    if current_user.role == PlatformRole.EMPLOYEE:
        query = query.filter(AssetRequest.requested_by == current_user.id)

    if status_filter:
        query = query.filter(AssetRequest.status == status_filter)

    return query.order_by(AssetRequest.created_at.desc()).offset(skip).limit(limit).all()


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

    if current_user.role == PlatformRole.EMPLOYEE and req.requested_by != current_user.id:
        raise HTTPException(status_code=403, detail="Forbidden context access.")

    return req


@router.put("/{request_id}", response_model=AssetRequestResponse)
def update_asset_request_status(
    request_id: str,
    update_in: AssetRequestUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles([PlatformRole.SUPER_ADMIN, PlatformRole.IT_ADMIN, PlatformRole.SUB_ADMIN])),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id)
):
    """
    Approve or reject an asset request and automatically link assigned hardware if approved.
    """
    query = db.query(AssetRequest).filter(AssetRequest.id == request_id)
    if current_user.role != PlatformRole.SUPER_ADMIN:
        query = query.filter(AssetRequest.company_id == tenant_company_id)

    asset_req = query.first()
    if not asset_req:
        raise HTTPException(status_code=404, detail="Asset request not found.")

    if asset_req.status != RequestStatusEnum.PENDING:
        raise HTTPException(status_code=400, detail="Request has already been processed.")

    old_status = asset_req.status.value
    asset_req.status = update_in.status

    if update_in.status == RequestStatusEnum.APPROVED:
        if not update_in.assigned_asset_id:
            raise HTTPException(
                status_code=400,
                detail="Assigned asset ID is required when approving a request."
            )
        
        asset = db.query(Asset).filter(
            Asset.id == update_in.assigned_asset_id,
            Asset.company_id == asset_req.company_id
        ).first()

        if not asset or asset.status != AssetStatusEnum.IN_STOCK:
            raise HTTPException(
                status_code=400,
                detail="Target asset is not available in stock for assignment."
            )

        asset.status = AssetStatusEnum.ASSIGNED
        asset_req.assigned_asset_id = asset.id

        # Deactivate older assignments and create new user assignment
        db.query(AssetAssignment).filter(
            AssetAssignment.asset_id == asset.id, 
            AssetAssignment.is_active == True
        ).update({"is_active": False})

        new_assignment = AssetAssignment(
            company_id=asset_req.company_id,
            asset_id=asset.id,
            user_id=asset_req.requested_by,
            is_active=True
        )
        db.add(new_assignment)

        # Record Lifecycle history
        lifecycle = AssetLifecycle(
            company_id=asset_req.company_id,
            asset_id=asset.id,
            action="ASSIGNED_VIA_REQUEST",
            previous_status=AssetStatusEnum.IN_STOCK.value,
            new_status=AssetStatusEnum.ASSIGNED.value,
            performed_by=current_user.id,
            remarks=f"Assigned upon request approval ({asset_req.id})."
        )
        db.add(lifecycle)

    elif update_in.status == RequestStatusEnum.REJECTED:
        asset_req.rejection_reason = update_in.rejection_reason or "Request rejected by administrator."

    db.commit()
    db.refresh(asset_req)

    log_audit_event(
        db=db,
        action="PROCESS_ASSET_REQUEST",
        entity="AssetRequest",
        company_id=asset_req.company_id,
        user_id=current_user.id,
        entity_id=asset_req.id,
        old_value=f"Status: {old_status}",
        new_value=f"Status: {asset_req.status.value}"
    )

    return asset_req


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