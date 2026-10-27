"""Implementation file: app/routers/assets.py"""
from typing import Dict, List, Optional
from datetime import datetime, timedelta
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status, WebSocket, WebSocketDisconnect
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user, require_roles, get_tenant_company_id, user_from_token
from sqlalchemy.exc import IntegrityError

from app.services.stock_service import record_movement
from app.models.models import (
    Asset, AssetCategory, AssetAssignment, AssetLifecycle, AssetRequest, AssetReturnRequest, AuditScanRecord,
    Department, Maintenance, Vendor, WarrantyClaim, AssetStatusEnum, PlatformRole, User, Subscription,
    PurchaseOrder, SoftwareLicenseAssignment, StockMovement, StockReceipt,
)
from app.schemas.schemas import (
    AssetCreate, AssetResponse, AssetUpdate, AssetAssignRequest,
    AssetCategoryCreate, AssetCategoryResponse, AssetLifecycleResponse,
    AssetCountsResponse, AssetEventResponse
)
from app.services.asset_code_service import next_asset_code
from app.services.audit_service import log_audit_event
from app.services.usage_alerts import check_usage_limits
from app.services.notification_service import home_link, notify
from app.services.software_service import mask_license_number

router = APIRouter(prefix="/assets", tags=["Asset Management"])

# Status, condition and location updates are open to users (stored with the
# EMPLOYEE role); registering, editing and assigning assets is not.
_operators = require_roles([
    PlatformRole.SUPER_ADMIN, PlatformRole.IT_ADMIN, PlatformRole.SUB_ADMIN, PlatformRole.EMPLOYEE,
])
# Only admins hand assets out or take them back; users (EMPLOYEE) cannot.
# Handing devices out is the IT team's job; the Super Admin only views.
_assigners = require_roles([PlatformRole.IT_ADMIN, PlatformRole.SUB_ADMIN])
# Fields a user (EMPLOYEE) may change through PUT /assets/{id}.
_AGENT_EDITABLE_FIELDS = {"status", "status_remarks", "condition", "location_id"}

# Statuses in which someone holds the asset, so it can be unassigned.
_HELD_STATUSES = {AssetStatusEnum.ASSIGNED, AssetStatusEnum.IN_USE, AssetStatusEnum.RETURN_REQUESTED}

# Moving an asset into one of these means nobody holds it any more.
_RELEASES_ASSIGNMENT = {
    AssetStatusEnum.IN_STOCK,
    AssetStatusEnum.RETURNED,
    AssetStatusEnum.RETIRED,
    AssetStatusEnum.DISPOSED,
}


# WebSocket connection manager for real-time updates
class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, List[WebSocket]] = {}

    async def connect(self, company_id: str, websocket: WebSocket):
        await websocket.accept()
        if company_id not in self.active_connections:
            self.active_connections[company_id] = []
        self.active_connections[company_id].append(websocket)

    def disconnect(self, company_id: str, websocket: WebSocket):
        if company_id in self.active_connections:
            self.active_connections[company_id].remove(websocket)
            if not self.active_connections[company_id]:
                del self.active_connections[company_id]

    async def broadcast_to_company(self, company_id: str, message: dict):
        if company_id in self.active_connections:
            disconnected = []
            for connection in self.active_connections[company_id]:
                try:
                    await connection.send_json(message)
                except:
                    disconnected.append(connection)
            for conn in disconnected:
                self.disconnect(company_id, conn)


manager = ConnectionManager()


@router.websocket("/ws/{company_id}")
async def asset_websocket(
    websocket: WebSocket,
    company_id: str,
    token: Optional[str] = Query(None),
    db: Session = Depends(get_db)
):
    """
    WebSocket endpoint for real-time asset updates.
    Browsers cannot set headers on a WebSocket, so the JWT comes as ?token=.
    """
    user = user_from_token(token, db)
    if user is None:
        await websocket.accept()  # so the browser receives the close code
        await websocket.close(code=4401, reason="Not authenticated")
        return
    if (user.role != PlatformRole.SUPER_ADMIN and user.company_id != company_id) \
            or user.role == PlatformRole.EMPLOYEE:
        # The feed carries every asset in the company; users see only their own.
        await websocket.accept()  # so the browser receives the close code
        await websocket.close(code=4403, reason="Not allowed for this company")
        return

    await manager.connect(company_id, websocket)
    try:
        while True:
            # Keep connection alive, listen for client messages (ping/pong)
            data = await websocket.receive_text()
            # Echo back for heartbeat
            await websocket.send_text(f"pong: {data}")
    except WebSocketDisconnect:
        manager.disconnect(company_id, websocket)


