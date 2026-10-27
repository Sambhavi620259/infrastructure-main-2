"""Implementation file: app/routers/super_admin.py

Platform-wide administration for Super Admins: organizations (tenants),
their subscriptions and usage, the audit trail, plan features and
provisioning defaults. There is exactly one Super Admin; no endpoint adds another.
"""
import re
import uuid
from datetime import datetime
from typing import Dict, List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator
from sqlalchemy import and_, func, or_
from sqlalchemy.orm import Session, aliased

from app.core.database import get_db
from app.core.deps import require_roles
from app.core.security import get_password_hash
from app.models.models import (
    Asset, AssetAssignment, AssetRequest, AssetStatusEnum, AuditLog, Company, Software, SoftwareLicense, SoftwareLicenseAssignment, PlatformRole, RequestStatusEnum, Subscription, User,
)
from app.schemas.schemas import SubscriptionResponse
from app.services.audit_service import log_audit_event
from app.services.notification_service import notify_company
from app.services.catalog_service import ensure_default_catalog
from app.services.platform_settings_service import (
    PLANS, ProvisioningDefaults, get_provisioning_defaults, set_provisioning_defaults,
)
from app.services.plan_features_service import FEATURES, get_plan_features, set_plan_features

router = APIRouter(prefix="/super-admin", tags=["Super Admin"])

_super = require_roles([PlatformRole.SUPER_ADMIN])

Plan = Literal["TRIAL", "STARTER", "BUSINESS", "ENTERPRISE"]
CompanyStatus = Literal["ACTIVE", "SUSPENDED"]
SubscriptionStatus = Literal["ACTIVE", "TRIAL", "PAST_DUE", "CANCELLED"]


# --- Schemas -----------------------------------------------------------------

class AdminSummary(BaseModel):
    id: str
    full_name: str
    email: str


class CompanyDetail(BaseModel):
    id: str
    name: str
    code: str
    status: str
    created_at: Optional[datetime] = None
    subscription: Optional[SubscriptionResponse] = None
    active_users: int = 0
    it_agents: int = 0
    assets: int = 0
    pending_tickets: int = 0
    primary_admin: Optional[AdminSummary] = None
    contact_email: Optional[str] = None
    contact_phone: Optional[str] = None
    address: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None


class CompanyCreate(BaseModel):
    name: str = Field(..., min_length=2, max_length=150)
    code: Optional[str] = Field(None, max_length=50)
    plan: Plan = "ENTERPRISE"
    user_limit: int = Field(500, ge=1, le=1_000_000)
    asset_limit: int = Field(2000, ge=1, le=10_000_000)
    # Optional first IT Admin for the new organization.
    admin_name: Optional[str] = Field(None, min_length=2, max_length=150)
    admin_email: Optional[EmailStr] = None
    admin_password: Optional[str] = Field(None, min_length=8, max_length=128)


class CompanyUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=2, max_length=150)
    status: Optional[CompanyStatus] = None
    # Contact details and office pin. Send null to clear a value.
    contact_email: Optional[EmailStr] = None
    contact_phone: Optional[str] = Field(None, max_length=50)
    address: Optional[str] = Field(None, max_length=1000)
    latitude: Optional[float] = Field(None, ge=-90, le=90)
    longitude: Optional[float] = Field(None, ge=-180, le=180)

    @field_validator("contact_email", "contact_phone", "address", mode="before")
    @classmethod
    def _blank_is_none(cls, value):
        return value.strip() or None if isinstance(value, str) else value


CONTACT_FIELDS = ("contact_email", "contact_phone", "address", "latitude", "longitude")


class PlanFeaturesBody(BaseModel):
    plans: Dict[str, List[str]]


class PlanFeaturesResponse(BaseModel):
    features: Dict[str, str]
    plans: Dict[str, List[str]]


class DirectoryAdmin(BaseModel):
    id: str
    full_name: str
    email: str
    phone: Optional[str] = None
    status: str


class DirectoryEntry(BaseModel):
    id: str
    name: str
    code: str
    status: str
    plan: Optional[str] = None
    contact_email: Optional[str] = None
    contact_phone: Optional[str] = None
    address: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    it_admins: List[DirectoryAdmin] = []


class SubscriptionUpdate(BaseModel):
    plan: Optional[Plan] = None
    user_limit: Optional[int] = Field(None, ge=1, le=1_000_000)
    asset_limit: Optional[int] = Field(None, ge=1, le=10_000_000)
    status: Optional[SubscriptionStatus] = None
    end_date: Optional[datetime] = None


