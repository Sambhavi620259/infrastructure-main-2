"""Implementation file: app/routers/warranty_maintenance.py"""
from typing import List, Literal, Optional
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from pydantic import BaseModel, ConfigDict, Field

from app.core.database import get_db
from app.core.deps import get_current_user, require_roles, get_tenant_company_id
from app.models.models import Asset, PlatformRole, User, WarrantyClaim
from app.services.audit_service import log_audit_event

router = APIRouter(prefix="/warranty-maintenance", tags=["Warranty & SLA Tracking"])

ClaimStatus = Literal["SUBMITTED", "IN_REVIEW", "APPROVED", "REJECTED", "RESOLVED"]
CoverageState = Literal["ACTIVE", "EXPIRING", "EXPIRED", "NONE"]


class WarrantyClaimCreate(BaseModel):
    asset_id: str
    issue_description: str = Field(..., min_length=1)
    claim_number: Optional[str] = Field(None, max_length=100)

class WarrantyClaimUpdate(BaseModel):
    status: ClaimStatus
    resolution_notes: Optional[str] = None

class WarrantyClaimResponse(BaseModel):
    id: str
    company_id: str
    asset_id: str
    asset_tag: Optional[str] = None
    asset_name: Optional[str] = None
    claim_number: Optional[str] = None
    issue_description: str
    status: str
    submitted_by: str
    resolution_notes: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)

class WarrantyCoverageResponse(BaseModel):
    asset_id: str
    asset_tag: str
    name: str
    category: str
    vendor_id: Optional[str] = None
    warranty_start: Optional[datetime] = None
    warranty_end: Optional[datetime] = None
    coverage: CoverageState
    days_remaining: Optional[int] = None


def _company_scope(current_user: User, tenant_company_id: Optional[str]) -> Optional[str]:
    """Company to filter by, or None for Super Admin (global)."""
    company_id = tenant_company_id or current_user.company_id
    if not company_id and current_user.role != PlatformRole.SUPER_ADMIN:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Company context required.")
    return None if current_user.role == PlatformRole.SUPER_ADMIN else company_id


def _coverage_state(warranty_end: Optional[datetime], now: datetime, expiring_days: int) -> CoverageState:
    if warranty_end is None:
        return "NONE"
    if warranty_end < now:
        return "EXPIRED"
    if warranty_end <= now + timedelta(days=expiring_days):
        return "EXPIRING"
    return "ACTIVE"


def _claim_response(claim: WarrantyClaim, asset: Optional[Asset]) -> WarrantyClaimResponse:
    response = WarrantyClaimResponse.model_validate(claim)
    if asset is not None:
        response.asset_tag = asset.asset_tag
        response.asset_name = asset.name
    return response


@router.get("/coverage", response_model=List[WarrantyCoverageResponse])
def list_warranty_coverage(
    coverage: Optional[CoverageState] = None,
    search: Optional[str] = None,
    expiring_days: int = Query(60, ge=1, le=365),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id)
):
    """
    Warranty coverage for every asset, classified as ACTIVE, EXPIRING (within
    expiring_days), EXPIRED or NONE. Soonest expiry first; assets without a
    warranty last.
    """
    company_id = _company_scope(current_user, tenant_company_id)
    now = datetime.utcnow()
    cutoff = now + timedelta(days=expiring_days)

    query = db.query(Asset)
    if company_id:
        query = query.filter(Asset.company_id == company_id)
    if search:
        search_fmt = f"%{search}%"
        query = query.filter(Asset.name.ilike(search_fmt) | Asset.asset_tag.ilike(search_fmt))
    if coverage == "NONE":
        query = query.filter(Asset.warranty_end.is_(None))
    elif coverage == "EXPIRED":
        query = query.filter(Asset.warranty_end < now)
    elif coverage == "EXPIRING":
        query = query.filter(Asset.warranty_end >= now, Asset.warranty_end <= cutoff)
    elif coverage == "ACTIVE":
        query = query.filter(Asset.warranty_end > cutoff)

    assets = (
        query.order_by(Asset.warranty_end.is_(None), Asset.warranty_end.asc())
        .offset(skip)
        .limit(limit)
        .all()
    )
    return [
        WarrantyCoverageResponse(
            asset_id=a.id,
            asset_tag=a.asset_tag,
            name=a.name,
            category=a.category,
            vendor_id=a.vendor_id,
            warranty_start=a.warranty_start,
            warranty_end=a.warranty_end,
            coverage=_coverage_state(a.warranty_end, now, expiring_days),
            days_remaining=(a.warranty_end - now).days if a.warranty_end else None,
        )
        for a in assets
    ]


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
    company_id = _company_scope(current_user, tenant_company_id)
    now = datetime.utcnow()
    cutoff_date = now + timedelta(days=days)

    query = db.query(Asset).filter(
        Asset.warranty_end.isnot(None),
        Asset.warranty_end <= cutoff_date,
        Asset.warranty_end >= now
    )
    if company_id:
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


