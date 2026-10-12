"""Implementation file: app/routers/maintenance.py

Repairs and servicing for assets. Starting work moves the asset to IN_REPAIR;
completing or cancelling it returns the asset to its holder (ASSIGNED) or to
stock, and each move is written to the asset's lifecycle.
"""
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user, get_tenant_company_id, require_roles
from app.models.models import (
    Asset, AssetAssignment, AssetLifecycle, AssetStatusEnum, Maintenance, PlatformRole, User, Vendor,
)
from app.schemas.schemas import MaintenanceCreate, MaintenanceResponse, MaintenanceUpdate
from app.services.audit_service import log_audit_event
from app.services.notification_service import home_link, notify

router = APIRouter(prefix="/maintenance", tags=["Maintenance Management"])

# IT Agents (stored as EMPLOYEE) log and close repairs too.
_operators = require_roles([
    PlatformRole.SUPER_ADMIN, PlatformRole.IT_ADMIN, PlatformRole.SUB_ADMIN, PlatformRole.EMPLOYEE,
])
_OPEN = {"SCHEDULED", "IN_PROGRESS"}
_UNREPAIRABLE = {AssetStatusEnum.RETIRED, AssetStatusEnum.DISPOSED, AssetStatusEnum.LOST}


def _company_id(current_user: User, tenant_company_id: Optional[str]) -> str:
    company_id = tenant_company_id or current_user.company_id
    if not company_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Company context required.")
    return company_id


def _move_asset(db: Session, asset: Asset, new_status: AssetStatusEnum, user_id: str, remarks: str) -> None:
    if asset.status == new_status:
        return
    db.add(AssetLifecycle(
        company_id=asset.company_id,
        asset_id=asset.id,
        action="STATUS_CHANGE",
        previous_status=asset.status.value,
        new_status=new_status.value,
        performed_by=user_id,
        remarks=remarks,
    ))
    asset.status = new_status


def _tell_holder(db: Session, asset: Asset, actor: User, title: str, message: str, type: str = "INFO") -> None:
    """Notify whoever currently holds the asset (unless they made the change)."""
    holder = (
        db.query(User)
        .join(AssetAssignment, AssetAssignment.user_id == User.id)
        .filter(AssetAssignment.asset_id == asset.id, AssetAssignment.is_active.is_(True))
        .first()
    )
    if holder and holder.id != actor.id:
        notify(db, holder, title, message[:200], home_link(holder, f"/assets/{asset.id}", "/agent/assets"), type)


def _status_after_repair(db: Session, asset: Asset) -> AssetStatusEnum:
    held = db.query(AssetAssignment.id).filter(
        AssetAssignment.asset_id == asset.id, AssetAssignment.is_active.is_(True)
    ).first()
    return AssetStatusEnum.ASSIGNED if held else AssetStatusEnum.IN_STOCK


def _responses(db: Session, records: List[Maintenance]) -> List[MaintenanceResponse]:
    asset_ids = {r.asset_id for r in records}
    vendor_ids = {r.vendor_id for r in records if r.vendor_id}
    user_ids = {r.reported_by for r in records}
    assets = {a.id: a for a in db.query(Asset).filter(Asset.id.in_(asset_ids)).all()} if asset_ids else {}
    vendors = dict(db.query(Vendor.id, Vendor.name).filter(Vendor.id.in_(vendor_ids)).all()) if vendor_ids else {}
    users = dict(db.query(User.id, User.full_name).filter(User.id.in_(user_ids)).all()) if user_ids else {}
    result = []
    for record in records:
        response = MaintenanceResponse.model_validate(record)
        asset = assets.get(record.asset_id)
        response.asset_tag = asset.asset_tag if asset else None
        response.asset_name = asset.name if asset else None
        response.vendor_name = vendors.get(record.vendor_id)
        response.reported_by_name = users.get(record.reported_by)
        result.append(response)
    return result


def _get(db: Session, maintenance_id: str, current_user: User, tenant_company_id: Optional[str]) -> Maintenance:
    query = db.query(Maintenance).filter(Maintenance.id == maintenance_id)
    if current_user.role != PlatformRole.SUPER_ADMIN:
        query = query.filter(Maintenance.company_id == _company_id(current_user, tenant_company_id))
    record = query.first()
    if not record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Maintenance record not found.")
    return record