class OverviewResponse(BaseModel):
    companies_total: int
    companies_active: int
    companies_suspended: int
    companies_new_this_month: int
    users_total: int
    users_by_role: Dict[str, int]
    unassigned_agents: int
    assets_total: int
    pending_tickets: int
    plans: Dict[str, int]
    recent_companies: List[CompanyDetail]


class PlatformAuditEntry(BaseModel):
    id: str
    action: str
    entity: str
    entity_id: Optional[str] = None
    old_value: Optional[str] = None
    new_value: Optional[str] = None
    timestamp: datetime
    user_name: Optional[str] = None
    user_email: Optional[str] = None
    user_role: Optional[str] = None
    company_name: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)


class PlatformSeatRow(BaseModel):
    id: str
    software_name: str
    license_number: Optional[str] = None
    assigned_to_name: str
    assigned_to_email: str
    assigned_by_name: Optional[str] = None
    assigned_at: Optional[datetime] = None


class PlatformAssetRow(BaseModel):
    id: str
    asset_code: str
    asset_tag: Optional[str] = None
    # Other assets carrying the same asset number, so the clash is visible.
    same_number_count: int = 1
    serial_number: Optional[str] = None
    name: str
    category: str
    status: str
    assigned_to_name: Optional[str] = None
    assigned_to_email: Optional[str] = None
    assigned_by_name: Optional[str] = None
    assigned_at: Optional[datetime] = None


# --- Helpers -----------------------------------------------------------------

def _company_details(db: Session, companies: List[Company]) -> List[CompanyDetail]:
    """Attach headcount, assets, pending tickets and first IT Admin in batched queries."""
    ids = [c.id for c in companies]
    if not ids:
        return []

    def grouped(query) -> Dict[str, int]:
        return dict(query.all())

    users = grouped(
        db.query(User.company_id, func.count(User.id))
        .filter(User.company_id.in_(ids), User.status == "ACTIVE").group_by(User.company_id)
    )
    agents = grouped(
        db.query(User.company_id, func.count(User.id))
        .filter(User.company_id.in_(ids), User.status == "ACTIVE", User.role == PlatformRole.EMPLOYEE)
        .group_by(User.company_id)
    )
    assets = grouped(db.query(Asset.company_id, func.count(Asset.id)).filter(Asset.company_id.in_(ids)).group_by(Asset.company_id))
    pending = grouped(
        db.query(AssetRequest.company_id, func.count(AssetRequest.id))
        .filter(AssetRequest.company_id.in_(ids), AssetRequest.status == RequestStatusEnum.PENDING)
        .group_by(AssetRequest.company_id)
    )
    admins: Dict[str, User] = {}
    for admin in (
        db.query(User)
        .filter(User.company_id.in_(ids), User.role == PlatformRole.IT_ADMIN)
        .order_by(User.created_at)
        .all()
    ):
        admins.setdefault(admin.company_id, admin)

    result = []
    for company in companies:
        admin = admins.get(company.id)
        result.append(CompanyDetail(
            id=company.id,
            name=company.name,
            code=company.code,
            status=company.status,
            created_at=company.created_at,
            subscription=SubscriptionResponse.model_validate(company.subscription) if company.subscription else None,
            active_users=users.get(company.id, 0),
            it_agents=agents.get(company.id, 0),
            assets=assets.get(company.id, 0),
            pending_tickets=pending.get(company.id, 0),
            primary_admin=AdminSummary(id=admin.id, full_name=admin.full_name, email=admin.email) if admin else None,
            contact_email=company.contact_email,
            contact_phone=company.contact_phone,
            address=company.address,
            latitude=company.latitude,
            longitude=company.longitude,
        ))
    return result


def _get_company(db: Session, company_id: str) -> Company:
    company = db.query(Company).filter(Company.id == company_id).first()
    if not company:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Company tenant not found.")
    return company


def _email_taken(db: Session, email: str) -> bool:
    return db.query(User.id).filter(func.lower(User.email) == email.lower()).first() is not None


# --- Overview ----------------------------------------------------------------

