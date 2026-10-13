"""Implementation file: app/routers/inventory.py"""
from datetime import datetime
from typing import List, Literal, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user, require_roles, get_tenant_company_id
from sqlalchemy import func

from app.models.models import (
    Asset, AssetStatusEnum, InventoryItem, InventoryRequest, PlatformRole, PurchaseOrder, StockMovement,
    StockReceipt, User,
)
from app.services.approval_service import require_approver
from app.services.stock_service import ensure_new_reference, record_movement
from pydantic import BaseModel, ConfigDict, Field

from app.schemas.schemas import (
    InventoryItemCreate, InventoryItemResponse, InventoryItemUpdate
)
from app.services.audit_service import log_audit_event
from app.services.notification_service import home_link, notify, notify_company

router = APIRouter(prefix="/inventory", tags=["Inventory & Consumables"])


class StockAdjustment(BaseModel):
    # Positive to receive stock, negative to issue it.
    change: int = Field(..., ne=0, ge=-100000, le=100000)
    reason: str = Field(..., min_length=1, max_length=300)
    # Client key so a double-submitted adjustment is recorded once.
    reference: Optional[str] = Field(None, max_length=64)


class ReceiptCreate(BaseModel):
    """Hardware received against an approved (ordered) purchase order."""
    purchase_order_id: str
    category: str = Field(..., min_length=1, max_length=100)
    brand: Optional[str] = Field(None, max_length=100)
    model: Optional[str] = Field(None, max_length=100)
    specifications: Optional[str] = Field(None, max_length=2000)
    quantity: int = Field(..., ge=1, le=10000)
    unit_cost: float = Field(0, ge=0)
    location: Optional[str] = Field(None, max_length=100)
    notes: Optional[str] = Field(None, max_length=1000)
    # Mark the purchase order as fully received.
    complete_po: bool = False
    reference: Optional[str] = Field(None, max_length=64)


class ReceiptResponse(BaseModel):
    id: str
    purchase_order_id: str
    po_number: Optional[str] = None
    category: str
    brand: Optional[str] = None
    model: Optional[str] = None
    specifications: Optional[str] = None
    quantity: int
    # Devices registered as assets from this receipt so far.
    registered: int = 0
    unit_cost: float
    location: Optional[str] = None
    notes: Optional[str] = None
    received_by_name: Optional[str] = None
    received_at: Optional[datetime] = None


class HardwareStockRow(BaseModel):
    """Stock of one kind of device (category + brand + model), derived from receipts and asset statuses."""
    category: str
    brand: Optional[str] = None
    model: Optional[str] = None
    purchased: int
    awaiting_registration: int
    available: int
    reserved: int
    assigned: int
    under_repair: int
    retired: int


class MovementCreate(BaseModel):
    movement_type: Literal["TRANSFER", "RECEIPT", "ISSUE", "RETURN", "ADJUSTMENT"]
    item_kind: Literal["HARDWARE", "CONSUMABLE"]
    asset_id: Optional[str] = None
    inventory_item_id: Optional[str] = None
    # Units for consumables; ADJUSTMENT may be negative. Hardware moves one device.
    quantity: int = Field(1, ge=-100000, le=100000)
    to_location: Optional[str] = Field(None, max_length=100)
    purchase_order_id: Optional[str] = None
    reason: str = Field(..., min_length=1, max_length=300)
    reference: Optional[str] = Field(None, max_length=64)


class MovementResponse(BaseModel):
    id: str
    movement_type: str
    item_kind: str
    asset_id: Optional[str] = None
    asset_label: Optional[str] = None
    inventory_item_id: Optional[str] = None
    item_name: Optional[str] = None
    receipt_id: Optional[str] = None
    purchase_order_id: Optional[str] = None
    po_number: Optional[str] = None
    quantity: int
    from_location: Optional[str] = None
    to_location: Optional[str] = None
    reason: Optional[str] = None
    performed_by_name: Optional[str] = None
    created_at: Optional[datetime] = None