# Helper to broadcast asset changes
async def broadcast_asset_update(company_id: str, event: str, asset_data: dict):
    """Call this after asset mutations to notify WebSocket clients."""
    await manager.broadcast_to_company(company_id, {
        "event": event,
        "asset": asset_data,
        "timestamp": datetime.utcnow().isoformat()
    })


def _queue_broadcast(background_tasks: BackgroundTasks, event: str, response: AssetResponse) -> None:
    """
    Schedule a WebSocket broadcast to run after the response is sent.

    These endpoints are sync, so FastAPI runs them in a worker thread with no
    event loop; asyncio.create_task would raise there. BackgroundTasks runs the
    coroutine on the main loop instead.
    """
    background_tasks.add_task(
        broadcast_asset_update, response.company_id, event, response.model_dump(mode="json")
    )


def _active_assignees(db: Session, asset_ids: List[str]) -> Dict[str, User]:
    """
    Map asset id -> currently assigned User, in a single query.

    Assignment is held in asset_assignments (one active row per asset), not on
    the asset record, so it has to be joined in rather than read off the model.
    """
    if not asset_ids:
        return {}
    rows = (
        db.query(AssetAssignment.asset_id, User)
        .join(User, User.id == AssetAssignment.user_id)
        .filter(
            AssetAssignment.asset_id.in_(asset_ids),
            AssetAssignment.is_active.is_(True),
        )
        .all()
    )
    return {asset_id: user for asset_id, user in rows}


def _check_references(db: Session, company_id: str, data: dict) -> None:
    """Department and vendors must belong to the asset's organization; warranty and AMC must end after they start."""
    if data.get("department_id") and not db.query(Department.id).filter(
        Department.id == data["department_id"], Department.company_id == company_id
    ).first():
        raise HTTPException(status_code=400, detail="Unknown department.")
    if data.get("vendor_id") and not db.query(Vendor.id).filter(
        Vendor.id == data["vendor_id"], Vendor.company_id == company_id
    ).first():
        raise HTTPException(status_code=400, detail="Unknown vendor.")
    start, end = data.get("warranty_start"), data.get("warranty_end")
    if start and end and end < start:
        raise HTTPException(status_code=400, detail="Warranty end must be after warranty start.")
    if data.get("amc_vendor_id") and not db.query(Vendor.id).filter(
        Vendor.id == data["amc_vendor_id"], Vendor.company_id == company_id
    ).first():
        raise HTTPException(status_code=400, detail="Unknown AMC vendor.")
    amc_start, amc_end = data.get("amc_start"), data.get("amc_end")
    if amc_start and amc_end and amc_end < amc_start:
        raise HTTPException(status_code=400, detail="AMC end must be after AMC start.")
    purchased, license_expiry = data.get("purchase_date"), data.get("license_expiry")
    if purchased and license_expiry and license_expiry < purchased:
        raise HTTPException(status_code=400, detail="License expiry must be after the purchase date.")


def _held_by(db: Session, user: User):
    """Ids of the assets this user currently holds (a subquery)."""
    return db.query(AssetAssignment.asset_id).filter(
        AssetAssignment.user_id == user.id, AssetAssignment.is_active == True
    )


def _held_since(db: Session, user: User) -> Dict[str, datetime]:
    """Asset id -> when this user was given it (a few seconds early, so the
    lifecycle entry written alongside the hand-over is included)."""
    rows = db.query(AssetAssignment.asset_id, AssetAssignment.assigned_at).filter(
        AssetAssignment.user_id == user.id, AssetAssignment.is_active == True
    ).all()
    return {
        asset_id: assigned_at - timedelta(seconds=5) if assigned_at else datetime(1970, 1, 1)
        for asset_id, assigned_at in rows
    }


def _only_own(query, db: Session, user: User):
    """Users (EMPLOYEE) see only the assets assigned to them; other roles are unchanged."""
    if user.role == PlatformRole.EMPLOYEE:
        return query.filter(Asset.id.in_(_held_by(db, user)))
    return query


def _for_viewer(response: AssetResponse, viewer: User) -> AssetResponse:
    """Users see only the last four characters of a device's license number; admins see it in full."""
    if viewer.role == PlatformRole.EMPLOYEE and response.license_number:
        response.license_number = mask_license_number(response.license_number)
    return response


