"""Implementation file: app/routers/access.py

Access management: the resources people can request access to (applications,
databases, VPN, shared folders, mailboxes...), and the access grants recorded
when an approved ACCESS ticket is fulfilled. Requests and approvals go through
tickets (asset_requests, ticket_type ACCESS). Nothing here provisions access
in another system: a grant records that an admin gave it.
"""
from datetime import datetime
from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user, get_tenant_company_id, require_roles
from app.models.models import AccessGrant, AccessResource, PlatformRole, User
from app.services.access_service import RESOURCE_TYPES
from app.services.audit_service import log_audit_event
from app.services.notification_service import home_link, notify

router = APIRouter(prefix="/access", tags=["Access Management"])

_managers = require_roles([PlatformRole.SUPER_ADMIN, PlatformRole.IT_ADMIN, PlatformRole.SUB_ADMIN])
_readers = require_roles([PlatformRole.SUPER_ADMIN, PlatformRole.IT_ADMIN, PlatformRole.SUB_ADMIN,
                          PlatformRole.REPORTING_USER])

ResourceType = Literal["APPLICATION", "DATABASE", "VPN", "SHARED_FOLDER", "EMAIL", "OTHER"]


def _levels(value):
    levels = [str(v).strip() for v in (value or []) if str(v).strip()]
    if len({lvl.lower() for lvl in levels}) != len(levels):
        raise ValueError("Each access level must be different.")
    if any(len(lvl) > 50 for lvl in levels):
        raise ValueError("An access level is at most 50 characters.")
    return levels


class ResourceInput(BaseModel):
    name: str = Field(..., min_length=2, max_length=150)
    resource_type: ResourceType = "APPLICATION"
    description: Optional[str] = Field(None, max_length=2000)
    owner_id: Optional[str] = None
    access_levels: List[str] = Field(..., min_length=1, max_length=10)
    privileged_levels: List[str] = Field(default_factory=list, max_length=10)
    max_days: Optional[int] = Field(None, ge=1, le=3650)

    @field_validator("access_levels", "privileged_levels")
    @classmethod
    def _clean(cls, value):
        return _levels(value)


class ResourceUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=2, max_length=150)
    resource_type: Optional[ResourceType] = None
    description: Optional[str] = Field(None, max_length=2000)
    owner_id: Optional[str] = None
    access_levels: Optional[List[str]] = Field(None, min_length=1, max_length=10)
    privileged_levels: Optional[List[str]] = Field(None, max_length=10)
    max_days: Optional[int] = Field(None, ge=1, le=3650)
    status: Optional[Literal["ACTIVE", "INACTIVE"]] = None

    @field_validator("access_levels", "privileged_levels")
    @classmethod
    def _clean(cls, value):
        return None if value is None else _levels(value)


class ResourceResponse(BaseModel):
    id: str
    name: str
    resource_type: str
    description: Optional[str] = None
    owner_id: Optional[str] = None
    owner_name: Optional[str] = None
    access_levels: List[str]
    privileged_levels: List[str]
    max_days: Optional[int] = None
    status: str
    active_grants: int = 0
    created_at: Optional[datetime] = None


class GrantResponse(BaseModel):
    id: str
    resource_id: str
    resource_name: Optional[str] = None
    resource_type: Optional[str] = None
    user_id: str
    user_name: Optional[str] = None
    access_level: str
    privileged: bool = False
    ticket_id: Optional[str] = None
    granted_by_name: Optional[str] = None
    granted_at: Optional[datetime] = None
    expires_at: Optional[datetime] = None
    is_active: bool
    revoked_at: Optional[datetime] = None
    revoked_by_name: Optional[str] = None
    revoke_reason: Optional[str] = None


class RevokeBody(BaseModel):
    reason: str = Field(..., min_length=3, max_length=1000)


def _company(user: User, tenant_company_id: Optional[str]) -> str:
    company_id = tenant_company_id or user.company_id
    if not company_id:
        raise HTTPException(status_code=400, detail="Company context required.")
    return company_id