_admins = require_roles([PlatformRole.SUPER_ADMIN, PlatformRole.IT_ADMIN, PlatformRole.SUB_ADMIN])


class InventoryRequestCreate(BaseModel):
    item_id: str
    quantity: int = Field(..., ge=1, le=10000)
    reason: str = Field(..., min_length=1, max_length=300)


class InventoryRequestDecision(BaseModel):
    status: Literal["APPROVED", "REJECTED", "CANCELLED"]
    rejection_reason: Optional[str] = Field(None, max_length=300)


class InventoryRequestResponse(BaseModel):
    id: str
    item_id: str
    item_name: Optional[str] = None
    item_category: Optional[str] = None
    # Stock on hand now, so an admin can see whether the request can be met.
    available: Optional[int] = None
    requested_by: str
    requested_by_name: Optional[str] = None
    quantity: int
    reason: str
    status: str
    rejection_reason: Optional[str] = None
    processed_by: Optional[str] = None
    processed_by_name: Optional[str] = None
    processed_at: Optional[datetime] = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


def _stock_status(item: InventoryItem) -> str:
    if item.quantity <= 0:
        return "OUT_OF_STOCK"
    if item.quantity <= item.reorder_level:
        return "LOW_STOCK"
    return "IN_STOCK"


def _change_stock(db: Session, item: InventoryItem, change: int) -> int:
    """Apply a stock change (caller commits); warns admins when the item turns low or out. Returns the old quantity."""
    old_qty = item.quantity or 0
    new_qty = old_qty + change
    if new_qty < 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Only {old_qty} {item.name} in stock; cannot issue {-change}."
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
    return old_qty


def _company(user: User, tenant_company_id: Optional[str]) -> str:
    company_id = tenant_company_id or user.company_id
    if not company_id:
        raise HTTPException(status_code=400, detail="Company context required.")
    return company_id


def _receipt_responses(db: Session, receipts: List[StockReceipt]) -> List[ReceiptResponse]:
    if not receipts:
        return []
    ids = [r.id for r in receipts]
    registered = dict(db.query(Asset.receipt_id, func.count()).filter(Asset.receipt_id.in_(ids))
                      .group_by(Asset.receipt_id).all())
    pos = dict(db.query(PurchaseOrder.id, PurchaseOrder.po_number)
               .filter(PurchaseOrder.id.in_({r.purchase_order_id for r in receipts})).all())
    user_ids = {r.received_by for r in receipts if r.received_by}
    names = dict(db.query(User.id, User.full_name).filter(User.id.in_(user_ids)).all()) if user_ids else {}
    return [
        ReceiptResponse(
            id=r.id, purchase_order_id=r.purchase_order_id, po_number=pos.get(r.purchase_order_id),
            category=r.category, brand=r.brand, model=r.model, specifications=r.specifications,
            quantity=r.quantity, registered=registered.get(r.id, 0), unit_cost=float(r.unit_cost or 0),
            location=r.location, notes=r.notes, received_by_name=names.get(r.received_by), received_at=r.received_at,
        )
        for r in receipts
    ]


def _movement_responses(db: Session, movements: List[StockMovement]) -> List[MovementResponse]:
    if not movements:
        return []
    assets = {a.id: a.label for a in db.query(Asset).filter(
        Asset.id.in_({m.asset_id for m in movements if m.asset_id})).all()}
    items = dict(db.query(InventoryItem.id, InventoryItem.name).filter(
        InventoryItem.id.in_({m.inventory_item_id for m in movements if m.inventory_item_id})).all())
    pos = dict(db.query(PurchaseOrder.id, PurchaseOrder.po_number).filter(
        PurchaseOrder.id.in_({m.purchase_order_id for m in movements if m.purchase_order_id})).all())
    user_ids = {m.performed_by for m in movements if m.performed_by}
    names = dict(db.query(User.id, User.full_name).filter(User.id.in_(user_ids)).all()) if user_ids else {}
    return [
        MovementResponse(
            id=m.id, movement_type=m.movement_type, item_kind=m.item_kind, asset_id=m.asset_id,
            asset_label=assets.get(m.asset_id), inventory_item_id=m.inventory_item_id,
            item_name=items.get(m.inventory_item_id), receipt_id=m.receipt_id, purchase_order_id=m.purchase_order_id,
            po_number=pos.get(m.purchase_order_id), quantity=m.quantity, from_location=m.from_location,
            to_location=m.to_location, reason=m.reason, performed_by_name=names.get(m.performed_by),
            created_at=m.created_at,
        )
        for m in movements
    ]


