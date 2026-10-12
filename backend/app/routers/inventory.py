"""Implementation file: app/routers/inventory.py"""
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user, require_roles, get_tenant_company_id
from app.models.models import InventoryItem, PlatformRole, User
from pydantic import BaseModel, Field

from app.schemas.schemas import (
    InventoryItemCreate, InventoryItemResponse, InventoryItemUpdate
)
from app.services.audit_service import log_audit_event
from app.services.notification_service import notify_company

router = APIRouter(prefix="/inventory", tags=["Inventory & Consumables"])


class StockAdjustment(BaseModel):
    # Positive to receive stock, negative to issue it.
    change: int = Field(..., ne=0, ge=-100000, le=100000)
    reason: str = Field(..., min_length=1, max_length=300)


def _stock_status(item: InventoryItem) -> str:
    if item.quantity <= 0:
        return "OUT_OF_STOCK"
    if item.quantity <= item.reorder_level:
        return "LOW_STOCK"
    return "IN_STOCK"


@router.post("", response_model=InventoryItemResponse, status_code=status.HTTP_201_CREATED)
def create_inventory_item(
    item_in: InventoryItemCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles([PlatformRole.SUPER_ADMIN, PlatformRole.IT_ADMIN, PlatformRole.SUB_ADMIN])),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id)
):
    """
    Create a new inventory or consumable item entry.
    """
    company_id = tenant_company_id or current_user.company_id
    if not company_id and current_user.role != PlatformRole.SUPER_ADMIN:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, 
            detail="Valid company context is required."
        )

    # Determine initial stock status
    if item_in.quantity <= 0:
        initial_status = "OUT_OF_STOCK"
    elif item_in.quantity <= item_in.reorder_level:
        initial_status = "LOW_STOCK"
    else:
        initial_status = "IN_STOCK"

    item = InventoryItem(
        company_id=company_id,
        name=item_in.name,
        category=item_in.category,
        quantity=item_in.quantity,
        reorder_level=item_in.reorder_level,
        unit_cost=item_in.unit_cost,
        location=item_in.location,
        status=initial_status
    )
    db.add(item)
    db.commit()
    db.refresh(item)

    log_audit_event(
        db=db,
        action="CREATE_INVENTORY_ITEM",
        entity="InventoryItem",
        company_id=company_id,
        user_id=current_user.id,
        entity_id=item.id,
        new_value=f"Item: {item.name}, Qty: {item.quantity}"
    )

    return item


@router.get("", response_model=List[InventoryItemResponse])
def list_inventory_items(
    skip: int = 0,
    limit: int = 100,
    category: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id)
):
    """
    List all inventory and consumable items for the current tenant.
    """
    company_id = tenant_company_id or current_user.company_id
    query = db.query(InventoryItem)

    if current_user.role != PlatformRole.SUPER_ADMIN:
        if not company_id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Company context required.")
        query = query.filter(InventoryItem.company_id == company_id)

    if category:
        query = query.filter(InventoryItem.category == category)

    return query.offset(skip).limit(limit).all()


@router.get("/counts")
def get_inventory_counts(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id)
):
    """
    Get inventory counts for dashboard badges.
    """
    company_id = tenant_company_id or current_user.company_id
    if not company_id and current_user.role != PlatformRole.SUPER_ADMIN:
        raise HTTPException(status_code=400, detail="Company context required")

    base = db.query(InventoryItem)
    if current_user.role != PlatformRole.SUPER_ADMIN:
        base = base.filter(InventoryItem.company_id == company_id)

    low = base.filter(InventoryItem.quantity <= InventoryItem.reorder_level).count()
    return {"total": base.count(), "low_stock": low}


@router.get("/{item_id}", response_model=InventoryItemResponse)
def get_inventory_item(
    item_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id)
):
    """
    Retrieve specific inventory item details.
    """
    company_id = tenant_company_id or current_user.company_id
    query = db.query(InventoryItem).filter(InventoryItem.id == item_id)

    if current_user.role != PlatformRole.SUPER_ADMIN:
        if not company_id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Company context required.")
        query = query.filter(InventoryItem.company_id == company_id)

    item = query.first()
    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, 
            detail="Inventory item not found."
        )
    return item