def _with_assignee(asset: Asset, assignee: Optional[User]) -> AssetResponse:
    """Build the response and attach the current holder, when there is one."""
    response = AssetResponse.model_validate(asset)
    if assignee is not None:
        response.assigned_to_id = assignee.id
        response.assigned_to_name = assignee.full_name
        response.assigned_to_email = assignee.email
    return response


# --- Asset Categories ---

@router.post("/categories", response_model=AssetCategoryResponse, status_code=status.HTTP_201_CREATED)
def create_asset_category(
    category_in: AssetCategoryCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(_operators),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id)
):
    """
    Create a new asset category for item classification. IT Agents may add
    one while raising a ticket.
    """
    company_id = tenant_company_id or current_user.company_id
    if not company_id:
        raise HTTPException(status_code=400, detail="Company context required.")

    name = category_in.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Category name is required.")
    if db.query(AssetCategory.id).filter(
        AssetCategory.company_id == company_id, func.lower(AssetCategory.name) == name.lower()
    ).first():
        raise HTTPException(status_code=400, detail=f"A category named '{name}' already exists.")

    category = AssetCategory(
        company_id=company_id,
        name=name,
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
    return query.order_by(AssetCategory.name).all()


# --- Asset CRUD Operations ---

@router.post("", response_model=AssetResponse, status_code=status.HTTP_201_CREATED)
def create_asset(
    asset_in: AssetCreate,
    background_tasks: BackgroundTasks,
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

    _check_references(db, company_id, asset_in.model_dump())

    # Serial numbers are optional; when given they are unique per organization. Asset numbers may repeat:
    # every device gets its own Asset ID.
    if asset_in.serial_number and db.query(Asset.id).filter(Asset.company_id == company_id,
                                                            Asset.serial_number == asset_in.serial_number).first():
        raise HTTPException(status_code=400, detail="An asset with this serial number already exists.")

    # Registering a device from a stock receipt: the receipt must have units left.
    receipt = None
    if asset_in.receipt_id:
        receipt = db.query(StockReceipt).filter(
            StockReceipt.id == asset_in.receipt_id, StockReceipt.company_id == company_id
        ).with_for_update().first()
        if not receipt:
            raise HTTPException(status_code=404, detail="Stock receipt not found.")
        registered = db.query(Asset).filter(Asset.receipt_id == receipt.id).count()
        if registered >= receipt.quantity:
            raise HTTPException(status_code=400, detail=f"All {receipt.quantity} devices on this receipt are already registered.")

    po = db.query(PurchaseOrder).filter(PurchaseOrder.id == receipt.purchase_order_id).first() if receipt else None
    asset = Asset(
        company_id=company_id,
        asset_code=next_asset_code(db, company_id),
        asset_tag=asset_in.asset_tag,
        serial_number=asset_in.serial_number,
        name=asset_in.name,
        # From the receipt when the form leaves them out.
        category=(receipt.category if receipt and asset_in.category == "Uncategorised" else asset_in.category),
        type=asset_in.type,
        brand=asset_in.brand or (receipt.brand if receipt else None),
        model=asset_in.model or (receipt.model if receipt else None),
        specifications=asset_in.specifications or (receipt.specifications if receipt else None),
        purchase_date=asset_in.purchase_date or (po.order_date if po else None),
        purchase_price=asset_in.purchase_price or (receipt.unit_cost if receipt else asset_in.purchase_price),
        vendor_id=asset_in.vendor_id or (po.vendor_id if po else None),
        warranty_start=asset_in.warranty_start,
        warranty_end=asset_in.warranty_end,
        amc_vendor_id=asset_in.amc_vendor_id,
        amc_start=asset_in.amc_start,
        amc_end=asset_in.amc_end,
        amc_cost=asset_in.amc_cost,
        license_type=asset_in.license_type,
        license_number=asset_in.license_number,
        license_expiry=asset_in.license_expiry,
        location_id=asset_in.location_id or (receipt.location if receipt else None),
        department_id=asset_in.department_id,
        status=asset_in.status,
        condition=asset_in.condition,
        description=asset_in.description,
        receipt_id=receipt.id if receipt else None,
        created_by=current_user.id
    )
    db.add(asset)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="An asset with this asset tag or serial number already exists.")
    record_movement(db, company_id, "REGISTER", "HARDWARE", current_user.id, asset_id=asset.id,
                    receipt_id=asset.receipt_id, to_location=asset.location_id,
                    reason=f"Registered {asset.label}" + (" from a stock receipt" if receipt else ""))

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
    check_usage_limits(db, company_id)
    db.commit()
    db.refresh(asset)

    log_audit_event(
        db=db,
        action="CREATE_ASSET",
        entity="Asset",
        company_id=company_id,
        user_id=current_user.id,
        entity_id=asset.id,
        new_value=f"Tag: {asset.label}, Name: {asset.name}"
    )

    # A new asset has no assignment yet.
    response = _with_assignee(asset, None)
    _queue_broadcast(background_tasks, "ASSET_CREATED", response)
    return response


@router.get("", response_model=List[AssetResponse])
def list_assets(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    status_filter: Optional[AssetStatusEnum] = Query(None, alias="status"),
    category: Optional[str] = None,
    department_id: Optional[str] = None,
    search: Optional[str] = None,
    assigned_to: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id)
):
    """
    List assets with multi-parameter filtering and search capability.
    assigned_to limits it to assets a given user currently holds.
    """
    query = db.query(Asset)
    if current_user.role != PlatformRole.SUPER_ADMIN:
        query = query.filter(Asset.company_id == tenant_company_id)
    query = _only_own(query, db, current_user)

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
            (Asset.asset_code.ilike(search_fmt)) |
            (Asset.serial_number.ilike(search_fmt))
        )

    if assigned_to:
        query = query.join(AssetAssignment, AssetAssignment.asset_id == Asset.id).filter(
            AssetAssignment.user_id == assigned_to, AssetAssignment.is_active.is_(True)
        )

    assets = query.offset(skip).limit(limit).all()
    assignees = _active_assignees(db, [asset.id for asset in assets])
    return [_for_viewer(_with_assignee(asset, assignees.get(asset.id)), current_user) for asset in assets]