def _request_responses(db: Session, requests: List[InventoryRequest]) -> List[InventoryRequestResponse]:
    """Attach item and people names in two batched lookups."""
    items = {i.id: i for i in db.query(InventoryItem).filter(InventoryItem.id.in_({r.item_id for r in requests}))}
    user_ids = {r.requested_by for r in requests} | {r.processed_by for r in requests if r.processed_by}
    names = dict(db.query(User.id, User.full_name).filter(User.id.in_(user_ids)).all()) if user_ids else {}
    out = []
    for req in requests:
        response = InventoryRequestResponse.model_validate(req)
        item = items.get(req.item_id)
        if item:
            response.item_name, response.item_category, response.available = item.name, item.category, item.quantity
        response.requested_by_name = names.get(req.requested_by)
        response.processed_by_name = names.get(req.processed_by)
        out.append(response)
    return out


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


# --- Hardware stock ----------------------------------------------------------

_HELD = (AssetStatusEnum.ASSIGNED, AssetStatusEnum.IN_USE, AssetStatusEnum.RETURN_REQUESTED)
_GONE = (AssetStatusEnum.RETIRED, AssetStatusEnum.DISPOSED, AssetStatusEnum.LOST, AssetStatusEnum.DAMAGED)


@router.get("/hardware-stock", response_model=List[HardwareStockRow])
def hardware_stock(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles([PlatformRole.SUPER_ADMIN, PlatformRole.IT_ADMIN, PlatformRole.SUB_ADMIN,
                                                PlatformRole.REPORTING_USER])),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id),
):
    """
    Hardware stock per kind of device, derived from records rather than typed in:
    purchased = units received on receipts + devices registered without one;
    awaiting registration = received units not yet registered as assets;
    the rest come from each registered device's status.
    """
    company_id = _company(current_user, tenant_company_id)
    rows: dict = {}

    def row(category: str, brand: Optional[str], model: Optional[str]) -> dict:
        key = ((category or "").strip().lower(), (brand or "").strip().lower(), (model or "").strip().lower())
        return rows.setdefault(key, {
            "category": category, "brand": brand, "model": model, "purchased": 0, "awaiting_registration": 0,
            "available": 0, "reserved": 0, "assigned": 0, "under_repair": 0, "retired": 0,
        })

    receipts = db.query(StockReceipt).filter(StockReceipt.company_id == company_id).all()
    registered = dict(db.query(Asset.receipt_id, func.count()).filter(
        Asset.company_id == company_id, Asset.receipt_id.isnot(None)).group_by(Asset.receipt_id).all())
    for receipt in receipts:
        r = row(receipt.category, receipt.brand, receipt.model)
        r["purchased"] += receipt.quantity
        r["awaiting_registration"] += max(receipt.quantity - registered.get(receipt.id, 0), 0)

    for asset in db.query(Asset).filter(Asset.company_id == company_id).all():
        r = row(asset.category, asset.brand, asset.model)
        if asset.receipt_id is None:
            r["purchased"] += 1
        if asset.status == AssetStatusEnum.IN_STOCK or asset.status == AssetStatusEnum.RETURNED:
            r["available"] += 1
        elif asset.status == AssetStatusEnum.REQUESTED:
            r["reserved"] += 1
        elif asset.status in _HELD:
            r["assigned"] += 1
        elif asset.status == AssetStatusEnum.IN_REPAIR:
            r["under_repair"] += 1
        elif asset.status in _GONE:
            r["retired"] += 1
    return sorted(rows.values(), key=lambda r: (r["category"].lower(), (r["brand"] or "").lower(), (r["model"] or "").lower()))


