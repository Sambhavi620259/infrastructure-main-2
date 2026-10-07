"""Implementation file: app/routers/assets.py"""
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user, require_roles, get_tenant_company_id
from app.models.models import (
    Asset, AssetCategory, AssetAssignment, AssetLifecycle,
    AssetStatusEnum, PlatformRole, User, Subscription
)
from app.schemas.schemas import (
    AssetCreate, AssetResponse, AssetUpdate, AssetAssignRequest,
    AssetCategoryCreate, AssetCategoryResponse, AssetLifecycleResponse
)
from app.services.audit_service import log_audit_event

router = APIRouter(prefix="/assets", tags=["Asset Management"])


# --- Asset Categories ---

@router.post("/categories", response_model=AssetCategoryResponse, status_code=status.HTTP_201_CREATED)
def create_asset_category(
    category_in: AssetCategoryCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles([PlatformRole.SUPER_ADMIN, PlatformRole.IT_ADMIN, PlatformRole.SUB_ADMIN])),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id)
):
    """
    Create a new asset category for item classification.
    """
    company_id = tenant_company_id or current_user.company_id
    if not company_id:
        raise HTTPException(status_code=400, detail="Company context required.")

    category = AssetCategory(
        company_id=company_id,
        name=category_in.name,
        description=category_in.description
    )
    db.add(category)
    db.commit()
    db.refresh(category)
    return category


@router.get("/categories", response_model=List[AssetCategoryResponse])
def list_asset_categories(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id)
):
    """
    Retrieve all asset categories available for the tenant.
    """
    query = db.query(AssetCategory)
    if current_user.role != PlatformRole.SUPER_ADMIN:
        query = query.filter(AssetCategory.company_id == tenant_company_id)
    return query.all()


# --- Asset CRUD Operations ---

@router.post("", response_model=AssetResponse, status_code=status.HTTP_201_CREATED)
def create_asset(
    asset_in: AssetCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles([PlatformRole.SUPER_ADMIN, PlatformRole.IT_ADMIN, PlatformRole.SUB_ADMIN])),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id)
):
    """
    Register a new hardware or digital IT asset and enforce tenant limits.
    """
    company_id = tenant_company_id or current_user.company_id
    if not company_id:
        raise HTTPException(status_code=400, detail="Company context required.")

    # Check tenant subscription asset capacity limit
    subscription = db.query(Subscription).filter(Subscription.company_id == company_id).first()
    if subscription:
        current_asset_count = db.query(Asset).filter(Asset.company_id == company_id).count()
        if current_asset_count >= subscription.asset_limit:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Asset limit ({subscription.asset_limit}) for this organization subscription has been reached."
            )

    # Check unique constraint on Tag and Serial Number
    duplicate = db.query(Asset).filter(
        Asset.company_id == company_id,
        (Asset.asset_tag == asset_in.asset_tag) | (Asset.serial_number == asset_in.serial_number)
    ).first()
    if duplicate:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="An asset with this asset tag or serial number already exists."
        )

    asset = Asset(
        company_id=company_id,
        asset_tag=asset_in.asset_tag,
        serial_number=asset_in.serial_number,
        name=asset_in.name,
        category=asset_in.category,
        type=asset_in.type,
        brand=asset_in.brand,
        model=asset_in.model,
        purchase_date=asset_in.purchase_date,
        purchase_price=asset_in.purchase_price,
        vendor_id=asset_in.vendor_id,
        warranty_start=asset_in.warranty_start,
        warranty_end=asset_in.warranty_end,
        location_id=asset_in.location_id,
        department_id=asset_in.department_id,
        status=asset_in.status,
        condition=asset_in.condition,
        description=asset_in.description,
        created_by=current_user.id
    )
    db.add(asset)
    db.flush()

    # Track lifecycle creation event
    lifecycle = AssetLifecycle(
        company_id=company_id,
        asset_id=asset.id,
        action="CREATED",
        previous_status=None,
        new_status=asset.status.value,
        performed_by=current_user.id,
        remarks="Initial asset creation and registration."
    )
    db.add(lifecycle)
    db.commit()
    db.refresh(asset)

    log_audit_event(
        db=db,
        action="CREATE_ASSET",
        entity="Asset",
        company_id=company_id,
        user_id=current_user.id,
        entity_id=asset.id,
        new_value=f"Tag: {asset.asset_tag}, Name: {asset.name}"
    )

    return asset


@router.get("", response_model=List[AssetResponse])
def list_assets(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    status_filter: Optional[AssetStatusEnum] = Query(None, alias="status"),
    category: Optional[str] = None,
    department_id: Optional[str] = None,
    search: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id)
):
    """
    List assets with multi-parameter filtering and search capability.
    """
    query = db.query(Asset)
    if current_user.role != PlatformRole.SUPER_ADMIN:
        query = query.filter(Asset.company_id == tenant_company_id)

    if status_filter:
        query = query.filter(Asset.status == status_filter)
    if category:
        query = query.filter(Asset.category == category)
    if department_id:
        query = query.filter(Asset.department_id == department_id)
    if search:
        search_fmt = f"%{search}%"
        query = query.filter(
            (Asset.name.ilike(search_fmt)) |
            (Asset.asset_tag.ilike(search_fmt)) |
            (Asset.serial_number.ilike(search_fmt))
        )

    return query.offset(skip).limit(limit).all()


@router.get("/{asset_id}", response_model=AssetResponse)
def get_asset(
    asset_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id)
):
    """
    Retrieve full asset details.
    """
    query = db.query(Asset).filter(Asset.id == asset_id)
    if current_user.role != PlatformRole.SUPER_ADMIN:
        query = query.filter(Asset.company_id == tenant_company_id)

    asset = query.first()
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found.")
    return asset