@router.get("/counts", response_model=AssetCountsResponse)
def get_asset_counts(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id)
):
    """
    Get asset counts for dashboard badges, plus a count for every status.
    """
    company_id = tenant_company_id or current_user.company_id
    if not company_id and current_user.role != PlatformRole.SUPER_ADMIN:
        raise HTTPException(status_code=400, detail="Company context required")

    query = db.query(Asset.status, func.count()).group_by(Asset.status)
    if current_user.role != PlatformRole.SUPER_ADMIN:
        query = query.filter(Asset.company_id == company_id)
    query = _only_own(query, db, current_user)

    by_status = {value.value: 0 for value in AssetStatusEnum}
    for asset_status, count in query.all():
        by_status[asset_status.value] = count

    return AssetCountsResponse(
        total=sum(by_status.values()),
        in_stock=by_status[AssetStatusEnum.IN_STOCK.value],
        assigned=by_status[AssetStatusEnum.ASSIGNED.value],
        in_repair=by_status[AssetStatusEnum.IN_REPAIR.value],
        by_status=by_status,
    )


@router.get("/events", response_model=List[AssetEventResponse])
def list_asset_events(
    search: Optional[str] = None,
    action: Optional[str] = None,
    date_from: Optional[datetime] = None,
    date_to: Optional[datetime] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=1000),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id)
):
    """
    Company-wide lifecycle events (creation, assignment, status changes), newest
    first, with the asset and performing user attached.
    """
    query = (
        db.query(AssetLifecycle, Asset.asset_tag, Asset.name, User.full_name)
        .join(Asset, Asset.id == AssetLifecycle.asset_id)
        .outerjoin(User, User.id == AssetLifecycle.performed_by)
    )
    if current_user.role != PlatformRole.SUPER_ADMIN:
        query = query.filter(AssetLifecycle.company_id == tenant_company_id)
    if current_user.role == PlatformRole.EMPLOYEE:
        # Events on the assets they hold, since each was handed to them.
        held = _held_since(db, current_user)
        if not held:
            return []
        query = query.filter(or_(*[
            (AssetLifecycle.asset_id == asset_id) & (AssetLifecycle.timestamp >= since)
            for asset_id, since in held.items()
        ]))
    if action:
        query = query.filter(AssetLifecycle.action == action)
    if date_from:
        query = query.filter(AssetLifecycle.timestamp >= date_from)
    if date_to:
        query = query.filter(AssetLifecycle.timestamp <= date_to)
    if search:
        search_fmt = f"%{search}%"
        query = query.filter(Asset.name.ilike(search_fmt) | Asset.asset_tag.ilike(search_fmt))

    rows = query.order_by(AssetLifecycle.timestamp.desc()).offset(skip).limit(limit).all()
    return [
        AssetEventResponse(
            **AssetLifecycleResponse.model_validate(entry).model_dump(),
            asset_tag=asset_tag,
            asset_name=asset_name,
            performed_by_name=performed_by_name,
        )
        for entry, asset_tag, asset_name, performed_by_name in rows
    ]


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
    query = _only_own(query, db, current_user)

    asset = query.first()
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found.")
    response = _with_assignee(asset, _active_assignees(db, [asset.id]).get(asset.id))
    if response.assigned_to_id:
        handed = db.query(AssetAssignment.assigned_at, User.full_name).outerjoin(
            User, User.id == AssetAssignment.assigned_by
        ).filter(AssetAssignment.asset_id == asset.id, AssetAssignment.is_active.is_(True)).first()
        if handed:
            response.assigned_at, response.assigned_by_name = handed
    return _for_viewer(response, current_user)