@router.get("/overview", response_model=OverviewResponse)
def platform_overview(db: Session = Depends(get_db), admin_user: User = Depends(_super)):
    """Platform-wide counts for the Super Admin home page."""
    month_start = datetime.utcnow().replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    by_role = dict(
        db.query(User.role, func.count(User.id)).filter(User.status == "ACTIVE").group_by(User.role).all()
    )
    plans = dict(db.query(Subscription.plan, func.count(Subscription.id)).group_by(Subscription.plan).all())
    recent = db.query(Company).order_by(Company.created_at.desc()).limit(5).all()
    return OverviewResponse(
        companies_total=db.query(Company).count(),
        companies_active=db.query(Company).filter(Company.status == "ACTIVE").count(),
        companies_suspended=db.query(Company).filter(Company.status != "ACTIVE").count(),
        companies_new_this_month=db.query(Company).filter(Company.created_at >= month_start).count(),
        users_total=sum(by_role.values()),
        users_by_role={("IT_AGENT" if role == PlatformRole.EMPLOYEE else role.value): n for role, n in by_role.items()},
        unassigned_agents=db.query(User).filter(
            User.company_id.is_(None), User.role == PlatformRole.EMPLOYEE, User.status == "ACTIVE"
        ).count(),
        assets_total=db.query(Asset).count(),
        pending_tickets=db.query(AssetRequest).filter(AssetRequest.status == RequestStatusEnum.PENDING).count(),
        plans=plans,
        recent_companies=_company_details(db, recent),
    )


# --- Companies ---------------------------------------------------------------

@router.post("/companies", response_model=CompanyDetail, status_code=status.HTTP_201_CREATED)
def create_company_tenant(
    company_in: CompanyCreate,
    db: Session = Depends(get_db),
    admin_user: User = Depends(_super)
):
    """
    Create an organization with its subscription and starter catalog, and
    optionally its first IT Admin account.
    """
    name = company_in.name.strip()
    code = (company_in.code or "").strip().upper() or (
        re.sub(r"[^A-Z0-9]+", "", name.upper())[:10] + "-" + uuid.uuid4().hex[:4].upper()
    )
    if db.query(Company.id).filter(or_(func.lower(Company.name) == name.lower(), Company.code == code)).first():
        raise HTTPException(status_code=400, detail="A company with this name or code already exists.")

    admin_fields = [company_in.admin_name, company_in.admin_email, company_in.admin_password]
    if any(admin_fields) and not all(admin_fields):
        raise HTTPException(status_code=400, detail="Give the first IT Admin's name, email and password, or none of them.")
    if company_in.admin_email and _email_taken(db, company_in.admin_email):
        raise HTTPException(status_code=400, detail="That email already has an account.")

    company = Company(name=name, code=code, status="ACTIVE")
    db.add(company)
    db.flush()
    db.add(Subscription(
        company_id=company.id,
        plan=company_in.plan,
        user_limit=company_in.user_limit,
        asset_limit=company_in.asset_limit,
        status="ACTIVE",
    ))
    ensure_default_catalog(db, company.id)
    if company_in.admin_email:
        db.add(User(
            company_id=company.id,
            email=company_in.admin_email.lower(),
            hashed_password=get_password_hash(company_in.admin_password),
            full_name=company_in.admin_name.strip(),
            role=PlatformRole.IT_ADMIN,
            status="ACTIVE",
        ))
    db.commit()
    db.refresh(company)

    log_audit_event(
        db=db,
        action="CREATE_COMPANY_TENANT",
        entity="Company",
        company_id=company.id,
        user_id=admin_user.id,
        entity_id=company.id,
        new_value=f"Company: {company.name}, Code: {company.code}"
    )
    return _company_details(db, [company])[0]


@router.get("/companies", response_model=List[CompanyDetail])
def list_companies(
    search: Optional[str] = None,
    company_status: Optional[CompanyStatus] = Query(None, alias="status"),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    db: Session = Depends(get_db),
    admin_user: User = Depends(_super)
):
    """All organizations, newest first, with usage."""
    query = db.query(Company)
    if search:
        like = f"%{search}%"
        query = query.filter(or_(Company.name.ilike(like), Company.code.ilike(like)))
    if company_status:
        query = query.filter(Company.status == company_status)
    companies = query.order_by(Company.created_at.desc()).offset(skip).limit(limit).all()
    return _company_details(db, companies)


@router.get("/companies/{company_id}", response_model=CompanyDetail)
def get_company_details(company_id: str, db: Session = Depends(get_db), admin_user: User = Depends(_super)):
    return _company_details(db, [_get_company(db, company_id)])[0]