@router.get("/receipts", response_model=List[ReceiptResponse])
def list_receipts(
    purchase_order_id: Optional[str] = None,
    open_only: bool = False,
    db: Session = Depends(get_db),
    current_user: User = Depends(_admins),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id),
):
    """Stock receipts, newest first. open_only: those with devices still to register."""
    company_id = _company(current_user, tenant_company_id)
    query = db.query(StockReceipt).filter(StockReceipt.company_id == company_id)
    if purchase_order_id:
        query = query.filter(StockReceipt.purchase_order_id == purchase_order_id)
    receipts = _receipt_responses(db, query.order_by(StockReceipt.received_at.desc()).all())
    return [r for r in receipts if r.registered < r.quantity] if open_only else receipts


@router.post("/receipts", response_model=ReceiptResponse, status_code=status.HTTP_201_CREATED)
def receive_stock(
    receipt_in: ReceiptCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(_admins),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id),
):
    """Record hardware delivered against an approved purchase order; then register each device as an asset."""
    company_id = _company(current_user, tenant_company_id)
    ensure_new_reference(db, company_id, receipt_in.reference)
    po = db.query(PurchaseOrder).filter(
        PurchaseOrder.id == receipt_in.purchase_order_id, PurchaseOrder.company_id == company_id
    ).with_for_update().first()
    if not po:
        raise HTTPException(status_code=404, detail="Purchase order not found.")
    if po.status != "ORDERED":
        raise HTTPException(status_code=400, detail="Stock can be received only against an approved (ordered) purchase order.")

    data = receipt_in.model_dump(exclude={"complete_po", "reference"})
    receipt = StockReceipt(company_id=company_id, received_by=current_user.id, **data)
    db.add(receipt)
    db.flush()
    record_movement(
        db, company_id, "RECEIPT", "HARDWARE", current_user.id, quantity=receipt.quantity,
        reference=receipt_in.reference, receipt_id=receipt.id, purchase_order_id=po.id,
        to_location=receipt.location,
        reason=f"Received {receipt.quantity} × {' '.join(filter(None, [receipt.brand, receipt.model])) or receipt.category}",
    )
    if receipt_in.complete_po:
        po.status = "RECEIVED"
    notify_company(
        db, company_id, [PlatformRole.IT_ADMIN, PlatformRole.SUB_ADMIN],
        title=f"{receipt.quantity} × {receipt.model or receipt.category} received on {po.po_number}",
        message="Register each device as an asset to make it available.",
        admin_link="/inventory/hardware", exclude_user_id=current_user.id,
    )
    db.commit()
    db.refresh(receipt)
    log_audit_event(db=db, action="RECEIVE_STOCK", entity="StockReceipt", company_id=company_id,
                    user_id=current_user.id, entity_id=receipt.id,
                    new_value=f"PO {po.po_number}: {receipt.quantity} × {receipt.model or receipt.category}")
    return _receipt_responses(db, [receipt])[0]


# --- Stock movements -------------------------------------------------------------