@router.put("/{asset_id}", response_model=AssetResponse)
def update_asset(
    asset_id: str,
    asset_in: AssetUpdate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(_operators),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id)
):
    """
    Update asset properties and automatically record status lifecycle changes.
    """
    query = db.query(Asset).filter(Asset.id == asset_id)
    if current_user.role != PlatformRole.SUPER_ADMIN:
        query = query.filter(Asset.company_id == tenant_company_id)
    query = _only_own(query, db, current_user)

    asset = query.first()
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found.")

    old_status = asset.status.value
    update_data = asset_in.model_dump(exclude_unset=True)
    if current_user.role == PlatformRole.EMPLOYEE:
        blocked = sorted(set(update_data) - _AGENT_EDITABLE_FIELDS)
        if blocked:
            raise HTTPException(
                status_code=403,
                detail=f"Users can change status, condition and location only (not: {', '.join(blocked)})."
            )
    status_remarks = update_data.pop("status_remarks", None)
    _check_references(db, asset.company_id, {
        "department_id": update_data.get("department_id"),
        "vendor_id": update_data.get("vendor_id"),
        "warranty_start": update_data.get("warranty_start", asset.warranty_start),
        "warranty_end": update_data.get("warranty_end", asset.warranty_end),
        "amc_vendor_id": update_data.get("amc_vendor_id"),
        "amc_start": update_data.get("amc_start", asset.amc_start),
        "amc_end": update_data.get("amc_end", asset.amc_end),
        "purchase_date": update_data.get("purchase_date", asset.purchase_date),
        "license_expiry": update_data.get("license_expiry", asset.license_expiry),
    })
    if "serial_number" in update_data:
        update_data["serial_number"] = (update_data["serial_number"] or "").strip() or None
        if update_data["serial_number"] and db.query(Asset.id).filter(
            Asset.company_id == asset.company_id, Asset.serial_number == update_data["serial_number"], Asset.id != asset.id
        ).first():
            raise HTTPException(status_code=400, detail="An asset with this serial number already exists.")
    if "category" in update_data and not (update_data["category"] or "").strip():
        update_data["category"] = "Uncategorised"
    status_changed = asset_in.status is not None and asset_in.status.value != old_status

    # A status such as In stock or Retired takes the asset back from its holder,
    # which is the IT Admin's call, like unassigning.
    if (status_changed and current_user.role == PlatformRole.EMPLOYEE
            and asset_in.status in _RELEASES_ASSIGNMENT
            and _active_assignees(db, [asset.id]).get(asset.id) is not None):
        raise HTTPException(
            status_code=403,
            detail="This asset is assigned to someone. Only an IT Admin can take it back."
        )

    # Assignment lives in asset_assignments, so a bare status edit would claim
    # the asset is assigned with no holder on record.
    if status_changed and asset_in.status == AssetStatusEnum.ASSIGNED:
        raise HTTPException(
            status_code=400,
            detail="Use POST /assets/{id}/assign to assign an asset to a user."
        )

    for field, value in update_data.items():
        setattr(asset, field, value)

    if status_changed:
        if asset.status in _RELEASES_ASSIGNMENT:
            db.query(AssetAssignment).filter(
                AssetAssignment.asset_id == asset.id,
                AssetAssignment.is_active.is_(True)
            ).update({"is_active": False, "returned_at": datetime.utcnow()})

        if asset.status == AssetStatusEnum.IN_REPAIR or asset.status in (AssetStatusEnum.RETIRED, AssetStatusEnum.DISPOSED):
            record_movement(db, asset.company_id, "REPAIR" if asset.status == AssetStatusEnum.IN_REPAIR else "RETIRE",
                            "HARDWARE", current_user.id, asset_id=asset.id,
                            reason=status_remarks or f"Status changed to {asset.status.value}")
        lifecycle = AssetLifecycle(
            company_id=asset.company_id,
            asset_id=asset.id,
            action="STATUS_CHANGE",
            previous_status=old_status,
            new_status=asset.status.value,
            performed_by=current_user.id,
            remarks=status_remarks or f"Asset status updated manually from {old_status} to {asset.status.value}."
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
        old_value=f"{asset.label} status: {old_status}",
        new_value=f"{asset.label} status: {asset.status.value}"
    )

    response = _with_assignee(asset, _active_assignees(db, [asset.id]).get(asset.id))
    _queue_broadcast(background_tasks, "ASSET_UPDATED", response)
    return _for_viewer(response.model_copy(), current_user)


