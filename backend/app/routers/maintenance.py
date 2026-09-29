from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user, require_roles, get_tenant_company_id
from app.models.models import MaintenanceLog, Asset, AssetStatusEnum, PlatformRole, User
from app.schemas.schemas import (
    MaintenanceCreate, MaintenanceResponse, MaintenanceUpdate
)
from app.services.audit_service import log_audit_event

router = APIRouter(prefix="/maintenance", tags=["Maintenance Management"])


@router.post("", response_model=MaintenanceResponse, status_code=status.HTTP_201_CREATED)
def create_maintenance_log(
    maintenance_in: MaintenanceCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles([PlatformRole.SUPER_ADMIN, PlatformRole.IT_ADMIN, PlatformRole.SUB_ADMIN])),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id)
):
    """
    Schedule or log a new maintenance event for an asset.
    """
    company_id = tenant_company_id or current_user.company_id
    if not company_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Valid company context is required."
        )

    asset = db.query(Asset).filter(
        Asset.id == maintenance_in.asset_id,
        Asset.company_id == company_id
    ).first()

    if not asset:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Target asset for maintenance not found."
        )

    m_log = MaintenanceLog(
        company_id=company_id,
        asset_id=asset.id,
        maintenance_type=maintenance_in.maintenance_type,
        scheduled_date=maintenance_in.scheduled_date,
        completion_date=maintenance_in.completion_date,
        cost=maintenance_in.cost,
        performed_by=maintenance_in.performed_by,
        details=maintenance_in.details,
        status=maintenance_in.status or "SCHEDULED"
    )

    # Optionally transition asset status to MAINTENANCE
    if m_log.status in ["SCHEDULED", "IN_PROGRESS"]:
        asset.status = AssetStatusEnum.UNDER_MAINTENANCE

    db.add(m_log)
    db.commit()
    db.refresh(m_log)

    log_audit_event(
        db=db,
        action="CREATE_MAINTENANCE_LOG",
        entity="MaintenanceLog",
        company_id=company_id,
        user_id=current_user.id,
        entity_id=m_log.id,
        new_value=f"Asset ID: {asset.id}, Type: {m_log.maintenance_type}"
    )

    return m_log


@router.get("", response_model=List[MaintenanceResponse])
def list_maintenance_logs(
    skip: int = 0,
    limit: int = 100,
    asset_id: Optional[str] = None,
    maintenance_type: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id)
):
    """
    List all maintenance records with optional filters.
    """
    query = db.query(MaintenanceLog)
    if current_user.role != PlatformRole.SUPER_ADMIN:
        query = query.filter(MaintenanceLog.company_id == tenant_company_id)

    if asset_id:
        query = query.filter(MaintenanceLog.asset_id == asset_id)

    if maintenance_type:
        query = query.filter(MaintenanceLog.maintenance_type == maintenance_type)

    return query.order_by(MaintenanceLog.scheduled_date.desc()).offset(skip).limit(limit).all()


@router.get("/{maintenance_id}", response_model=MaintenanceResponse)
def get_maintenance_log(
    maintenance_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id)
):
    """
    Retrieve specific maintenance log details.
    """
    query = db.query(MaintenanceLog).filter(MaintenanceLog.id == maintenance_id)
    if current_user.role != PlatformRole.SUPER_ADMIN:
        query = query.filter(MaintenanceLog.company_id == tenant_company_id)

    m_log = query.first()
    if not m_log:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Maintenance record not found."
        )
    return m_log


@router.put("/{maintenance_id}", response_model=MaintenanceResponse)
def update_maintenance_log(
    maintenance_id: str,
    maintenance_in: MaintenanceUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles([PlatformRole.SUPER_ADMIN, PlatformRole.IT_ADMIN, PlatformRole.SUB_ADMIN])),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id)
):
    """
    Update maintenance status, completion details, or associated costs.
    """
    query = db.query(MaintenanceLog).filter(MaintenanceLog.id == maintenance_id)
    if current_user.role != PlatformRole.SUPER_ADMIN:
        query = query.filter(MaintenanceLog.company_id == tenant_company_id)

    m_log = query.first()
    if not m_log:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Maintenance record not found."
        )

    old_status = m_log.status
    update_data = maintenance_in.dict(exclude_unset=True)

    for field, value in update_data.items():
        setattr(m_log, field, value)

    # Return asset to IN_STOCK if maintenance is completed
    if m_log.status == "COMPLETED" and old_status != "COMPLETED":
        asset = db.query(Asset).filter(Asset.id == m_log.asset_id).first()
        if asset and asset.status == AssetStatusEnum.UNDER_MAINTENANCE:
            asset.status = AssetStatusEnum.IN_STOCK

    db.commit()
    db.refresh(m_log)

    log_audit_event(
        db=db,
        action="UPDATE_MAINTENANCE_LOG",
        entity="MaintenanceLog",
        company_id=m_log.company_id,
        user_id=current_user.id,
        entity_id=m_log.id,
        old_value=f"Status: {old_status}",
        new_value=f"Status: {m_log.status}"
    )

    return m_log


@router.delete("/{maintenance_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_maintenance_log(
    maintenance_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles([PlatformRole.SUPER_ADMIN, PlatformRole.IT_ADMIN])),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id)
):
    """
    Delete a maintenance log record.
    """
    query = db.query(MaintenanceLog).filter(MaintenanceLog.id == maintenance_id)
    if current_user.role != PlatformRole.SUPER_ADMIN:
        query = query.filter(MaintenanceLog.company_id == tenant_company_id)

    m_log = query.first()
    if not m_log:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Maintenance record not found."
        )

    db.delete(m_log)
    db.commit()

    log_audit_event(
        db=db,
        action="DELETE_MAINTENANCE_LOG",
        entity="MaintenanceLog",
        company_id=m_log.company_id,
        user_id=current_user.id,
        entity_id=maintenance_id
    )

    return None