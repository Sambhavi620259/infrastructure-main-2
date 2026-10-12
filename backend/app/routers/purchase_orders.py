"""Implementation file: app/routers/purchase_orders.py"""
from typing import List, Literal, Optional
from datetime import datetime
from decimal import Decimal
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from pydantic import BaseModel, ConfigDict, Field

from app.core.database import get_db
from app.core.deps import get_current_user, require_roles, get_tenant_company_id
from app.models.models import PurchaseOrder, PlatformRole, User, Vendor
from app.services.audit_service import log_audit_event
from app.services.notification_service import notify_company

router = APIRouter(prefix="/purchase-orders", tags=["Procurement & Purchase Orders"])

# PENDING -> ORDERED -> RECEIVED, or CANCELLED before it is received.
PoStatus = Literal["PENDING", "ORDERED", "RECEIVED", "CANCELLED"]
_NEXT_STATUSES = {
    "PENDING": {"ORDERED", "CANCELLED"},
    "ORDERED": {"RECEIVED", "CANCELLED"},
    "RECEIVED": set(),
    "CANCELLED": set(),
}

_buyers = require_roles([PlatformRole.SUPER_ADMIN, PlatformRole.IT_ADMIN, PlatformRole.SUB_ADMIN])


class PurchaseOrderCreate(BaseModel):
    po_number: str = Field(..., min_length=1, max_length=100)
    vendor_id: str
    total_amount: Decimal = Field(..., ge=0)
    order_date: Optional[datetime] = None


class PurchaseOrderStatusUpdate(BaseModel):
    status: PoStatus


class PurchaseOrderResponse(BaseModel):
    id: str
    company_id: str
    po_number: str
    vendor_id: str
    vendor_name: Optional[str] = None
    status: str
    total_amount: Decimal
    order_date: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


def _company_id(current_user: User, tenant_company_id: Optional[str]) -> str:
    company_id = tenant_company_id or current_user.company_id
    if not company_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Company context required.")
    return company_id


def _response(po: PurchaseOrder, vendor_name: Optional[str]) -> PurchaseOrderResponse:
    response = PurchaseOrderResponse.model_validate(po)
    response.vendor_name = vendor_name
    return response


@router.post("", response_model=PurchaseOrderResponse, status_code=status.HTTP_201_CREATED)
def create_purchase_order(
    po_in: PurchaseOrderCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(_buyers),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id)
):
    """
    Create a purchase order against one of the organization's vendors.
    """
    company_id = _company_id(current_user, tenant_company_id)
    vendor = db.query(Vendor).filter(Vendor.id == po_in.vendor_id, Vendor.company_id == company_id).first()
    if not vendor:
        raise HTTPException(status_code=400, detail="Unknown vendor.")
    po_number = po_in.po_number.strip()
    if db.query(PurchaseOrder.id).filter(
        PurchaseOrder.company_id == company_id, PurchaseOrder.po_number == po_number
    ).first():
        raise HTTPException(status_code=400, detail=f"Purchase order {po_number} already exists.")

    po = PurchaseOrder(
        company_id=company_id,
        po_number=po_number,
        vendor_id=vendor.id,
        total_amount=po_in.total_amount,
        order_date=po_in.order_date or datetime.utcnow(),
        status="PENDING",
    )
    db.add(po)
    db.commit()
    db.refresh(po)

    log_audit_event(
        db=db,
        action="CREATE_PURCHASE_ORDER",
        entity="PurchaseOrder",
        company_id=company_id,
        user_id=current_user.id,
        entity_id=po.id,
        new_value=f"PO {po.po_number} to {vendor.name}"
    )

    return _response(po, vendor.name)


@router.get("", response_model=List[PurchaseOrderResponse])
def list_purchase_orders(
    po_status: Optional[PoStatus] = Query(None, alias="status"),
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id)
):
    """
    List purchase orders for the active tenant, newest first.
    """
    query = db.query(PurchaseOrder, Vendor.name).outerjoin(Vendor, Vendor.id == PurchaseOrder.vendor_id)
    if current_user.role != PlatformRole.SUPER_ADMIN:
        query = query.filter(PurchaseOrder.company_id == _company_id(current_user, tenant_company_id))
    if po_status:
        query = query.filter(PurchaseOrder.status == po_status)

    rows = query.order_by(PurchaseOrder.order_date.desc()).offset(skip).limit(limit).all()
    return [_response(po, vendor_name) for po, vendor_name in rows]


@router.put("/{po_id}/status", response_model=PurchaseOrderResponse)
def update_po_status(
    po_id: str,
    update_in: PurchaseOrderStatusUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(_buyers),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id)
):
    """
    Move a purchase order along PENDING -> ORDERED -> RECEIVED, or cancel it.
    """
    query = db.query(PurchaseOrder).filter(PurchaseOrder.id == po_id)
    if current_user.role != PlatformRole.SUPER_ADMIN:
        query = query.filter(PurchaseOrder.company_id == _company_id(current_user, tenant_company_id))

    po = query.first()
    if not po:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Purchase order not found.")

    old_status = po.status
    if update_in.status not in _NEXT_STATUSES.get(old_status, set()):
        raise HTTPException(
            status_code=400,
            detail=f"A {old_status.lower()} purchase order cannot be marked {update_in.status.lower()}."
        )
    po.status = update_in.status
    notify_company(
        db, po.company_id, [PlatformRole.IT_ADMIN, PlatformRole.SUB_ADMIN],
        title=f"Purchase order {po.po_number} {update_in.status.lower()}",
        message=f"Updated by {current_user.full_name}.", admin_link="/inventory/purchase-orders",
        exclude_user_id=current_user.id, type="SUCCESS" if update_in.status == "RECEIVED" else "INFO",
    )
    db.commit()
    db.refresh(po)

    log_audit_event(
        db=db,
        action="UPDATE_PO_STATUS",
        entity="PurchaseOrder",
        company_id=po.company_id,
        user_id=current_user.id,
        entity_id=po.id,
        old_value=f"Status: {old_status}",
        new_value=f"PO {po.po_number}: {po.status}"
    )

    vendor = db.query(Vendor.name).filter(Vendor.id == po.vendor_id).first()
    return _response(po, vendor[0] if vendor else None)
