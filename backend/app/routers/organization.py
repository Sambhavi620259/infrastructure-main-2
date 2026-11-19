"""Implementation file: app/routers/organization.py

The signed-in admin's own organization: profile, subscription usage and
headcount, for the IT Admin Settings page.
"""
from datetime import datetime
from typing import Dict, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_tenant_company_id, profile_role, require_roles
from app.models.models import Asset, AssetCategory, Company, Department, PlatformRole, Subscription, User
from app.services.audit_service import log_audit_event

router = APIRouter(prefix="/organization", tags=["Organization"])

_admins = require_roles([PlatformRole.SUPER_ADMIN, PlatformRole.IT_ADMIN])


class OrganizationResponse(BaseModel):
    id: str
    name: str
    code: str
    status: str
    created_at: Optional[datetime] = None
    plan: Optional[str] = None
    user_limit: Optional[int] = None
    asset_limit: Optional[int] = None
    active_users: int
    assets: int
    departments: int
    asset_categories: int
    # Active users per role, using the frontend role names (EMPLOYEE -> IT_AGENT).
    users_by_role: Dict[str, int]


class OrganizationUpdate(BaseModel):
    name: str = Field(..., min_length=2, max_length=150)


def _company(db: Session, current_user: User, tenant_company_id: Optional[str]) -> Company:
    company_id = tenant_company_id or current_user.company_id
    company = db.query(Company).filter(Company.id == company_id).first() if company_id else None
    if not company:
        raise HTTPException(status_code=400, detail="Your account is not in an organization.")
    return company


def _response(db: Session, company: Company) -> OrganizationResponse:
    subscription = db.query(Subscription).filter(Subscription.company_id == company.id).first()
    by_role = (
        db.query(User.role, func.count(User.id))
        .filter(User.company_id == company.id, User.status == "ACTIVE")
        .group_by(User.role)
        .all()
    )
    return OrganizationResponse(
        id=company.id,
        name=company.name,
        code=company.code,
        status=company.status,
        created_at=company.created_at,
        plan=subscription.plan if subscription else None,
        user_limit=subscription.user_limit if subscription else None,
        asset_limit=subscription.asset_limit if subscription else None,
        active_users=sum(count for _, count in by_role),
        assets=db.query(Asset).filter(Asset.company_id == company.id).count(),
        departments=db.query(Department).filter(Department.company_id == company.id).count(),
        asset_categories=db.query(AssetCategory).filter(AssetCategory.company_id == company.id).count(),
        users_by_role={profile_role(role): count for role, count in by_role},
    )


@router.get("", response_model=OrganizationResponse)
def get_organization(
    db: Session = Depends(get_db),
    current_user: User = Depends(_admins),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id),
):
    return _response(db, _company(db, current_user, tenant_company_id))


@router.put("", response_model=OrganizationResponse)
def update_organization(
    update_in: OrganizationUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(_admins),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id),
):
    """Rename the organization. Names are unique across the platform."""
    company = _company(db, current_user, tenant_company_id)
    name = update_in.name.strip()
    taken = db.query(Company.id).filter(func.lower(Company.name) == name.lower(), Company.id != company.id).first()
    if taken:
        raise HTTPException(status_code=400, detail="Another organization already uses that name.")
    old_name = company.name
    company.name = name
    db.commit()
    db.refresh(company)
    log_audit_event(
        db=db,
        action="UPDATE_ORGANIZATION",
        entity="Company",
        company_id=company.id,
        user_id=current_user.id,
        entity_id=company.id,
        old_value=f"Name: {old_name}",
        new_value=f"Name: {company.name}",
    )
    return _response(db, company)