@router.put("/{asset_id}", response_model=AssetResponse)
def update_asset(
    asset_id: str,
    asset_in: AssetUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles([PlatformRole.SUPER_ADMIN, PlatformRole.IT_ADMIN, PlatformRole.SUB_ADMIN])),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id)
):
    """
    Update asset properties and automatically record status lifecycle changes.
    """
    query = db.query(Asset).filter(Asset.id == asset_id)
    if current_user.role != PlatformRole.SUPER_ADMIN:
        query = query.filter(Asset.company_id == tenant_company_id)

    asset = query.first()
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found.")

    old_status = asset.status.value
    update_data = asset_in.dict(exclude_unset=True)

    for field, value in update_data.items():
        setattr(asset, field, value)

    if asset_in.status and asset_in.status.value != old_status:
        lifecycle = AssetLifecycle(
            company_id=asset.company_id,
            asset_id=asset.id,
            action="STATUS_CHANGE",
            previous_status=old_status,
            new_status=asset.status.value,
            performed_by=current_user.id,
            remarks=f"Asset status updated manually from {old_status} to {asset.status.value}."
        )
        db.add(lifecycle)

    db.commit()
    db.refresh(asset)

    log_audit_event(
        db=db,
        action="UPDATE_ASSET",
        entity="Asset",
        company_id=asset.company_id,
        user_id=current_user.id,
        entity_id=asset.id,
        old_value=f"Status: {old_status}",
        new_value=f"Status: {asset.status.value}"
    )

    return asset


@router.post("/{asset_id}/assign", response_model=AssetResponse)
def assign_asset_to_user(
    asset_id: str,
    assign_in: AssetAssignRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles([PlatformRole.SUPER_ADMIN, PlatformRole.IT_ADMIN, PlatformRole.SUB_ADMIN])),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id)
):
    """
    Assign an available asset to an employee.
    """
    query = db.query(Asset).filter(Asset.id == asset_id)
    if current_user.role != PlatformRole.SUPER_ADMIN:
        query = query.filter(Asset.company_id == tenant_company_id)

    asset = query.first()
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found.")

    if asset.status not in [AssetStatusEnum.IN_STOCK, AssetStatusEnum.REQUESTED]:
        raise HTTPException(
            status_code=400, 
            detail=f"Asset cannot be assigned because its status is currently {asset.status.value}."
        )

    target_user = db.query(User).filter(User.id == assign_in.user_id, User.status == "ACTIVE").first()
    if not target_user:
        raise HTTPException(status_code=404, detail="Target active user not found.")

    old_status = asset.status.value
    asset.status = AssetStatusEnum.ASSIGNED

    db.query(AssetAssignment).filter(
        AssetAssignment.asset_id == asset.id, 
        AssetAssignment.is_active == True
    ).update({"is_active": False})

    new_assignment = AssetAssignment(
        company_id=asset.company_id,
        asset_id=asset.id,
        user_id=target_user.id,
        is_active=True
    )
    db.add(new_assignment)

    lifecycle = AssetLifecycle(
        company_id=asset.company_id,
        asset_id=asset.id,
        action="ASSIGNED",
        previous_status=old_status,
        new_status=asset.status.value,
        performed_by=current_user.id,
        remarks=f"Assigned directly to user {target_user.full_name} ({target_user.email})."
    )
    db.add(lifecycle)

    db.commit()
    db.refresh(asset)

    log_audit_event(
        db=db,
        action="ASSIGN_ASSET",
        entity="Asset",
        company_id=asset.company_id,
        user_id=current_user.id,
        entity_id=asset.id,
        new_value=f"Assigned To User ID: {target_user.id}"
    )

    return asset


@router.post("/{asset_id}/unassign", response_model=AssetResponse)
def unassign_asset(
    asset_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles([PlatformRole.SUPER_ADMIN, PlatformRole.IT_ADMIN, PlatformRole.SUB_ADMIN])),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id)
):
    """
    Unassign an asset and return it to active inventory stock.
    """
    query = db.query(Asset).filter(Asset.id == asset_id)
    if current_user.role != PlatformRole.SUPER_ADMIN:
        query = query.filter(Asset.company_id == tenant_company_id)

    asset = query.first()
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found.")

    old_status = asset.status.value
    asset.status = AssetStatusEnum.IN_STOCK

    db.query(AssetAssignment).filter(
        AssetAssignment.asset_id == asset.id, 
        AssetAssignment.is_active == True
    ).update({"is_active": False})

    lifecycle = AssetLifecycle(
        company_id=asset.company_id,
        asset_id=asset.id,
        action="UNASSIGNED",
        previous_status=old_status,
        new_status=asset.status.value,
        performed_by=current_user.id,
        remarks="Returned to inventory stock."
    )
    db.add(lifecycle)

    db.commit()
    db.refresh(asset)

    return asset


@router.get("/{asset_id}/lifecycle", response_model=List[AssetLifecycleResponse])
def get_asset_lifecycle_history(
    asset_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id)
):
    """
    Retrieve complete lifecycle history audit for a specific asset.
    """
    query = db.query(AssetLifecycle).filter(AssetLifecycle.asset_id == asset_id)
    if current_user.role != PlatformRole.SUPER_ADMIN:
        query = query.filter(AssetLifecycle.company_id == tenant_company_id)

    return query.order_by(AssetLifecycle.timestamp.desc()).all()