@router.put("/companies/{company_id}", response_model=CompanyDetail)
def update_company(
    company_id: str,
    company_in: CompanyUpdate,
    db: Session = Depends(get_db),
    admin_user: User = Depends(_super)
):
    """
    Rename an organization, suspend / reactivate it (suspended organizations'
    users cannot sign in), or set its contact details and office location pin.
    """
    company = _get_company(db, company_id)
    old = f"Name: {company.name}, Status: {company.status}"
    contact_changes = []
    for field in CONTACT_FIELDS:
        if field in company_in.model_fields_set:
            new_value = getattr(company_in, field)
            if new_value != getattr(company, field):
                contact_changes.append(f"{field}: {getattr(company, field) or '—'} -> {new_value or '—'}")
                setattr(company, field, new_value)
    if (company.latitude is None) != (company.longitude is None):
        raise HTTPException(status_code=400, detail="Set both latitude and longitude for the location pin, or neither.")
    if company_in.name is not None:
        name = company_in.name.strip()
        if db.query(Company.id).filter(func.lower(Company.name) == name.lower(), Company.id != company.id).first():
            raise HTTPException(status_code=400, detail="Another organization already uses that name.")
        company.name = name
    reactivated = company_in.status == "ACTIVE" and company.status != "ACTIVE"
    if company_in.status is not None:
        company.status = company_in.status
    if reactivated:
        notify_company(
            db, company.id, [PlatformRole.IT_ADMIN], title=f"{company.name} has been reactivated",
            message="Everyone in your organization can sign in again.", admin_link="/dashboard", type="SUCCESS",
        )
    db.commit()
    db.refresh(company)

    log_audit_event(
        db=db,
        action="UPDATE_COMPANY",
        entity="Company",
        company_id=company.id,
        user_id=admin_user.id,
        entity_id=company.id,
        old_value=old,
        new_value=f"Name: {company.name}, Status: {company.status}"
        + (f"; Contact: {'; '.join(contact_changes)}" if contact_changes else "")
    )
    return _company_details(db, [company])[0]


@router.get("/contact-directory", response_model=List[DirectoryEntry])
def contact_directory(db: Session = Depends(get_db), admin_user: User = Depends(_super)):
    """Every organization's contact details, office pin and IT Admins, for the contact directory report."""
    companies = db.query(Company).order_by(Company.name).all()
    admins: Dict[str, List[DirectoryAdmin]] = {}
    for admin in (
        db.query(User).filter(User.role == PlatformRole.IT_ADMIN, User.company_id.isnot(None))
        .order_by(User.full_name).all()
    ):
        admins.setdefault(admin.company_id, []).append(DirectoryAdmin(
            id=admin.id, full_name=admin.full_name, email=admin.email, phone=admin.phone, status=admin.status,
        ))
    return [
        DirectoryEntry(
            id=c.id, name=c.name, code=c.code, status=c.status,
            plan=c.subscription.plan if c.subscription else None,
            contact_email=c.contact_email, contact_phone=c.contact_phone, address=c.address,
            latitude=c.latitude, longitude=c.longitude, it_admins=admins.get(c.id, []),
        )
        for c in companies
    ]


# --- Subscriptions -----------------------------------------------------------

@router.get("/subscriptions", response_model=List[SubscriptionResponse])
def list_subscriptions(
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    admin_user: User = Depends(_super)
):
    """List subscription limits across all tenants."""
    return db.query(Subscription).offset(skip).limit(limit).all()


@router.put("/subscriptions/{company_id}", response_model=CompanyDetail)
def update_subscription(
    company_id: str,
    update_in: SubscriptionUpdate,
    db: Session = Depends(get_db),
    admin_user: User = Depends(_super)
):
    """Change an organization's plan, limits, status or end date (created if missing)."""
    company = _get_company(db, company_id)
    subscription = company.subscription
    if subscription is None:
        subscription = Subscription(company_id=company.id)
        db.add(subscription)
    old = f"{subscription.plan} users={subscription.user_limit} assets={subscription.asset_limit} {subscription.status}"
    for field, value in update_in.model_dump(exclude_unset=True).items():
        setattr(subscription, field, value)
    notify_company(
        db, company.id, [PlatformRole.IT_ADMIN], title="Your plan was updated",
        message=f"{subscription.plan.title()} plan: up to {subscription.user_limit} users and {subscription.asset_limit} assets.",
        admin_link="/settings",
    )
    db.commit()
    db.refresh(company)

    log_audit_event(
        db=db,
        action="UPDATE_SUBSCRIPTION",
        entity="Subscription",
        company_id=company.id,
        user_id=admin_user.id,
        entity_id=subscription.id,
        old_value=old,
        new_value=f"{subscription.plan} users={subscription.user_limit} assets={subscription.asset_limit} {subscription.status}"
    )
    return _company_details(db, [company])[0]