@router.post("", response_model=MaintenanceResponse, status_code=status.HTTP_201_CREATED)
def create_maintenance_log(
    maintenance_in: MaintenanceCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(_operators),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id)
):
    """Log a repair or service job for an asset."""
    company_id = _company_id(current_user, tenant_company_id)
    asset = db.query(Asset).filter(Asset.id == maintenance_in.asset_id, Asset.company_id == company_id).first()
    if not asset:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Asset not found.")
    if asset.status in _UNREPAIRABLE:
        raise HTTPException(status_code=400, detail=f"A {asset.status.value.lower()} asset cannot be sent for maintenance.")
    if db.query(Maintenance.id).filter(Maintenance.asset_id == asset.id, Maintenance.status.in_(_OPEN)).first():
        raise HTTPException(status_code=400, detail="This asset already has open maintenance. Close it first.")
    if maintenance_in.vendor_id and not db.query(Vendor.id).filter(
        Vendor.id == maintenance_in.vendor_id, Vendor.company_id == company_id
    ).first():
        raise HTTPException(status_code=400, detail="Unknown vendor.")

    record = Maintenance(
        company_id=company_id,
        asset_id=asset.id,
        issue=maintenance_in.issue.strip(),
        reported_by=current_user.id,
        vendor_id=maintenance_in.vendor_id or None,
        cost=maintenance_in.cost,
        status=maintenance_in.status,
        start_date=datetime.utcnow(),
    )
    db.add(record)
    if record.status == "IN_PROGRESS":
        _move_asset(db, asset, AssetStatusEnum.IN_REPAIR, current_user.id, f"Maintenance: {record.issue[:200]}")
        _tell_holder(db, asset, current_user, f"Your {asset.name} ({asset.asset_tag}) went for repair", record.issue)
    db.commit()
    db.refresh(record)

    log_audit_event(
        db=db,
        action="CREATE_MAINTENANCE",
        entity="Maintenance",
        company_id=company_id,
        user_id=current_user.id,
        entity_id=record.id,
        new_value=f"{asset.asset_tag}: {record.issue[:120]}"
    )
    return _responses(db, [record])[0]


@router.get("", response_model=List[MaintenanceResponse])
def list_maintenance_logs(
    asset_id: Optional[str] = None,
    maintenance_status: Optional[str] = Query(None, alias="status"),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id)
):
    """Maintenance records, newest first."""
    query = db.query(Maintenance)
    if current_user.role != PlatformRole.SUPER_ADMIN:
        query = query.filter(Maintenance.company_id == _company_id(current_user, tenant_company_id))
    if asset_id:
        query = query.filter(Maintenance.asset_id == asset_id)
    if maintenance_status:
        query = query.filter(Maintenance.status == maintenance_status)
    return _responses(db, query.order_by(Maintenance.start_date.desc()).offset(skip).limit(limit).all())


@router.get("/{maintenance_id}", response_model=MaintenanceResponse)
def get_maintenance_log(
    maintenance_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id)
):
    return _responses(db, [_get(db, maintenance_id, current_user, tenant_company_id)])[0]


@router.put("/{maintenance_id}", response_model=MaintenanceResponse)
def update_maintenance_log(
    maintenance_id: str,
    maintenance_in: MaintenanceUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(_operators),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id)
):
    """Update details, start work, or close it (COMPLETED / CANCELLED)."""
    record = _get(db, maintenance_id, current_user, tenant_company_id)
    if record.status not in _OPEN:
        raise HTTPException(status_code=400, detail="This maintenance record is already closed.")
    update = maintenance_in.model_dump(exclude_unset=True)
    if update.get("vendor_id") and not db.query(Vendor.id).filter(
        Vendor.id == update["vendor_id"], Vendor.company_id == record.company_id
    ).first():
        raise HTTPException(status_code=400, detail="Unknown vendor.")

    old_status = record.status
    for field, value in update.items():
        setattr(record, field, value)

    asset = db.query(Asset).filter(Asset.id == record.asset_id).first()
    if asset and record.status != old_status:
        if record.status == "IN_PROGRESS":
            _move_asset(db, asset, AssetStatusEnum.IN_REPAIR, current_user.id, f"Maintenance started: {record.issue[:200]}")
            _tell_holder(db, asset, current_user, f"Your {asset.name} ({asset.asset_tag}) went for repair", record.issue)
        elif record.status in ("COMPLETED", "CANCELLED"):
            record.completion_date = datetime.utcnow()
            if asset.status == AssetStatusEnum.IN_REPAIR:
                _move_asset(
                    db, asset, _status_after_repair(db, asset), current_user.id,
                    f"Maintenance {record.status.lower()}: {record.issue[:200]}",
                )
            if record.status == "COMPLETED":
                _tell_holder(db, asset, current_user, f"Your {asset.name} ({asset.asset_tag}) is back from repair", record.issue, "SUCCESS")
            reporter = db.query(User).filter(User.id == record.reported_by).first()
            if reporter and reporter.id != current_user.id:
                notify(
                    db, reporter, f"Repair {record.status.lower()}: {asset.asset_tag}", record.issue[:200],
                    home_link(reporter, f"/assets/{asset.id}", "/agent/assets"),
                    "SUCCESS" if record.status == "COMPLETED" else "INFO",
                )
    db.commit()
    db.refresh(record)

    log_audit_event(
        db=db,
        action="UPDATE_MAINTENANCE",
        entity="Maintenance",
        company_id=record.company_id,
        user_id=current_user.id,
        entity_id=record.id,
        old_value=f"Status: {old_status}",
        new_value=f"{asset.asset_tag if asset else record.asset_id}: {record.status}"
    )
    return _responses(db, [record])[0]


@router.delete("/{maintenance_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_maintenance_log(
    maintenance_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles([PlatformRole.SUPER_ADMIN, PlatformRole.IT_ADMIN])),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id)
):
    """Delete a record logged by mistake. Open work must be cancelled first."""
    record = _get(db, maintenance_id, current_user, tenant_company_id)
    if record.status in _OPEN:
        raise HTTPException(status_code=400, detail="Cancel open maintenance before deleting it.")
    db.delete(record)
    db.commit()
    log_audit_event(
        db=db, action="DELETE_MAINTENANCE", entity="Maintenance", company_id=record.company_id,
        user_id=current_user.id, entity_id=maintenance_id,
    )