@router.post("/{asset_id}/assign", response_model=AssetResponse)
def assign_asset_to_user(
    asset_id: str,
    assign_in: AssetAssignRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(_assigners),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id)
):
    """
    Assign an available asset to an employee.
    """
    query = db.query(Asset).filter(Asset.id == asset_id)
    if current_user.role != PlatformRole.SUPER_ADMIN:
        query = query.filter(Asset.company_id == tenant_company_id)
    query = _only_own(query, db, current_user)

    # Lock the row: two simultaneous assignments of the same device cannot both pass.
    asset = query.with_for_update().first()
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found.")

    if asset.status == AssetStatusEnum.REQUESTED:
        # Reserved for an approved ticket: it is handed over from that ticket.
        raise HTTPException(status_code=400, detail="This asset is reserved for a ticket. Hand it over from that ticket.")
    if asset.status != AssetStatusEnum.IN_STOCK:
        raise HTTPException(
            status_code=400,
            detail=f"Asset cannot be assigned because its status is currently {asset.status.value}."
        )

    # The holder must be an active user of the asset's own organization.
    target_user = db.query(User).filter(
        User.id == assign_in.user_id,
        User.status == "ACTIVE",
        User.company_id == asset.company_id,
    ).first()
    if not target_user:
        raise HTTPException(status_code=404, detail="Target active user not found.")
    if target_user.role != PlatformRole.EMPLOYEE:
        raise HTTPException(status_code=400, detail="Assets can only be assigned to users, not to IT Admins or the Super Admin.")

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
        assigned_by=current_user.id,
        is_active=True
    )
    db.add(new_assignment)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="This asset was just assigned by someone else.")
    record_movement(db, asset.company_id, "ASSIGN", "HARDWARE", current_user.id, asset_id=asset.id,
                    reason=f"Assigned to {target_user.full_name}")

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
    if target_user.id != current_user.id:
        notify(
            db, target_user,
            title=f"{asset.name} ({asset.label}) was assigned to you",
            message=f"Assigned by {current_user.full_name}.",
            link=home_link(target_user, f"/assets/{asset.id}", "/agent/assets"),
        )

    db.commit()
    db.refresh(asset)

    log_audit_event(
        db=db,
        action="ASSIGN_ASSET",
        entity="Asset",
        company_id=asset.company_id,
        user_id=current_user.id,
        entity_id=asset.id,
        new_value=f"{asset.label} assigned to {target_user.full_name}"
    )

    response = _with_assignee(asset, target_user)
    _queue_broadcast(background_tasks, "ASSET_ASSIGNED", response)
    return response


