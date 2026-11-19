"""Implementation file: app/routers/vendors.py"""
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user, require_roles, get_tenant_company_id
from app.models.models import Asset, Maintenance, PlatformRole, PurchaseOrder, User, Vendor
from app.schemas.schemas import VendorCreate, VendorResponse, VendorUpdate
from app.services.audit_service import log_audit_event

router = APIRouter(prefix="/vendors", tags=["Vendor Management"])


@router.post("", response_model=VendorResponse, status_code=status.HTTP_201_CREATED)
def create_vendor(
    vendor_in: VendorCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles([PlatformRole.SUPER_ADMIN, PlatformRole.IT_ADMIN, PlatformRole.SUB_ADMIN])),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id)
):
    """
    Register a new procurement vendor or supplier.
    """
    company_id = tenant_company_id or current_user.company_id
    if not company_id and current_user.role != PlatformRole.SUPER_ADMIN:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Valid company context is required."
        )

    vendor = Vendor(company_id=company_id, **vendor_in.model_dump())
    db.add(vendor)
    db.commit()
    db.refresh(vendor)

    log_audit_event(
        db=db,
        action="CREATE_VENDOR",
        entity="Vendor",
        company_id=company_id,
        user_id=current_user.id,
        entity_id=vendor.id,
        new_value=f"Vendor: {vendor.name}"
    )

    return vendor


@router.get("", response_model=List[VendorResponse])
def list_vendors(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id)
):
    """
    Retrieve registered vendors for the organization.
    """
    company_id = tenant_company_id or current_user.company_id
    query = db.query(Vendor)
    
    if current_user.role != PlatformRole.SUPER_ADMIN:
        if not company_id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Company context required.")
        query = query.filter(Vendor.company_id == company_id)

    return query.offset(skip).limit(limit).all()


@router.get("/{vendor_id}", response_model=VendorResponse)
def get_vendor(
    vendor_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id)
):
    """
    Get detailed information about a specific vendor.
    """
    company_id = tenant_company_id or current_user.company_id
    query = db.query(Vendor).filter(Vendor.id == vendor_id)
    
    if current_user.role != PlatformRole.SUPER_ADMIN:
        if not company_id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Company context required.")
        query = query.filter(Vendor.company_id == company_id)

    vendor = query.first()
    if not vendor:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Vendor record not found."
        )
    return vendor


@router.put("/{vendor_id}", response_model=VendorResponse)
def update_vendor(
    vendor_id: str,
    vendor_in: VendorUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles([PlatformRole.SUPER_ADMIN, PlatformRole.IT_ADMIN, PlatformRole.SUB_ADMIN])),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id)
):
    """
    Update vendor contact info or attributes.
    """
    company_id = tenant_company_id or current_user.company_id
    query = db.query(Vendor).filter(Vendor.id == vendor_id)
    
    if current_user.role != PlatformRole.SUPER_ADMIN:
        if not company_id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Company context required.")
        query = query.filter(Vendor.company_id == company_id)

    vendor = query.first()
    if not vendor:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Vendor record not found."
        )

    update_data = vendor_in.model_dump(exclude_unset=True) if hasattr(vendor_in, "model_dump") else vendor_in.dict(exclude_unset=True)
    for field, value in update_data.items():
        setattr(vendor, field, value)

    db.commit()
    db.refresh(vendor)

    log_audit_event(
        db=db,
        action="UPDATE_VENDOR",
        entity="Vendor",
        company_id=vendor.company_id,
        user_id=current_user.id,
        entity_id=vendor.id,
        new_value=f"Updated name: {vendor.name}"
    )

    return vendor


@router.delete("/{vendor_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_vendor(
    vendor_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles([PlatformRole.SUPER_ADMIN, PlatformRole.IT_ADMIN])),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id)
):
    """
    Delete a vendor from the system.
    """
    company_id = tenant_company_id or current_user.company_id
    query = db.query(Vendor).filter(Vendor.id == vendor_id)
    
    if current_user.role != PlatformRole.SUPER_ADMIN:
        if not company_id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Company context required.")
        query = query.filter(Vendor.company_id == company_id)

    vendor = query.first()
    if not vendor:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Vendor record not found."
        )

    # Assets, purchase orders and maintenance records point at the vendor; the
    # database would refuse the delete with a 500, so say why instead.
    in_use = {
        "asset(s)": db.query(Asset.id).filter(Asset.vendor_id == vendor.id).count(),
        "purchase order(s)": db.query(PurchaseOrder.id).filter(PurchaseOrder.vendor_id == vendor.id).count(),
        "maintenance record(s)": db.query(Maintenance.id).filter(Maintenance.vendor_id == vendor.id).count(),
    }
    if any(in_use.values()):
        used = ", ".join(f"{count} {label}" for label, count in in_use.items() if count)
        raise HTTPException(status_code=409, detail=f"'{vendor.name}' is still used by {used}. Reassign or remove them first.")

    db.delete(vendor)
    db.commit()

    log_audit_event(
        db=db,
        action="DELETE_VENDOR",
        entity="Vendor",
        company_id=vendor.company_id,
        user_id=current_user.id,
        entity_id=vendor_id
    )

    return None