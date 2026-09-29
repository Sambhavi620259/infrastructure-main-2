"""Implementation file: app/routers/warranty_maintenance.py"""
from typing import List, Optional
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from pydantic import BaseModel

from app.core.database import get_db
from app.core.deps import get_current_user, require_roles, get_tenant_company_id
from app.models.models import Asset, WarrantyClaim, PlatformRole, User
from app.services.audit_service import log_audit_event

router = APIRouter(prefix="/warranty-maintenance", tags=["Warranty & SLA Tracking"])


class WarrantyClaimCreate(BaseModel):
    asset_id: str
    issue_description: str
    claim_number: Optional[str] = None

class WarrantyClaimResponse(BaseModel):
    id: str
    company_id: str
    asset_id: str
    issue_description: str
    status: str
    created_at: datetime

    class Config:
        orm_mode = True


@router.get("/expiring-assets")
def list_expiring_warranties(
    days: int = 60,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id)
):
    """
    Fetch hardware assets whose manufacturer warranties are expiring within the specified days.
    """
    company_id = tenant_company_id or current_user.company_id
    cutoff_date = datetime.utcnow() + timedelta(days=days)

    query = db.query(Asset).filter(
        Asset.warranty_end.isnot(None),
        Asset.warranty_end <= cutoff_date,
        Asset.warranty_end >= datetime.utcnow()
    )

    if current_user.role != PlatformRole.SUPER_ADMIN:
        query = query.filter(Asset.company_id == company_id)

    assets = query.all()
    return [
        {
            "asset_id": a.id,
            "asset_tag": a.asset_tag,
            "name": a.name,
            "warranty_end": a.warranty_end,
            "vendor_id": a.vendor_id
        }
        for a in assets
    ]


@router.post("/claims", response_model=WarrantyClaimResponse, status_code=status.HTTP_201_CREATED)
def submit_warranty_claim(
    claim_in: WarrantyClaimCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles([PlatformRole.SUPER_ADMIN, PlatformRole.IT_ADMIN, PlatformRole.SUB_ADMIN])),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id)
):
    """
    Submit a official warranty repair/replacement claim with vendor.
    """
    company_id = tenant_company_id or current_user.company_id

    asset = db.query(Asset).filter(Asset.id == claim_in.asset_id).first()
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found.")

    claim = WarrantyClaim(
        company_id=company_id,
        asset_id=asset.id,
        issue_description=claim_in.issue_description,
        claim_number=claim_in.claim_number,
        status="SUBMITTED"
    )
    db.add(claim)
    db.commit()
    db.refresh(claim)

    log_audit_event(
        db=db,
        action="SUBMIT_WARRANTY_CLAIM",
        entity="WarrantyClaim",
        company_id=company_id,
        user_id=current_user.id,
        entity_id=claim.id
    )

    return claim