@router.get("/claims", response_model=List[WarrantyClaimResponse])
def list_warranty_claims(
    claim_status: Optional[ClaimStatus] = Query(None, alias="status"),
    asset_id: Optional[str] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id)
):
    """
    List warranty claims, newest first.
    """
    company_id = _company_scope(current_user, tenant_company_id)

    query = db.query(WarrantyClaim, Asset).outerjoin(Asset, Asset.id == WarrantyClaim.asset_id)
    if company_id:
        query = query.filter(WarrantyClaim.company_id == company_id)
    if claim_status:
        query = query.filter(WarrantyClaim.status == claim_status)
    if asset_id:
        query = query.filter(WarrantyClaim.asset_id == asset_id)

    rows = query.order_by(WarrantyClaim.created_at.desc()).offset(skip).limit(limit).all()
    return [_claim_response(claim, asset) for claim, asset in rows]


@router.post("/claims", response_model=WarrantyClaimResponse, status_code=status.HTTP_201_CREATED)
def submit_warranty_claim(
    claim_in: WarrantyClaimCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles([PlatformRole.SUPER_ADMIN, PlatformRole.IT_ADMIN, PlatformRole.SUB_ADMIN])),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id)
):
    """
    Submit an official warranty repair/replacement claim with vendor.
    """
    company_id = _company_scope(current_user, tenant_company_id)

    asset_query = db.query(Asset).filter(Asset.id == claim_in.asset_id)
    if company_id:
        asset_query = asset_query.filter(Asset.company_id == company_id)

    asset = asset_query.first()
    if not asset:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Asset not found.")

    claim = WarrantyClaim(
        company_id=asset.company_id,
        asset_id=asset.id,
        issue_description=claim_in.issue_description,
        claim_number=claim_in.claim_number,
        status="SUBMITTED",
        submitted_by=current_user.id,
    )
    db.add(claim)
    db.commit()
    db.refresh(claim)

    log_audit_event(
        db=db,
        action="SUBMIT_WARRANTY_CLAIM",
        entity="WarrantyClaim",
        company_id=asset.company_id,
        user_id=current_user.id,
        entity_id=claim.id
    )

    return _claim_response(claim, asset)


@router.put("/claims/{claim_id}", response_model=WarrantyClaimResponse)
def update_warranty_claim(
    claim_id: str,
    claim_in: WarrantyClaimUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles([PlatformRole.SUPER_ADMIN, PlatformRole.IT_ADMIN, PlatformRole.SUB_ADMIN])),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id)
):
    """
    Move a claim through its review states and record resolution notes.
    """
    company_id = _company_scope(current_user, tenant_company_id)

    query = db.query(WarrantyClaim).filter(WarrantyClaim.id == claim_id)
    if company_id:
        query = query.filter(WarrantyClaim.company_id == company_id)
    claim = query.first()
    if not claim:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Warranty claim not found.")

    old_status = claim.status
    claim.status = claim_in.status
    if claim_in.resolution_notes is not None:
        claim.resolution_notes = claim_in.resolution_notes
    db.commit()
    db.refresh(claim)

    log_audit_event(
        db=db,
        action="UPDATE_WARRANTY_CLAIM",
        entity="WarrantyClaim",
        company_id=claim.company_id,
        user_id=current_user.id,
        entity_id=claim.id,
        old_value=f"Status: {old_status}",
        new_value=f"Status: {claim.status}"
    )

    asset = db.query(Asset).filter(Asset.id == claim.asset_id).first()
    return _claim_response(claim, asset)
