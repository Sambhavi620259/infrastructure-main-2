"""Implementation file: app/routers/inventory.py"""
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user, require_roles, get_tenant_company_id
from app.models.models import InventoryItem, PlatformRole, User
from app.schemas.schemas import (
    InventoryItemCreate, InventoryItemResponse, InventoryItemUpdate
)
from app.services.audit_service import log_audit_event

router = APIRouter(prefix="/inventory", tags=["Inventory & Consumables"])


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
    if not company_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, 
            detail="Valid company context is required."
        )

    item = InventoryItem(
        company_id=company_id,
        name=item_in.name,
        category=item_in.category,
        quantity=item_in.quantity,
        reorder_level=item_in.reorder_level,
        unit_cost=item_in.unit_cost,
        location=item_in.location,
        status="IN_STOCK" if item_in.quantity > 0 else "OUT_OF_STOCK"
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
    query = db.query(InventoryItem)
    if current_user.role != PlatformRole.SUPER_ADMIN:
        query = query.filter(InventoryItem.company_id == tenant_company_id)

    if category:
        query = query.filter(InventoryItem.category == category)

    return query.offset(skip).limit(limit).all()


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
    query = db.query(InventoryItem).filter(InventoryItem.id == item_id)
    if current_user.role != PlatformRole.SUPER_ADMIN:
        query = query.filter(InventoryItem.company_id == tenant_company_id)

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
    query = db.query(InventoryItem).filter(InventoryItem.id == item_id)
    if current_user.role != PlatformRole.SUPER_ADMIN:
        query = query.filter(InventoryItem.company_id == tenant_company_id)

    item = query.first()
    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, 
            detail="Inventory item not found."
        )

    old_qty = item.quantity
    update_data = item_in.dict(exclude_unset=True)

    for field, value in update_data.items():
        setattr(item, field, value)

    # Adjust stock status dynamically based on current quantity
    if item.quantity <= 0:
        item.status = "OUT_OF_STOCK"
    elif item.quantity <= item.reorder_level:
        item.status = "LOW_STOCK"
    else:
        item.status = "IN_STOCK"

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
    query = db.query(InventoryItem).filter(InventoryItem.id == item_id)
    if current_user.role != PlatformRole.SUPER_ADMIN:
        query = query.filter(InventoryItem.company_id == tenant_company_id)

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