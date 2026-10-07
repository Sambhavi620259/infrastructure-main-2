"""Implementation file: app/routers/purchase_orders.py"""
from typing import List, Optional
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from pydantic import BaseModel, ConfigDict

from app.core.database import get_db
from app.core.deps import get_current_user, require_roles, get_tenant_company_id
from app.models.models import PurchaseOrder, PlatformRole, User
from app.services.audit_service import log_audit_event

router = APIRouter(prefix="/purchase-orders", tags=["Procurement & Purchase Orders"])


class PurchaseOrderCreate(BaseModel):
    order_number: str
    vendor_id: str
    total_amount: float
    order_date: datetime
    expected_delivery: Optional[datetime] = None
    notes: Optional[str] = None


class PurchaseOrderResponse(BaseModel):
    id: str
    company_id: str
    order_number: str
    vendor_id: str
    status: str
    total_amount: float
    order_date: datetime
    expected_delivery: Optional[datetime] = None
    notes: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)


@router.post("", response_model=PurchaseOrderResponse, status_code=status.HTTP_201_CREATED)
def create_purchase_order(
    po_in: PurchaseOrderCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles([PlatformRole.SUPER_ADMIN, PlatformRole.IT_ADMIN, PlatformRole.SUB_ADMIN])),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id)
):
    """
    Create a new procurement purchase order.
    """
    company_id = tenant_company_id or current_user.company_id
    if not company_id and current_user.role != PlatformRole.SUPER_ADMIN:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Company context required.")

    po = PurchaseOrder(
        company_id=company_id,
        order_number=po_in.order_number,
        vendor_id=po_in.vendor_id,
        total_amount=po_in.total_amount,
        order_date=po_in.order_date,
        expected_delivery=po_in.expected_delivery,
        notes=po_in.notes,
        status="DRAFT",
        created_by=current_user.id
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
        new_value=f"PO #: {po.order_number}"
    )

    return po


@router.get("", response_model=List[PurchaseOrderResponse])
def list_purchase_orders(
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id)
):
    """
    List purchase orders for the active tenant.
    """
    company_id = tenant_company_id or current_user.company_id
    query = db.query(PurchaseOrder)

    if current_user.role != PlatformRole.SUPER_ADMIN:
        if not company_id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Company context required.")
        query = query.filter(PurchaseOrder.company_id == company_id)

    return query.order_by(PurchaseOrder.order_date.desc()).offset(skip).limit(limit).all()


@router.put("/{po_id}/status", response_model=PurchaseOrderResponse)
def update_po_status(
    po_id: str,
    status_str: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles([PlatformRole.SUPER_ADMIN, PlatformRole.IT_ADMIN])),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id)
):
    """
    Update purchase order workflow status (e.g., ORDERED, RECEIVED, CANCELLED).
    """
    company_id = tenant_company_id or current_user.company_id
    query = db.query(PurchaseOrder).filter(PurchaseOrder.id == po_id)

    if current_user.role != PlatformRole.SUPER_ADMIN:
        if not company_id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Company context required.")
        query = query.filter(PurchaseOrder.company_id == company_id)

    po = query.first()
    if not po:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Purchase order not found.")

    old_status = po.status
    po.status = status_str.upper()
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
        new_value=f"Status: {po.status}"
    )

    return po