@router.get("/movements", response_model=List[MovementResponse])
def list_movements(
    movement_type: Optional[str] = None,
    item_kind: Optional[str] = None,
    asset_id: Optional[str] = None,
    inventory_item_id: Optional[str] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=500),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles([PlatformRole.SUPER_ADMIN, PlatformRole.IT_ADMIN, PlatformRole.SUB_ADMIN,
                                                PlatformRole.REPORTING_USER])),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id),
):
    """The stock ledger, newest first."""
    company_id = _company(current_user, tenant_company_id)
    query = db.query(StockMovement).filter(StockMovement.company_id == company_id)
    if movement_type:
        query = query.filter(StockMovement.movement_type == movement_type.upper())
    if item_kind:
        query = query.filter(StockMovement.item_kind == item_kind.upper())
    if asset_id:
        query = query.filter(StockMovement.asset_id == asset_id)
    if inventory_item_id:
        query = query.filter(StockMovement.inventory_item_id == inventory_item_id)
    movements = query.order_by(StockMovement.created_at.desc()).offset(skip).limit(limit).all()
    return _movement_responses(db, movements)


@router.post("/movements", response_model=MovementResponse, status_code=status.HTTP_201_CREATED)
def create_movement(
    movement_in: MovementCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(_admins),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id),
):
    """
    Record a stock movement. Hardware: TRANSFER a device to another location.
    Consumables: RECEIPT (+), ISSUE (-), RETURN (+), ADJUSTMENT (+/-), TRANSFER (location).
    Stock never goes negative; assignments and returns of devices go through their own endpoints.
    """
    company_id = _company(current_user, tenant_company_id)
    ensure_new_reference(db, company_id, movement_in.reference)
    m = movement_in
    fields: dict = {}
    if m.purchase_order_id:
        po = db.query(PurchaseOrder).filter(PurchaseOrder.id == m.purchase_order_id,
                                            PurchaseOrder.company_id == company_id).first()
        if not po:
            raise HTTPException(status_code=404, detail="Purchase order not found.")
        if m.movement_type == "RECEIPT" and po.status not in ("ORDERED", "RECEIVED"):
            raise HTTPException(status_code=400, detail="Stock can be received only against an approved (ordered) purchase order.")
        fields["purchase_order_id"] = po.id

    if m.item_kind == "HARDWARE":
        if m.movement_type != "TRANSFER":
            raise HTTPException(status_code=400, detail="Devices are received on a receipt and assigned or returned through assignments; record a TRANSFER here.")
        asset = db.query(Asset).filter(Asset.id == m.asset_id, Asset.company_id == company_id).with_for_update().first()
        if not asset:
            raise HTTPException(status_code=404, detail="Asset not found.")
        if not (m.to_location or "").strip():
            raise HTTPException(status_code=400, detail="Give the new location.")
        fields.update(asset_id=asset.id, from_location=asset.location_id, to_location=m.to_location.strip())
        asset.location_id = m.to_location.strip()
        quantity = 1
    else:
        item = db.query(InventoryItem).filter(InventoryItem.id == m.inventory_item_id,
                                              InventoryItem.company_id == company_id).with_for_update().first()
        if not item:
            raise HTTPException(status_code=404, detail="Inventory item not found.")
        fields["inventory_item_id"] = item.id
        if m.movement_type == "TRANSFER":
            if not (m.to_location or "").strip():
                raise HTTPException(status_code=400, detail="Give the new location.")
            fields.update(from_location=item.location, to_location=m.to_location.strip())
            item.location = m.to_location.strip()
            quantity = item.quantity or 0
        else:
            if m.movement_type != "ADJUSTMENT" and m.quantity <= 0:
                raise HTTPException(status_code=400, detail="Quantity must be at least 1.")
            if m.quantity == 0:
                raise HTTPException(status_code=400, detail="An adjustment cannot be zero.")
            change = -m.quantity if m.movement_type == "ISSUE" else m.quantity
            _change_stock(db, item, change)
            quantity = change

    movement = record_movement(db, company_id, m.movement_type, m.item_kind, current_user.id, quantity=quantity,
                               reference=m.reference, reason=m.reason.strip(), **fields)
    db.commit()
    db.refresh(movement)
    log_audit_event(db=db, action="STOCK_MOVEMENT", entity="StockMovement", company_id=company_id,
                    user_id=current_user.id, entity_id=movement.id,
                    new_value=f"{m.movement_type} {m.item_kind.lower()} ({quantity:+d}): {m.reason.strip()[:150]}")
    return _movement_responses(db, [movement])[0]