@router.put("/{item_id}", response_model=InventoryItemResponse)
def update_inventory_item(
    item_id: str,
    item_in: InventoryItemUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles([PlatformRole.SUPER_ADMIN, PlatformRole.IT_ADMIN, PlatformRole.SUB_ADMIN])),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id)
):
    """
    Update stock quantities, unit cost, reorder levels, or location.
    """
    company_id = tenant_company_id or current_user.company_id
    query = db.query(InventoryItem).filter(InventoryItem.id == item_id)

    if current_user.role != PlatformRole.SUPER_ADMIN:
        if not company_id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Company context required.")
        query = query.filter(InventoryItem.company_id == company_id)

    item = query.first()
    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, 
            detail="Inventory item not found."
        )

    old_qty = item.quantity
    
    # Use model_dump for Pydantic v2 compatibility (fallback to dict if needed)
    update_data = item_in.model_dump(exclude_unset=True) if hasattr(item_in, "model_dump") else item_in.dict(exclude_unset=True)

    for field, value in update_data.items():
        setattr(item, field, value)

    item.status = _stock_status(item)

    db.commit()
    db.refresh(item)

    log_audit_event(
        db=db,
        action="UPDATE_INVENTORY_ITEM",
        entity="InventoryItem",
        company_id=item.company_id,
        user_id=current_user.id,
        entity_id=item.id,
        old_value=f"Quantity: {old_qty}",
        new_value=f"Quantity: {item.quantity}, Status: {item.status}"
    )

    return item


@router.delete("/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_inventory_item(
    item_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles([PlatformRole.SUPER_ADMIN, PlatformRole.IT_ADMIN])),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id)
):
    """
    Remove an inventory entry from the system.
    """
    company_id = tenant_company_id or current_user.company_id
    query = db.query(InventoryItem).filter(InventoryItem.id == item_id)

    if current_user.role != PlatformRole.SUPER_ADMIN:
        if not company_id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Company context required.")
        query = query.filter(InventoryItem.company_id == company_id)

    item = query.first()
    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, 
            detail="Inventory item not found."
        )

    db.delete(item)
    db.commit()

    log_audit_event(
        db=db,
        action="DELETE_INVENTORY_ITEM",
        entity="InventoryItem",
        company_id=item.company_id,
        user_id=current_user.id,
        entity_id=item_id
    )

    return None


@router.post("/{item_id}/adjust", response_model=InventoryItemResponse)
def adjust_stock(
    item_id: str,
    adjustment: StockAdjustment,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles([
        PlatformRole.SUPER_ADMIN, PlatformRole.IT_ADMIN, PlatformRole.SUB_ADMIN, PlatformRole.EMPLOYEE,
    ])),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id)
):
    """
    Receive (+) or issue (-) stock with a reason. Open to IT Agents, who can
    move stock but not edit the item's cost or reorder settings.
    """
    company_id = tenant_company_id or current_user.company_id
    query = db.query(InventoryItem).filter(InventoryItem.id == item_id)
    if current_user.role != PlatformRole.SUPER_ADMIN:
        query = query.filter(InventoryItem.company_id == company_id)
    # Lock the row so two people issuing stock at once cannot both pass the check.
    item = query.with_for_update().first()
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Inventory item not found.")

    old_qty = item.quantity or 0
    new_qty = old_qty + adjustment.change
    if new_qty < 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Only {old_qty} in stock; cannot issue {-adjustment.change}."
        )
    old_status = item.status
    item.quantity = new_qty
    item.status = _stock_status(item)
    if item.status != "IN_STOCK" and item.status != old_status:
        notify_company(
            db, item.company_id, [PlatformRole.IT_ADMIN, PlatformRole.SUB_ADMIN],
            title=f"{item.name} is {'out of stock' if item.status == 'OUT_OF_STOCK' else 'running low'}",
            message=f"{new_qty} left (reorder level {item.reorder_level}).",
            admin_link="/inventory/stock",
            type="WARNING",
        )
    db.commit()
    db.refresh(item)

    log_audit_event(
        db=db,
        action="ADJUST_INVENTORY_STOCK",
        entity="InventoryItem",
        company_id=item.company_id,
        user_id=current_user.id,
        entity_id=item.id,
        old_value=f"Quantity: {old_qty}",
        new_value=f"Quantity: {new_qty} ({adjustment.change:+d}): {adjustment.reason}"
    )
    return item
