from typing import Optional
from sqlalchemy.orm import Session

from app.models.models import AuditLog


def log_audit_event(
    db: Session,
    action: str,
    entity: str,
    company_id: Optional[str] = None,
    user_id: Optional[str] = None,
    entity_id: Optional[str] = None,
    old_value: Optional[str] = None,
    new_value: Optional[str] = None,
    ip_address: Optional[str] = None
) -> AuditLog:
    """
    Utility service function to create and record system audit trail events.
    """
    audit_entry = AuditLog(
        company_id=company_id,
        user_id=user_id,
        action=action,
        entity=entity,
        entity_id=entity_id,
        old_value=old_value,
        new_value=new_value,
        ip_address=ip_address
    )
    db.add(audit_entry)
    db.commit()
    db.refresh(audit_entry)
    return audit_entry