def _resource_responses(db: Session, resources: List[AccessResource]) -> List[ResourceResponse]:
    if not resources:
        return []
    owners = dict(db.query(User.id, User.full_name).filter(
        User.id.in_({r.owner_id for r in resources if r.owner_id})).all())
    counts = dict(db.query(AccessGrant.resource_id, func.count(AccessGrant.id)).filter(
        AccessGrant.resource_id.in_([r.id for r in resources]), AccessGrant.is_active.is_(True),
    ).group_by(AccessGrant.resource_id).all())
    return [
        ResourceResponse(
            id=r.id, name=r.name, resource_type=r.resource_type, description=r.description, owner_id=r.owner_id,
            owner_name=owners.get(r.owner_id), access_levels=list(r.access_levels or []),
            privileged_levels=list(r.privileged_levels or []), max_days=r.max_days, status=r.status,
            active_grants=counts.get(r.id, 0), created_at=r.created_at,
        )
        for r in resources
    ]


def _grant_responses(db: Session, grants: List[AccessGrant]) -> List[GrantResponse]:
    if not grants:
        return []
    resources = {r.id: r for r in db.query(AccessResource).filter(
        AccessResource.id.in_({g.resource_id for g in grants})).all()}
    people = {g.user_id for g in grants} | {g.granted_by for g in grants} | {g.revoked_by for g in grants if g.revoked_by}
    names = dict(db.query(User.id, User.full_name).filter(User.id.in_(people)).all())
    out = []
    for g in grants:
        resource = resources.get(g.resource_id)
        out.append(GrantResponse(
            id=g.id, resource_id=g.resource_id, resource_name=resource.name if resource else None,
            resource_type=resource.resource_type if resource else None, user_id=g.user_id,
            user_name=names.get(g.user_id), access_level=g.access_level,
            privileged=bool(resource and g.access_level in (resource.privileged_levels or [])),
            ticket_id=g.ticket_id, granted_by_name=names.get(g.granted_by), granted_at=g.granted_at,
            expires_at=g.expires_at, is_active=bool(g.is_active), revoked_at=g.revoked_at,
            revoked_by_name=names.get(g.revoked_by), revoke_reason=g.revoke_reason,
        ))
    return out


def _check_resource(db: Session, company_id: str, data: dict, resource_id: Optional[str] = None) -> None:
    levels = data.get("access_levels")
    privileged = data.get("privileged_levels") or []
    if levels is not None and any(p not in levels for p in privileged):
        raise HTTPException(status_code=400, detail="Privileged levels must be among the access levels.")
    if data.get("owner_id") and not db.query(User.id).filter(
        User.id == data["owner_id"], User.company_id == company_id, User.status == "ACTIVE",
    ).first():
        raise HTTPException(status_code=400, detail="The owner must be an active member of your organization.")
    name = (data.get("name") or "").strip()
    if name and db.query(AccessResource.id).filter(
        AccessResource.company_id == company_id, func.lower(AccessResource.name) == name.lower(),
        AccessResource.id != (resource_id or ""),
    ).first():
        raise HTTPException(status_code=400, detail="A resource with that name already exists.")


@router.get("/catalog", response_model=List[ResourceResponse])
def access_catalog(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id),
):
    """Active resources anyone in the organization can request access to."""
    company_id = _company(current_user, tenant_company_id)
    resources = db.query(AccessResource).filter(
        AccessResource.company_id == company_id, AccessResource.status == "ACTIVE"
    ).order_by(AccessResource.name).all()
    responses = _resource_responses(db, resources)
    for r in responses:
        r.active_grants = 0  # users do not see who else has access
    return responses


@router.get("/mine", response_model=List[GrantResponse])
def my_access(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """The caller's own access grants, current first."""
    grants = db.query(AccessGrant).filter(AccessGrant.user_id == current_user.id) \
        .order_by(AccessGrant.is_active.desc(), AccessGrant.granted_at.desc()).limit(200).all()
    return _grant_responses(db, grants)


@router.get("/resources", response_model=List[ResourceResponse])
def list_resources(
    include_inactive: bool = False,
    db: Session = Depends(get_db),
    current_user: User = Depends(_readers),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id),
):
    company_id = _company(current_user, tenant_company_id)
    query = db.query(AccessResource).filter(AccessResource.company_id == company_id)
    if not include_inactive:
        query = query.filter(AccessResource.status == "ACTIVE")
    return _resource_responses(db, query.order_by(AccessResource.name).all())