@router.post("/{asset_id}/unassign", response_model=AssetResponse)
def unassign_asset(
    asset_id: str,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(_assigners),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id)
):
    """
    Unassign an asset and return it to active inventory stock.
    """
    query = db.query(Asset).filter(Asset.id == asset_id)
    if current_user.role != PlatformRole.SUPER_ADMIN:
        query = query.filter(Asset.company_id == tenant_company_id)
    query = _only_own(query, db, current_user)

    asset = query.first()
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found.")

    held = db.query(AssetAssignment.id).filter(
        AssetAssignment.asset_id == asset.id, AssetAssignment.is_active == True
    ).first()
    if not held and asset.status not in _HELD_STATUSES:
        raise HTTPException(status_code=400, detail="This asset is not assigned to anyone.")

    old_status = asset.status.value
    asset.status = AssetStatusEnum.IN_STOCK

    db.query(AssetAssignment).filter(
        AssetAssignment.asset_id == asset.id, 
        AssetAssignment.is_active == True
    ).update({"is_active": False, "returned_at": datetime.utcnow()})
    record_movement(db, asset.company_id, "RETURN", "HARDWARE", current_user.id, asset_id=asset.id,
                    reason="Returned to stock")

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

    log_audit_event(
        db=db,
        action="UNASSIGN_ASSET",
        entity="Asset",
        company_id=asset.company_id,
        user_id=current_user.id,
        entity_id=asset.id,
        new_value=f"Returned to stock: {asset.label}"
    )

    # The active assignment was just closed, so there is no holder.
    response = _with_assignee(asset, None)
    _queue_broadcast(background_tasks, "ASSET_UNASSIGNED", response)
    return response


@router.delete("/{asset_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_asset(
    asset_id: str,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles([PlatformRole.SUPER_ADMIN, PlatformRole.IT_ADMIN, PlatformRole.SUB_ADMIN])),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id)
):
    """
    Permanently remove an asset registered by mistake or no longer tracked.
    Its own records (history, assignments, maintenance, warranty claims, return
    requests) go with it; tickets and audit scans that mention it are kept with
    the link cleared. The audit log keeps a record of the removal.
    """
    query = db.query(Asset).filter(Asset.id == asset_id)
    if current_user.role != PlatformRole.SUPER_ADMIN:
        query = query.filter(Asset.company_id == tenant_company_id)
    asset = query.first()
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found.")

    held = db.query(AssetAssignment.id).filter(
        AssetAssignment.asset_id == asset.id, AssetAssignment.is_active == True
    ).first()
    if held or asset.status in _HELD_STATUSES:
        raise HTTPException(status_code=400, detail="This asset is assigned to someone. Unassign it before removing it.")

    response = _with_assignee(asset, None)
    for model in (AssetLifecycle, AssetAssignment, AssetReturnRequest, Maintenance, WarrantyClaim):
        db.query(model).filter(model.asset_id == asset.id).delete(synchronize_session=False)
    db.query(AssetRequest).filter(AssetRequest.assigned_asset_id == asset.id).update(
        {"assigned_asset_id": None}, synchronize_session=False
    )
    db.query(AssetRequest).filter(AssetRequest.asset_id == asset.id).update(
        {"asset_id": None}, synchronize_session=False
    )
    db.query(AuditScanRecord).filter(AuditScanRecord.asset_id == asset.id).update(
        {"asset_id": None}, synchronize_session=False
    )
    db.query(StockMovement).filter(StockMovement.asset_id == asset.id).update(
        {"asset_id": None}, synchronize_session=False
    )
    db.query(SoftwareLicenseAssignment).filter(SoftwareLicenseAssignment.asset_id == asset.id).update(
        {"asset_id": None}, synchronize_session=False
    )
    # Tag and serial number are optional, so fall back to the name.
    label = response.asset_tag or (f"S/N {response.serial_number}" if response.serial_number else response.name)
    db.delete(asset)
    db.commit()

    log_audit_event(
        db=db,
        action="DELETE_ASSET",
        entity="Asset",
        company_id=response.company_id,
        user_id=current_user.id,
        entity_id=response.id,
        old_value=f"{label} - {response.name} ({response.status.value})" if label != response.name
        else f"{response.name} ({response.status.value})",
    )
    _queue_broadcast(background_tasks, "ASSET_DELETED", response)
    return None


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
    asset_query = db.query(Asset.id).filter(Asset.id == asset_id)
    if current_user.role != PlatformRole.SUPER_ADMIN:
        asset_query = asset_query.filter(Asset.company_id == tenant_company_id)
    if not _only_own(asset_query, db, current_user).first():
        raise HTTPException(status_code=404, detail="Asset not found.")
    query = db.query(AssetLifecycle).filter(AssetLifecycle.asset_id == asset_id)
    if current_user.role == PlatformRole.EMPLOYEE:
        # Only what happened since it was handed to them, not earlier holders' history.
        query = query.filter(AssetLifecycle.timestamp >= _held_since(db, current_user)[asset_id])
    return query.order_by(AssetLifecycle.timestamp.desc()).all()