@router.get("/requests", response_model=List[InventoryRequestResponse])
def list_inventory_requests(
    status_filter: Optional[str] = Query(None, alias="status"),
    limit: int = Query(200, ge=1, le=500),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id)
):
    """Stock requests, newest first. Admins see the organization's; users see their own."""
    query = db.query(InventoryRequest)
    if current_user.role != PlatformRole.SUPER_ADMIN:
        query = query.filter(InventoryRequest.company_id == tenant_company_id)
    if current_user.role not in (PlatformRole.SUPER_ADMIN, PlatformRole.IT_ADMIN, PlatformRole.SUB_ADMIN):
        query = query.filter(InventoryRequest.requested_by == current_user.id)
    if status_filter:
        query = query.filter(InventoryRequest.status == status_filter.upper())
    return _request_responses(db, query.order_by(InventoryRequest.created_at.desc()).limit(limit).all())


@router.post("/requests", response_model=InventoryRequestResponse, status_code=status.HTTP_201_CREATED)
def create_inventory_request(
    request_in: InventoryRequestCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id)
):
    """A user asks for stock of an item; the IT Admin approves (issuing it) or rejects."""
    company_id = tenant_company_id or current_user.company_id
    if not company_id:
        raise HTTPException(status_code=400, detail="Company context required.")
    item = db.query(InventoryItem).filter(
        InventoryItem.id == request_in.item_id, InventoryItem.company_id == company_id
    ).first()
    if not item:
        raise HTTPException(status_code=404, detail="Inventory item not found.")

    req = InventoryRequest(
        company_id=company_id, item_id=item.id, requested_by=current_user.id,
        quantity=request_in.quantity, reason=request_in.reason.strip(), status="PENDING",
    )
    db.add(req)
    notify_company(
        db, company_id, [PlatformRole.IT_ADMIN, PlatformRole.SUB_ADMIN],
        title=f"{current_user.full_name} requested {request_in.quantity} × {item.name}",
        message=req.reason[:200],
        admin_link="/inventory/stock", exclude_user_id=current_user.id,
    )
    db.commit()
    db.refresh(req)
    log_audit_event(
        db=db, action="REQUEST_INVENTORY", entity="InventoryRequest", company_id=company_id,
        user_id=current_user.id, entity_id=req.id,
        new_value=f"{request_in.quantity} × {item.name}: {req.reason[:150]}",
    )
    return _request_responses(db, [req])[0]