@router.post("/resources", response_model=ResourceResponse, status_code=status.HTTP_201_CREATED)
def create_resource(
    body: ResourceInput,
    db: Session = Depends(get_db),
    current_user: User = Depends(_managers),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id),
):
    """Add an application, database, VPN, folder or mailbox people can request access to."""
    company_id = _company(current_user, tenant_company_id)
    data = body.model_dump()
    _check_resource(db, company_id, data)
    resource = AccessResource(company_id=company_id, created_by=current_user.id, status="ACTIVE",
                              **{**data, "name": body.name.strip(),
                                 "description": (body.description or "").strip() or None})
    db.add(resource)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="A resource with that name already exists.")
    db.refresh(resource)
    log_audit_event(db=db, action="CREATE_ACCESS_RESOURCE", entity="AccessResource", company_id=company_id,
                    user_id=current_user.id, entity_id=resource.id,
                    new_value=f"{resource.name} ({resource.resource_type}): {', '.join(resource.access_levels)}")
    return _resource_responses(db, [resource])[0]


@router.put("/resources/{resource_id}", response_model=ResourceResponse)
def update_resource(
    resource_id: str,
    body: ResourceUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(_managers),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id),
):
    company_id = _company(current_user, tenant_company_id)
    resource = db.query(AccessResource).filter(
        AccessResource.id == resource_id, AccessResource.company_id == company_id
    ).first()
    if not resource:
        raise HTTPException(status_code=404, detail="Resource not found.")
    data = body.model_dump(exclude_unset=True)
    merged = {
        "name": data.get("name"),
        "owner_id": data.get("owner_id"),
        "access_levels": data.get("access_levels", resource.access_levels),
        "privileged_levels": data.get("privileged_levels", resource.privileged_levels),
    }
    _check_resource(db, company_id, merged, resource.id)
    for field, value in data.items():
        if isinstance(value, str) and field != "status":
            value = value.strip() or None
        setattr(resource, field, value)
    db.commit()
    db.refresh(resource)
    log_audit_event(db=db, action="UPDATE_ACCESS_RESOURCE", entity="AccessResource", company_id=company_id,
                    user_id=current_user.id, entity_id=resource.id,
                    new_value=f"{resource.name}: {', '.join(sorted(data))}")
    return _resource_responses(db, [resource])[0]


@router.get("/grants", response_model=List[GrantResponse])
def list_grants(
    active: Optional[bool] = True,
    resource_id: Optional[str] = None,
    user_id: Optional[str] = None,
    limit: int = Query(200, ge=1, le=1000),
    db: Session = Depends(get_db),
    current_user: User = Depends(_readers),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id),
):
    """Who has access to what (active by default; active=false for ended and revoked grants)."""
    company_id = _company(current_user, tenant_company_id)
    query = db.query(AccessGrant).filter(AccessGrant.company_id == company_id)
    if active is not None:
        query = query.filter(AccessGrant.is_active.is_(active))
    if resource_id:
        query = query.filter(AccessGrant.resource_id == resource_id)
    if user_id:
        query = query.filter(AccessGrant.user_id == user_id)
    return _grant_responses(db, query.order_by(AccessGrant.granted_at.desc()).limit(limit).all())


@router.post("/grants/{grant_id}/revoke", response_model=GrantResponse)
def revoke_grant(
    grant_id: str,
    body: RevokeBody,
    db: Session = Depends(get_db),
    current_user: User = Depends(_managers),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id),
):
    """End someone's access (they no longer need it, or should not have it). Kept for the audit trail."""
    company_id = _company(current_user, tenant_company_id)
    grant = db.query(AccessGrant).filter(
        AccessGrant.id == grant_id, AccessGrant.company_id == company_id
    ).with_for_update().first()
    if not grant:
        raise HTTPException(status_code=404, detail="Access grant not found.")
    if not grant.is_active:
        raise HTTPException(status_code=400, detail="This access has already ended.")
    grant.is_active = False
    grant.revoked_at = datetime.utcnow()
    grant.revoked_by = current_user.id
    grant.revoke_reason = body.reason.strip()
    resource = db.get(AccessResource, grant.resource_id)
    holder = db.get(User, grant.user_id)
    if holder and holder.id != current_user.id:
        notify(db, holder, f"Your {grant.access_level} access to {resource.name if resource else 'a resource'} was removed",
               f"{current_user.full_name}: {grant.revoke_reason}"[:300],
               home_link(holder, "/access", "/agent/access"), "WARNING")
    db.commit()
    log_audit_event(db=db, action="REVOKE_ACCESS", entity="AccessGrant", company_id=company_id,
                    user_id=current_user.id, entity_id=grant.id,
                    new_value=f"{resource.name if resource else grant.resource_id}: {grant.access_level} removed from "
                              f"{holder.full_name if holder else grant.user_id} ({grant.revoke_reason})")
    return _grant_responses(db, [grant])[0]
