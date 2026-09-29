"""Implementation file: app/routers/discovery.py"""
from typing import Dict, Any, List, Optional
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from pydantic import BaseModel

from app.core.database import get_db
from app.core.deps import get_current_user, require_roles, get_tenant_company_id
from app.models.models import DiscoveredDevice, Asset, AssetStatusEnum, PlatformRole, User
from app.services.audit_service import log_audit_event

router = APIRouter(prefix="/discovery", tags=["Automated Network & Agent Discovery"])


class AgentIngestPayload(BaseModel):
    hostname: str
    ip_address: str
    mac_address: str
    os_name: Optional[str] = None
    serial_number: Optional[str] = None
    cpu_model: Optional[str] = None
    ram_gb: Optional[float] = None


@router.post("/agent-ingest", status_code=status.HTTP_201_CREATED)
def agent_discovery_ingest(
    payload: AgentIngestPayload,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles([PlatformRole.SUPER_ADMIN, PlatformRole.IT_ADMIN])),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id)
):
    """
    Ingest hardware telemetries sent by automated network scan agents.
    """
    company_id = tenant_company_id or current_user.company_id
    if not company_id:
        raise HTTPException(status_code=400, detail="Company context required.")

    discovered = db.query(DiscoveredDevice).filter(
        DiscoveredDevice.company_id == company_id,
        DiscoveredDevice.mac_address == payload.mac_address
    ).first()

    if not discovered:
        discovered = DiscoveredDevice(
            company_id=company_id,
            mac_address=payload.mac_address
        )
        db.add(discovered)

    discovered.hostname = payload.hostname
    discovered.ip_address = payload.ip_address
    discovered.os_name = payload.os_name
    discovered.serial_number = payload.serial_number
    discovered.cpu_model = payload.cpu_model
    discovered.ram_gb = payload.ram_gb
    discovered.last_seen = datetime.utcnow()
    discovered.status = "UNMANAGED"

    db.commit()
    return {"message": "Agent discovery data ingested.", "device_id": discovered.id}


@router.get("/unmanaged", response_model=List[Dict[str, Any]])
def list_unmanaged_discovered_devices(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles([PlatformRole.SUPER_ADMIN, PlatformRole.IT_ADMIN, PlatformRole.SUB_ADMIN])),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id)
):
    """
    List auto-discovered network hosts that have not yet been promoted to active assets.
    """
    query = db.query(DiscoveredDevice).filter(DiscoveredDevice.status == "UNMANAGED")
    if current_user.role != PlatformRole.SUPER_ADMIN:
        query = query.filter(DiscoveredDevice.company_id == tenant_company_id)

    devices = query.all()
    return [
        {
            "id": d.id,
            "hostname": d.hostname,
            "ip_address": d.ip_address,
            "mac_address": d.mac_address,
            "os_name": d.os_name,
            "serial_number": d.serial_number,
            "last_seen": d.last_seen
        }
        for d in devices
    ]


@router.post("/reconcile/{device_id}", status_code=status.HTTP_200_OK)
def promote_discovered_device_to_asset(
    device_id: str,
    asset_tag: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles([PlatformRole.SUPER_ADMIN, PlatformRole.IT_ADMIN])),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id)
):
    """
    Convert an unmanaged discovered host into an officially tracked IT hardware asset.
    """
    query = db.query(DiscoveredDevice).filter(DiscoveredDevice.id == device_id)
    if current_user.role != PlatformRole.SUPER_ADMIN:
        query = query.filter(DiscoveredDevice.company_id == tenant_company_id)

    device = query.first()
    if not device:
        raise HTTPException(status_code=404, detail="Discovered device entry not found.")

    asset = Asset(
        company_id=device.company_id,
        asset_tag=asset_tag,
        serial_number=device.serial_number or f"SN-{device.mac_address.replace(':', '')}",
        name=device.hostname or "Discovered Host",
        status=AssetStatusEnum.IN_STOCK,
        created_by=current_user.id
    )
    db.add(asset)
    device.status = "MANAGED"

    db.commit()

    log_audit_event(
        db=db,
        action="RECONCILE_DISCOVERY",
        entity="Asset",
        company_id=device.company_id,
        user_id=current_user.id,
        entity_id=asset.id,
        new_value=f"Promoted hostname: {device.hostname}"
    )

    return {"message": "Discovered device reconciled to asset.", "asset_id": asset.id}