# --- Platform administrators -------------------------------------------------

# --- Audit trail -------------------------------------------------------------

@router.get("/audit-logs", response_model=List[PlatformAuditEntry])
def platform_audit_logs(
    search: Optional[str] = None,
    action: Optional[str] = None,
    company_id: Optional[str] = None,
    sign_ins: bool = False,
    role: Optional[str] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=500),
    db: Session = Depends(get_db),
    admin_user: User = Depends(_super)
):
    """Every recorded action on the platform, newest first, with user and organization names."""
    query = (
        db.query(AuditLog, User.full_name, User.email, User.role, Company.name)
        .outerjoin(User, User.id == AuditLog.user_id)
        .outerjoin(Company, Company.id == AuditLog.company_id)
    )
    if sign_ins:
        # Sign-ins and registrations, including failed Super Admin key attempts.
        query = query.filter(AuditLog.action.in_(("USER_LOGIN", "USER_REGISTER", "SUPER_ADMIN_KEY_FAILED")))
    if role:
        try:
            query = query.filter(User.role == PlatformRole(role))
        except ValueError:
            raise HTTPException(status_code=400, detail="Unknown role.")
    if action:
        query = query.filter(AuditLog.action == action)
    if company_id:
        query = query.filter(AuditLog.company_id == company_id)
    if search:
        like = f"%{search}%"
        query = query.filter(or_(
            User.full_name.ilike(like), User.email.ilike(like), Company.name.ilike(like),
            AuditLog.new_value.ilike(like), AuditLog.action.ilike(like),
        ))
    rows = query.order_by(AuditLog.timestamp.desc()).offset(skip).limit(limit).all()
    result = []
    for entry, user_name, user_email, user_role, company_name in rows:
        item = PlatformAuditEntry.model_validate(entry)
        item.user_name, item.user_email, item.company_name = user_name, user_email, company_name
        item.user_role = user_role.value if user_role else None
        result.append(item)
    return result


@router.get("/assets", response_model=List[PlatformAssetRow])
def platform_assets(
    search: Optional[str] = None,
    status_filter: Optional[str] = Query(None, alias="status"),
    assignment: Optional[str] = Query(None, pattern="^(assigned|unassigned)$"),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=500),
    db: Session = Depends(get_db),
    admin_user: User = Depends(_super)
):
    """Every asset in the system, with who holds it and which IT Admin assigned it."""
    holder, giver = aliased(User), aliased(User)
    query = (
        db.query(Asset, AssetAssignment, holder, giver)
        .outerjoin(AssetAssignment, and_(AssetAssignment.asset_id == Asset.id, AssetAssignment.is_active.is_(True)))
        .outerjoin(holder, holder.id == AssetAssignment.user_id)
        .outerjoin(giver, giver.id == AssetAssignment.assigned_by)
    )
    if status_filter:
        try:
            query = query.filter(Asset.status == AssetStatusEnum(status_filter))
        except ValueError:
            raise HTTPException(status_code=400, detail="Unknown status.")
    if assignment == "assigned":
        query = query.filter(AssetAssignment.id.isnot(None))
    elif assignment == "unassigned":
        query = query.filter(AssetAssignment.id.is_(None))
    if search:
        like = f"%{search}%"
        query = query.filter(or_(
            Asset.asset_code.ilike(like), Asset.asset_tag.ilike(like), Asset.serial_number.ilike(like),
            Asset.name.ilike(like), holder.full_name.ilike(like), holder.email.ilike(like), giver.full_name.ilike(like),
        ))
    rows = query.order_by(Asset.asset_code).offset(skip).limit(limit).all()
    tags = [asset.asset_tag for asset, *_ in rows if asset.asset_tag]
    shared = dict(
        db.query(Asset.asset_tag, func.count(Asset.id)).filter(Asset.asset_tag.in_(tags)).group_by(Asset.asset_tag).all()
    ) if tags else {}
    return [
        PlatformAssetRow(
            id=asset.id, asset_code=asset.asset_code, asset_tag=asset.asset_tag,
            same_number_count=shared.get(asset.asset_tag, 1),
            serial_number=asset.serial_number, name=asset.name, category=asset.category, status=asset.status.value,
            assigned_to_name=user.full_name if user else None, assigned_to_email=user.email if user else None,
            assigned_by_name=by.full_name if by else None,
            assigned_at=assignment.assigned_at if assignment else None,
        )
        for asset, assignment, user, by in rows
    ]


