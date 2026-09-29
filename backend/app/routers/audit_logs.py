from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user, require_roles, get_tenant_company_id
from app.models.models import AuditLog, PlatformRole, User
from app.schemas.schemas import AuditLogResponse

router = APIRouter(prefix="/audit-logs", tags=["Audit Logs"])


@router.get("", response_model=List[AuditLogResponse])
def list_audit_logs(
    skip: int = 0,
    limit: int = 100,
    action: Optional[str] = None,
    entity: Optional[str] = None,
    user_id: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles([PlatformRole.SUPER_ADMIN, PlatformRole.IT_ADMIN, PlatformRole.SUB_ADMIN])),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id)
):
    """
    Retrieve audit trail records filtered by entity, action type, or user ID.
    """
    query = db.query(AuditLog)

    if current_user.role != PlatformRole.SUPER_ADMIN:
        query = query.filter(AuditLog.company_id == tenant_company_id)

    if action:
        query = query.filter(AuditLog.action == action)
    if entity:
        query = query.filter(AuditLog.entity == entity)
    if user_id:
        query = query.filter(AuditLog.user_id == user_id)

    return query.order_by(AuditLog.created_at.desc()).offset(skip).limit(limit).all()


@router.get("/{log_id}", response_model=AuditLogResponse)
def get_audit_log_by_id(
    log_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles([PlatformRole.SUPER_ADMIN, PlatformRole.IT_ADMIN, PlatformRole.SUB_ADMIN])),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id)
):
    """
    Retrieve specific audit log entry details.
    """
    query = db.query(AuditLog).filter(AuditLog.id == log_id)

    if current_user.role != PlatformRole.SUPER_ADMIN:
        query = query.filter(AuditLog.company_id == tenant_company_id)

    audit_entry = query.first()
    if not audit_entry:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Audit log entry not found."
        )

    return audit_entry