@router.put("/requests/{request_id}", response_model=InventoryRequestResponse)
def decide_inventory_request(
    request_id: str,
    decision: InventoryRequestDecision,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id)
):
    """
    Admins approve (the stock is issued to the requester) or reject a pending
    request. The requester may cancel their own pending request.
    """
    is_admin = current_user.role in (PlatformRole.SUPER_ADMIN, PlatformRole.IT_ADMIN, PlatformRole.SUB_ADMIN)
    query = db.query(InventoryRequest).filter(InventoryRequest.id == request_id)
    if current_user.role != PlatformRole.SUPER_ADMIN:
        query = query.filter(InventoryRequest.company_id == tenant_company_id)
    if not is_admin:
        query = query.filter(InventoryRequest.requested_by == current_user.id)
    req = query.first()
    if not req:
        raise HTTPException(status_code=404, detail="Stock request not found.")
    if not is_admin and decision.status != "CANCELLED":
        raise HTTPException(status_code=403, detail="Only an IT Admin can approve or reject stock requests.")
    if req.status != "PENDING":
        raise HTTPException(status_code=400, detail=f"This request is already {req.status.lower()}.")
    if decision.status == "REJECTED" and not (decision.rejection_reason or "").strip():
        raise HTTPException(status_code=400, detail="Give a reason for rejecting the request.")

    if is_admin and decision.status in ("APPROVED", "REJECTED"):
        require_approver(db, current_user, req.company_id, "STOCK", [req.requested_by])

    # Lock the item so two approvals cannot both take the last units.
    item = db.query(InventoryItem).filter(InventoryItem.id == req.item_id).with_for_update().first()
    requester = db.query(User).filter(User.id == req.requested_by).first()
    old_qty = None
    if decision.status == "APPROVED":
        old_qty = _change_stock(db, item, -req.quantity)
        record_movement(db, req.company_id, "ISSUE", "CONSUMABLE", current_user.id, quantity=-req.quantity,
                        inventory_item_id=item.id,
                        reason=f"Issued to {requester.full_name if requester else 'requester'} (request #{req.id[:6].upper()})")
    if decision.status == "REJECTED":
        req.rejection_reason = decision.rejection_reason.strip()
    req.status = decision.status
    req.processed_by = current_user.id
    req.processed_at = datetime.utcnow()

    if requester and requester.id != current_user.id:
        notify(
            db, requester,
            title={
                "APPROVED": f"Your request for {item.name} was approved",
                "REJECTED": f"Your request for {item.name} was rejected",
                "CANCELLED": f"Your request for {item.name} was cancelled",
            }[decision.status],
            message={
                "APPROVED": f"{current_user.full_name} issued you {req.quantity} × {item.name}.",
                "REJECTED": f"{current_user.full_name}: {req.rejection_reason}",
                "CANCELLED": f"{current_user.full_name} cancelled it.",
            }[decision.status][:300],
            link=home_link(requester, "/inventory/stock", "/agent/inventory"),
            type={"APPROVED": "SUCCESS", "REJECTED": "WARNING", "CANCELLED": "INFO"}[decision.status],
        )
    db.commit()
    db.refresh(req)

    log_audit_event(
        db=db, action="PROCESS_INVENTORY_REQUEST", entity="InventoryRequest", company_id=req.company_id,
        user_id=current_user.id, entity_id=req.id,
        new_value=f"{req.quantity} × {item.name} for {requester.full_name if requester else req.requested_by}: {req.status.lower()}",
    )
    if old_qty is not None:
        log_audit_event(
            db=db, action="ADJUST_INVENTORY_STOCK", entity="InventoryItem", company_id=item.company_id,
            user_id=current_user.id, entity_id=item.id, old_value=f"Quantity: {old_qty}",
            new_value=f"Quantity: {item.quantity} ({-req.quantity:+d}): Issued to "
                      f"{requester.full_name if requester else 'requester'} (request #{req.id[:6].upper()})",
        )
    return _request_responses(db, [req])[0]


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

    db.query(InventoryRequest).filter(InventoryRequest.item_id == item.id).delete(synchronize_session=False)
    db.query(StockMovement).filter(StockMovement.inventory_item_id == item.id).update(
        {"inventory_item_id": None}, synchronize_session=False)
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
    current_user: User = Depends(_admins),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id)
):
    """
    Receive (+) or issue (-) stock with a reason. Admins only: users ask for
    stock through POST /inventory/requests instead.
    """
    company_id = tenant_company_id or current_user.company_id
    query = db.query(InventoryItem).filter(InventoryItem.id == item_id)
    if current_user.role != PlatformRole.SUPER_ADMIN:
        query = query.filter(InventoryItem.company_id == company_id)
    # Lock the row so two people issuing stock at once cannot both pass the check.
    item = query.with_for_update().first()
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Inventory item not found.")

    ensure_new_reference(db, item.company_id, adjustment.reference)
    old_qty = _change_stock(db, item, adjustment.change)
    new_qty = item.quantity
    record_movement(db, item.company_id, "RECEIPT" if adjustment.change > 0 else "ISSUE", "CONSUMABLE",
                    current_user.id, quantity=adjustment.change, reference=adjustment.reference,
                    inventory_item_id=item.id, reason=adjustment.reason)
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