@router.get("/software-seats", response_model=List[PlatformSeatRow])
def platform_software_seats(
    search: Optional[str] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=500),
    db: Session = Depends(get_db),
    admin_user: User = Depends(_super)
):
    """Software seats currently held, with the user and the IT Admin who gave each one."""
    holder, giver = aliased(User), aliased(User)
    query = (
        db.query(SoftwareLicenseAssignment, Software.name, SoftwareLicense.license_number, holder, giver)
        .join(Software, Software.id == SoftwareLicenseAssignment.software_id)
        .outerjoin(SoftwareLicense, SoftwareLicense.id == SoftwareLicenseAssignment.license_id)
        .join(holder, holder.id == SoftwareLicenseAssignment.user_id)
        .outerjoin(giver, giver.id == SoftwareLicenseAssignment.assigned_by)
        .filter(SoftwareLicenseAssignment.is_active.is_(True))
    )
    if search:
        like = f"%{search}%"
        query = query.filter(or_(
            Software.name.ilike(like), SoftwareLicense.license_number.ilike(like),
            holder.full_name.ilike(like), holder.email.ilike(like), giver.full_name.ilike(like),
        ))
    rows = query.order_by(SoftwareLicenseAssignment.assigned_at.desc()).offset(skip).limit(limit).all()
    return [
        PlatformSeatRow(
            id=seat.id, software_name=name, license_number=number,
            assigned_to_name=user.full_name, assigned_to_email=user.email,
            assigned_by_name=by.full_name if by else None, assigned_at=seat.assigned_at,
        )
        for seat, name, number, user, by in rows
    ]


@router.get("/audit-actions", response_model=List[str])
def audit_actions(db: Session = Depends(get_db), admin_user: User = Depends(_super)):
    """Distinct action names, for the audit log filter."""
    return [row[0] for row in db.query(AuditLog.action).distinct().order_by(AuditLog.action).all()]


# --- Platform settings -------------------------------------------------------

@router.get("/settings", response_model=ProvisioningDefaults)
def get_platform_settings(db: Session = Depends(get_db), admin_user: User = Depends(_super)):
    return get_provisioning_defaults(db)


@router.put("/settings", response_model=ProvisioningDefaults)
def update_platform_settings(
    defaults: ProvisioningDefaults,
    db: Session = Depends(get_db),
    admin_user: User = Depends(_super)
):
    """Plan and limits given to organizations created by IT Admin sign-up."""
    set_provisioning_defaults(db, defaults, admin_user.id)
    db.commit()
    log_audit_event(
        db=db, action="UPDATE_PLATFORM_SETTINGS", entity="PlatformSetting", user_id=admin_user.id,
        new_value=f"Defaults: {defaults.plan}, users={defaults.user_limit}, assets={defaults.asset_limit}",
    )
    return defaults


# --- Plan features -----------------------------------------------------------

@router.get("/plan-features", response_model=PlanFeaturesResponse)
def get_features_per_plan(db: Session = Depends(get_db), admin_user: User = Depends(_super)):
    return PlanFeaturesResponse(features=FEATURES, plans=get_plan_features(db))


@router.put("/plan-features", response_model=PlanFeaturesResponse)
def update_features_per_plan(
    body: PlanFeaturesBody,
    db: Session = Depends(get_db),
    admin_user: User = Depends(_super)
):
    """Choose which modules each plan includes. Organizations on a plan reach only those modules."""
    unknown_plans = sorted(set(body.plans) - set(PLANS))
    unknown_features = sorted({f for features in body.plans.values() for f in features} - set(FEATURES))
    if unknown_plans or unknown_features:
        raise HTTPException(status_code=400, detail=f"Unknown plan or feature: {', '.join(unknown_plans + unknown_features)}.")
    plans = set_plan_features(db, {**get_plan_features(db), **body.plans}, admin_user.id)
    db.commit()
    log_audit_event(
        db=db, action="UPDATE_PLAN_FEATURES", entity="PlatformSetting", user_id=admin_user.id,
        new_value="; ".join(f"{plan}: {', '.join(features) or 'core only'}" for plan, features in plans.items()),
    )
    return PlanFeaturesResponse(features=FEATURES, plans=plans)
