"""Implementation file: app/routers/discovery.py

Devices reported by network scans or endpoint agents. Each one is reviewed and
either promoted to a tracked asset (MANAGED) or IGNORED.
"""
from datetime import datetime
from decimal import Decimal
from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_tenant_company_id, require_roles
from app.models.models import Asset, AssetLifecycle, AssetStatusEnum, DiscoveredDevice, PlatformRole, User
from app.services.audit_service import log_audit_event

router = APIRouter(prefix="/discovery", tags=["Automated Network & Agent Discovery"])

_admins = require_roles([PlatformRole.SUPER_ADMIN, PlatformRole.IT_ADMIN, PlatformRole.SUB_ADMIN])
DeviceStatus = Literal["UNMANAGED", "MANAGED", "IGNORED"]


class AgentIngestPayload(BaseModel):
    hostname: str = Field(..., min_length=1, max_length=150)
    ip_address: str = Field(..., max_length=50)
    mac_address: str = Field(..., min_length=1, max_length=50)
    device_type: Optional[str] = Field(None, max_length=50)
    os_name: Optional[str] = Field(None, max_length=150)
    serial_number: Optional[str] = Field(None, max_length=100)
    cpu_model: Optional[str] = Field(None, max_length=150)
    ram_gb: Optional[Decimal] = Field(None, ge=0)


class DiscoveredDeviceOut(BaseModel):
    id: str
    hostname: Optional[str] = None
    ip_address: str
    mac_address: str
    device_type: Optional[str] = None
    os_name: Optional[str] = None
    serial_number: Optional[str] = None
    cpu_model: Optional[str] = None
    ram_gb: Optional[Decimal] = None
    last_seen: Optional[datetime] = None
    status: str

    model_config = ConfigDict(from_attributes=True)


class ReconcileRequest(BaseModel):
    asset_tag: str = Field(..., min_length=1, max_length=100)
    category: str = Field(..., min_length=1, max_length=100)
    name: Optional[str] = Field(None, max_length=150)


def _company_id(current_user: User, tenant_company_id: Optional[str]) -> str:
    company_id = tenant_company_id or current_user.company_id
    if not company_id:
        raise HTTPException(status_code=400, detail="Company context required.")
    return company_id


def _device(db: Session, device_id: str, current_user: User, tenant_company_id: Optional[str]) -> DiscoveredDevice:
    query = db.query(DiscoveredDevice).filter(DiscoveredDevice.id == device_id)
    if current_user.role != PlatformRole.SUPER_ADMIN:
        query = query.filter(DiscoveredDevice.company_id == _company_id(current_user, tenant_company_id))
    device = query.first()
    if not device:
        raise HTTPException(status_code=404, detail="Discovered device not found.")
    return device


@router.post("/agent-ingest", status_code=status.HTTP_201_CREATED)
def agent_discovery_ingest(
    payload: AgentIngestPayload,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles([PlatformRole.SUPER_ADMIN, PlatformRole.IT_ADMIN])),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id)
):
    """
    Record a device seen by a scan or agent, matched on MAC address. A device
    already promoted or ignored keeps that status; only its details refresh.
    """
    company_id = _company_id(current_user, tenant_company_id)
    mac = payload.mac_address.strip().lower()
    device = db.query(DiscoveredDevice).filter(
        DiscoveredDevice.company_id == company_id, DiscoveredDevice.mac_address == mac
    ).first()
    if not device:
        device = DiscoveredDevice(company_id=company_id, mac_address=mac, status="UNMANAGED")
        db.add(device)

    for field in ("hostname", "ip_address", "device_type", "os_name", "serial_number", "cpu_model", "ram_gb"):
        value = getattr(payload, field)
        if value is not None:
            setattr(device, field, value)
    device.last_seen = datetime.utcnow()
    db.commit()
    return {"message": "Agent discovery data ingested.", "device_id": device.id, "status": device.status}


@router.get("/devices", response_model=List[DiscoveredDeviceOut])
def list_discovered_devices(
    device_status: Optional[DeviceStatus] = Query(None, alias="status"),
    db: Session = Depends(get_db),
    current_user: User = Depends(_admins),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id)
):
    """Every discovered device, most recently seen first."""
    query = db.query(DiscoveredDevice)
    if current_user.role != PlatformRole.SUPER_ADMIN:
        query = query.filter(DiscoveredDevice.company_id == _company_id(current_user, tenant_company_id))
    if device_status:
        query = query.filter(DiscoveredDevice.status == device_status)
    return query.order_by(DiscoveredDevice.last_seen.desc()).all()


@router.get("/unmanaged", response_model=List[DiscoveredDeviceOut])
def list_unmanaged_discovered_devices(
    db: Session = Depends(get_db),
    current_user: User = Depends(_admins),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id)
):
    """Devices waiting to be promoted to assets or ignored."""
    return list_discovered_devices("UNMANAGED", db, current_user, tenant_company_id)


@router.post("/reconcile/{device_id}", status_code=status.HTTP_200_OK)
def promote_discovered_device_to_asset(
    device_id: str,
    body: ReconcileRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles([PlatformRole.SUPER_ADMIN, PlatformRole.IT_ADMIN])),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id)
):
    """Turn a discovered device into a tracked asset (in stock)."""
    device = _device(db, device_id, current_user, tenant_company_id)
    if device.status == "MANAGED":
        raise HTTPException(status_code=400, detail="This device is already an asset.")

    asset_tag = body.asset_tag.strip()
    serial = device.serial_number or f"SN-{device.mac_address.replace(':', '').upper()}"
    if db.query(Asset.id).filter(
        Asset.company_id == device.company_id,
        (Asset.asset_tag == asset_tag) | (Asset.serial_number == serial),
    ).first():
        raise HTTPException(status_code=400, detail="An asset with this tag or serial number already exists.")

    asset = Asset(
        company_id=device.company_id,
        asset_tag=asset_tag,
        serial_number=serial,
        name=(body.name or device.hostname or "Discovered device").strip(),
        category=body.category.strip(),
        type=device.device_type,
        description=" · ".join(
            part for part in (device.os_name, device.cpu_model, f"{device.ram_gb} GB RAM" if device.ram_gb else None, device.ip_address) if part
        ) or None,
        status=AssetStatusEnum.IN_STOCK,
        created_by=current_user.id,
    )
    db.add(asset)
    db.flush()
    db.add(AssetLifecycle(
        company_id=asset.company_id,
        asset_id=asset.id,
        action="CREATED",
        previous_status=None,
        new_status=AssetStatusEnum.IN_STOCK.value,
        performed_by=current_user.id,
        remarks=f"Registered from discovery ({device.hostname or device.mac_address}).",
    ))
    device.status = "MANAGED"
    db.commit()

    log_audit_event(
        db=db,
        action="RECONCILE_DISCOVERY",
        entity="Asset",
        company_id=device.company_id,
        user_id=current_user.id,
        entity_id=asset.id,
        new_value=f"{asset.asset_tag} from {device.hostname or device.mac_address}"
    )
    return {"message": "Discovered device reconciled to asset.", "asset_id": asset.id}


@router.post("/devices/{device_id}/ignore", response_model=DiscoveredDeviceOut)
def ignore_discovered_device(
    device_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(_admins),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id)
):
    """Hide a device that should not become an asset (printers on guest Wi-Fi, phones…)."""
    device = _device(db, device_id, current_user, tenant_company_id)
    if device.status == "MANAGED":
        raise HTTPException(status_code=400, detail="This device is already an asset.")
    device.status = "IGNORED"
    db.commit()
    db.refresh(device)
    return device
