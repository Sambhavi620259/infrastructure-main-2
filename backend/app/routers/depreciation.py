from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user, require_roles, get_tenant_company_id
from app.models.models import Asset, DepreciationSchedule, PlatformRole, User
from app.schemas.schemas import (
    DepreciationCalculateRequest, DepreciationResponse, DepreciationScheduleResponse
)
from app.services.audit_service import log_audit_event
from app.services.depreciation_service import calculate_asset_depreciation

router = APIRouter(prefix="/depreciation", tags=["Depreciation Engine"])


@router.post("/calculate/{asset_id}", response_model=DepreciationResponse)
def calculate_depreciation_for_asset(
    asset_id: str,
    calc_in: Optional[DepreciationCalculateRequest] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles([PlatformRole.SUPER_ADMIN, PlatformRole.IT_ADMIN, PlatformRole.SUB_ADMIN])),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id)
):
    """
    Calculate current asset financial book value and remaining salvage balance using configured method (Straight-Line, Declining Balance).
    """
    query = db.query(Asset).filter(Asset.id == asset_id)
    if current_user.role != PlatformRole.SUPER_ADMIN:
        query = query.filter(Asset.company_id == tenant_company_id)

    asset = query.first()
    if not asset:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Target asset not found."
        )

    method = calc_in.method if calc_in and calc_in.method else asset.depreciation_method or "STRAIGHT_LINE"
    useful_years = calc_in.useful_life_years if calc_in and calc_in.useful_life_years else asset.useful_life_years or 5
    salvage_val = calc_in.salvage_value if calc_in and calc_in.salvage_value is not None else asset.salvage_value or 0.0

    depreciation_result = calculate_asset_depreciation(
        purchase_cost=asset.cost,
        purchase_date=asset.purchase_date,
        salvage_value=salvage_val,
        useful_life_years=useful_years,
        method=method
    )

    # Update asset cached values
    asset.current_value = depreciation_result["current_value"]
    db.commit()
    db.refresh(asset)

    log_audit_event(
        db=db,
        action="CALCULATE_DEPRECIATION",
        entity="Asset",
        company_id=asset.company_id,
        user_id=current_user.id,
        entity_id=asset.id,
        new_value=f"Current Value: {asset.current_value}"
    )

    return DepreciationResponse(
        asset_id=asset.id,
        original_cost=asset.cost,
        salvage_value=salvage_val,
        current_value=depreciation_result["current_value"],
        total_depreciated=depreciation_result["total_depreciated"],
        annual_depreciation=depreciation_result["annual_depreciation"],
        method=method,
        years_in_service=depreciation_result["years_in_service"]
    )


@router.get("/schedule/{asset_id}", response_model=List[DepreciationScheduleResponse])
def get_depreciation_schedule(
    asset_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id)
):
    """
    Retrieve or generate multi-year depreciation schedule breakdown for an asset.
    """
    query = db.query(Asset).filter(Asset.id == asset_id)
    if current_user.role != PlatformRole.SUPER_ADMIN:
        query = query.filter(Asset.company_id == tenant_company_id)

    asset = query.first()
    if not asset:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Target asset not found."
        )

    schedules = db.query(DepreciationSchedule).filter(
        DepreciationSchedule.asset_id == asset.id
    ).order_by(DepreciationSchedule.year.asc()).all()

    return schedules


@router.post("/batch-recalculate", status_code=status.HTTP_200_OK)
def batch_recalculate_depreciation(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles([PlatformRole.SUPER_ADMIN, PlatformRole.IT_ADMIN])),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id)
):
    """
    Trigger bulk depreciation recalculation across all company hardware assets.
    """
    company_id = tenant_company_id or current_user.company_id
    if not company_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Valid company context is required."
        )

    assets = db.query(Asset).filter(Asset.company_id == company_id).all()
    updated_count = 0

    for asset in assets:
        if asset.cost and asset.purchase_date:
            method = asset.depreciation_method or "STRAIGHT_LINE"
            useful_years = asset.useful_life_years or 5
            salvage_val = asset.salvage_value or 0.0

            result = calculate_asset_depreciation(
                purchase_cost=asset.cost,
                purchase_date=asset.purchase_date,
                salvage_value=salvage_val,
                useful_life_years=useful_years,
                method=method
            )
            asset.current_value = result["current_value"]
            updated_count += 1

    db.commit()

    log_audit_event(
        db=db,
        action="BATCH_DEPRECIATION_RECALCULATION",
        entity="Company",
        company_id=company_id,
        user_id=current_user.id,
        entity_id=company_id,
        new_value=f"Recalculated items: {updated_count}"
    )

    return {
        "message": "Batch depreciation recalculation complete.",
        "assets_updated": updated_count
    }