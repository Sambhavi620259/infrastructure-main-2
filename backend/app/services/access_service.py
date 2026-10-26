"""
Access management: grants of access to resources (applications, databases,
VPN, shared folders...). A grant is a record that an admin gave the access;
nothing here connects to an identity provider, so nothing is provisioned
automatically.
"""
from datetime import datetime, timedelta
from typing import Optional

from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.models import AccessGrant, AccessResource, User
from app.services.audit_service import log_audit_event
from app.services.notification_service import home_link, notify

RESOURCE_TYPES = ("APPLICATION", "DATABASE", "VPN", "SHARED_FOLDER", "EMAIL", "OTHER")


def check_access_until(resource: AccessResource, until: Optional[datetime], now: Optional[datetime] = None) -> None:
    """The end date must be in the future and within the resource's longest grant."""
    now = now or datetime.utcnow()
    if until is None:
        if resource.max_days:
            raise HTTPException(status_code=400, detail=f"{resource.name} access needs an end date "
                                                        f"(at most {resource.max_days} days).")
        return
    if until <= now:
        raise HTTPException(status_code=400, detail="The access end date must be in the future.")
    if resource.max_days and until > now + timedelta(days=resource.max_days, hours=1):
        raise HTTPException(status_code=400, detail=f"{resource.name} access can be given for at most {resource.max_days} days.")


def is_privileged(resource: AccessResource, level: str) -> bool:
    return level in (resource.privileged_levels or [])


def needs_owner_approval(resource: Optional[AccessResource], requester_id: str) -> bool:
    """The resource owner approves access requests, unless they asked for it themselves."""
    return bool(resource and resource.owner_id and resource.owner_id != requester_id)


def record_grant(db: Session, resource: AccessResource, user: User, level: str, granted_by: User,
                 expires_at: Optional[datetime], ticket_id: Optional[str] = None) -> AccessGrant:
    """Record access as given. Replaces the user's current grant on the resource (e.g. a new level)."""
    current = db.query(AccessGrant).filter(
        AccessGrant.resource_id == resource.id, AccessGrant.user_id == user.id, AccessGrant.is_active.is_(True),
    ).with_for_update().first()
    if current is not None:
        current.is_active = False
        current.revoked_at = datetime.utcnow()
        current.revoked_by = granted_by.id
        current.revoke_reason = f"Replaced by {level} access"
        db.flush()
    grant = AccessGrant(
        company_id=resource.company_id, resource_id=resource.id, user_id=user.id, access_level=level,
        ticket_id=ticket_id, granted_by=granted_by.id, expires_at=expires_at, is_active=True,
    )
    db.add(grant)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="This access was just changed by someone else. Reload and try again.")
    return grant


def expire_access_grants(db: Session) -> int:
    """Daily: end grants whose end date has passed and tell the user. The caller commits."""
    now = datetime.utcnow()
    expired = db.query(AccessGrant).filter(
        AccessGrant.is_active.is_(True), AccessGrant.expires_at.isnot(None), AccessGrant.expires_at <= now,
    ).all()
    for grant in expired:
        grant.is_active = False
        grant.revoked_at = now
        grant.revoke_reason = "Expired"
        resource = db.get(AccessResource, grant.resource_id)
        user = db.get(User, grant.user_id)
        if user and resource:
            notify(db, user, f"Your {grant.access_level} access to {resource.name} has ended",
                   "It reached its end date. Raise a new access request if you still need it.",
                   home_link(user, "/access", "/agent/assets?tab=access"), "INFO")
        log_audit_event(db=db, action="EXPIRE_ACCESS", entity="AccessGrant", company_id=grant.company_id,
                        entity_id=grant.id, new_value=f"{resource.name if resource else 'Resource'}: {grant.access_level} ended")
    return len(expired)
