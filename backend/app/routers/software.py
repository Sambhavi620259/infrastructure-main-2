"""Implementation file: app/routers/software.py

Software products, their license entitlements and seat assignments.

- Product (Software): name, publisher, version.
- License (SoftwareLicense): seats bought on given terms (type, number,
  purchase / expiry / renewal dates, cost). A product can have several.
- Seat (SoftwareLicenseAssignment): one seat given to a user, optionally on a
  device. Releasing a seat keeps it as history.

Admins (IT Admin, Super Admin, SAM sub-admins) manage everything here. Users
see the product catalogue (to request access) and their own seats, with the
license number masked.
"""
import re
from datetime import datetime, timedelta
from decimal import Decimal
from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user, get_tenant_company_id, require_roles
from app.models.models import (
    Asset, AssetRequest, PlatformRole, PurchaseOrder, Software, SoftwareLicense, SoftwareLicenseAssignment, User,
    Vendor,
)
from app.services.audit_service import log_audit_event
from app.services.notification_service import home_link, notify
from app.services.software_service import active_seats, assign_seat, mask_license_number, release_seat, sync_totals

router = APIRouter(prefix="/software", tags=["Software & License Management"])

_ADMIN_ROLES = [PlatformRole.SUPER_ADMIN, PlatformRole.IT_ADMIN, PlatformRole.SUB_ADMIN]
_managers = require_roles(_ADMIN_ROLES)
# Organization-wide views: admins and reporting users (users see only their own seats).
_viewers = require_roles(_ADMIN_ROLES + [PlatformRole.REPORTING_USER])

LicenseType = Literal["PERPETUAL", "SUBSCRIPTION", "PER_USER", "PER_DEVICE", "SITE", "VOLUME", "OEM", "TRIAL"]
# Formats a license number may take: letters, digits and - _ . / # separators.
LICENSE_NUMBER_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9\-_./# ]{2,254}$")


def _clean_license_number(value: Optional[str]) -> Optional[str]:
    value = (value or "").strip()
    if not value:
        return None
    if not LICENSE_NUMBER_PATTERN.match(value):
        raise ValueError("A license number is 3-255 letters, digits and - _ . / # characters.")
    return value


class LicenseInput(BaseModel):
    license_type: LicenseType = "PERPETUAL"
    license_number: Optional[str] = Field(None, max_length=255)
    # License Count: seats or entitlements bought.
    seats: int = Field(..., ge=1, le=1_000_000)
    purchase_date: Optional[datetime] = None
    expiry_date: Optional[datetime] = None
    renewal_date: Optional[datetime] = None
    cost: Decimal = Field(Decimal("0"), ge=0)
    vendor_id: Optional[str] = None
    purchase_order_id: Optional[str] = None
    notes: Optional[str] = Field(None, max_length=1000)

    @field_validator("license_number")
    @classmethod
    def clean_number(cls, value: Optional[str]) -> Optional[str]:
        return _clean_license_number(value)


class LicenseUpdate(BaseModel):
    license_type: Optional[LicenseType] = None
    license_number: Optional[str] = Field(None, max_length=255)
    seats: Optional[int] = Field(None, ge=1, le=1_000_000)
    purchase_date: Optional[datetime] = None
    expiry_date: Optional[datetime] = None
    renewal_date: Optional[datetime] = None
    cost: Optional[Decimal] = Field(None, ge=0)
    status: Optional[Literal["ACTIVE", "CANCELLED"]] = None
    notes: Optional[str] = Field(None, max_length=1000)

    @field_validator("license_number")
    @classmethod
    def clean_number(cls, value: Optional[str]) -> Optional[str]:
        return _clean_license_number(value)


class SoftwareCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=150)
    vendor: Optional[str] = Field(None, max_length=150)  # publisher
    version: Optional[str] = Field(None, max_length=50)
    # The first license, e.g. from the asset form's License Number / License Count.
    license: Optional[LicenseInput] = None
    # Whether requests for it must be approved before a seat is given.
    approval_required: bool = True
    # Older clients sent the seat count and terms on the product itself.
    license_type: Optional[LicenseType] = None
    total_licenses: Optional[int] = Field(None, ge=1)
    cost: Optional[Decimal] = Field(None, ge=0)
    expiry_date: Optional[datetime] = None


class SoftwareUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=150)
    vendor: Optional[str] = Field(None, max_length=150)
    version: Optional[str] = Field(None, max_length=50)
    approval_required: Optional[bool] = None


class DeploymentUpdate(BaseModel):
    # Recorded by an admin: no deployment system is connected, so this is never set automatically.
    status: Literal["NOT_REQUIRED", "PENDING", "INSTALLED", "FAILED"]
    note: Optional[str] = Field(None, max_length=1000)


class LicenseResponse(BaseModel):
    id: str
    software_id: str
    software_name: Optional[str] = None
    license_type: str
    # Full number for admins; masked for everyone else.
    license_number: Optional[str] = None
    seats: int
    assigned: int = 0
    available: int = 0
    purchase_date: Optional[datetime] = None
    expiry_date: Optional[datetime] = None
    renewal_date: Optional[datetime] = None
    cost: Decimal
    vendor_id: Optional[str] = None
    purchase_order_id: Optional[str] = None
    status: str
    notes: Optional[str] = None
    created_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


class SeatResponse(BaseModel):
    id: str
    software_id: str
    software_name: Optional[str] = None
    license_id: Optional[str] = None
    license_type: Optional[str] = None
    license_number: Optional[str] = None  # always masked here
    expiry_date: Optional[datetime] = None
    user_id: str
    user_name: Optional[str] = None
    asset_id: Optional[str] = None
    asset_label: Optional[str] = None
    assigned_at: Optional[datetime] = None
    assigned_by_name: Optional[str] = None
    is_active: bool
    released_at: Optional[datetime] = None
    released_by_name: Optional[str] = None
    # Installation as recorded by an admin (None = not tracked).
    deployment_status: Optional[str] = None
    deployment_note: Optional[str] = None
    deployment_updated_at: Optional[datetime] = None


class SoftwareResponse(BaseModel):
    id: str
    company_id: str
    name: str
    vendor: Optional[str] = None
    version: Optional[str] = None
    license_type: str
    # Totals across the product's active licenses (kept for older clients).
    total_licenses: int
    used_licenses: int
    available_licenses: int = 0
    license_count: int = 0
    cost: Decimal
    expiry_date: Optional[datetime] = None
    status: str
    approval_required: bool = True

    model_config = ConfigDict(from_attributes=True)


class SoftwareDetail(SoftwareResponse):
    licenses: List[LicenseResponse] = []
    seats: List[SeatResponse] = []


class SeatAssign(BaseModel):
    user_id: str
    license_id: Optional[str] = None
    asset_id: Optional[str] = None


class CatalogEntry(BaseModel):
    id: str
    name: str
    vendor: Optional[str] = None
    version: Optional[str] = None
    approval_required: bool = True


def _company(user: User, tenant_company_id: Optional[str]) -> str:
    company_id = tenant_company_id or user.company_id
    if not company_id:
        raise HTTPException(status_code=400, detail="Company context required.")
    return company_id


def _is_admin(user: User) -> bool:
    return user.role in _ADMIN_ROLES


def _product(db: Session, software_id: str, company_id: str) -> Software:
    software = db.query(Software).filter(Software.id == software_id, Software.company_id == company_id).first()
    if not software:
        raise HTTPException(status_code=404, detail="Software not found.")
    return software


def _license(db: Session, license_id: str, company_id: str, lock: bool = False) -> SoftwareLicense:
    query = db.query(SoftwareLicense).filter(SoftwareLicense.id == license_id, SoftwareLicense.company_id == company_id)
    if lock:
        query = query.with_for_update()
    item = query.first()
    if not item:
        raise HTTPException(status_code=404, detail="License not found.")
    return item


def _check_license_refs(db: Session, company_id: str, data: dict, license_id: Optional[str] = None) -> None:
    if data.get("vendor_id") and not db.query(Vendor.id).filter(
        Vendor.id == data["vendor_id"], Vendor.company_id == company_id
    ).first():
        raise HTTPException(status_code=400, detail="Unknown vendor.")
    if data.get("purchase_order_id") and not db.query(PurchaseOrder.id).filter(
        PurchaseOrder.id == data["purchase_order_id"], PurchaseOrder.company_id == company_id
    ).first():
        raise HTTPException(status_code=400, detail="Unknown purchase order.")
    number = data.get("license_number")
    if number:
        duplicate = db.query(SoftwareLicense.id).filter(
            SoftwareLicense.company_id == company_id, SoftwareLicense.license_number == number
        )
        if license_id:
            duplicate = duplicate.filter(SoftwareLicense.id != license_id)
        if duplicate.first():
            raise HTTPException(status_code=400, detail="A license with this license number already exists.")
    start, end = data.get("purchase_date"), data.get("expiry_date")
    if start and end and end < start:
        raise HTTPException(status_code=400, detail="Expiry must be after the purchase date.")


def _license_responses(db: Session, licenses: List[SoftwareLicense], viewer: User) -> List[LicenseResponse]:
    used = active_seats(db, [l.id for l in licenses])
    names = dict(db.query(Software.id, Software.name).filter(Software.id.in_({l.software_id for l in licenses})).all()) \
        if licenses else {}
    out = []
    for item in licenses:
        response = LicenseResponse.model_validate(item)
        response.software_name = names.get(item.software_id)
        response.assigned = used.get(item.id, 0)
        response.available = max(item.seats - response.assigned, 0) if item.status == "ACTIVE" else 0
        if not _is_admin(viewer):
            response.license_number = mask_license_number(item.license_number)
        out.append(response)
    return out


def _seat_responses(db: Session, seats: List[SoftwareLicenseAssignment]) -> List[SeatResponse]:
    if not seats:
        return []
    user_ids = {s.user_id for s in seats} | {s.assigned_by for s in seats if s.assigned_by} \
        | {s.released_by for s in seats if s.released_by}
    names = dict(db.query(User.id, User.full_name).filter(User.id.in_(user_ids)).all())
    products = dict(db.query(Software.id, Software.name).filter(Software.id.in_({s.software_id for s in seats})).all())
    licenses = {l.id: l for l in db.query(SoftwareLicense).filter(
        SoftwareLicense.id.in_({s.license_id for s in seats if s.license_id})
    ).all()}
    devices = {a.id: a.label for a in db.query(Asset).filter(Asset.id.in_({s.asset_id for s in seats if s.asset_id})).all()}
    out = []
    for seat in seats:
        lic = licenses.get(seat.license_id)
        out.append(SeatResponse(
            id=seat.id, software_id=seat.software_id, software_name=products.get(seat.software_id),
            license_id=seat.license_id, license_type=lic.license_type if lic else None,
            license_number=mask_license_number(lic.license_number) if lic else None,
            expiry_date=lic.expiry_date if lic else None,
            user_id=seat.user_id, user_name=names.get(seat.user_id), asset_id=seat.asset_id,
            asset_label=devices.get(seat.asset_id), assigned_at=seat.assigned_at,
            assigned_by_name=names.get(seat.assigned_by), is_active=bool(seat.is_active),
            released_at=seat.released_at, released_by_name=names.get(seat.released_by),
            deployment_status=seat.deployment_status, deployment_note=seat.deployment_note,
            deployment_updated_at=seat.deployment_updated_at,
        ))
    return out


def _product_response(software: Software, cls=SoftwareResponse, **extra):
    data = SoftwareResponse.model_validate(software).model_dump()
    data["available_licenses"] = max((software.total_licenses or 0) - (software.used_licenses or 0), 0)
    data.update(extra)
    return cls(**data)


# --- Users: catalogue and own seats -------------------------------------------

@router.get("/catalog", response_model=List[CatalogEntry])
def software_catalog(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id),
):
    """Products anyone in the organization can request access to (names only)."""
    company_id = _company(current_user, tenant_company_id)
    return db.query(Software).filter(Software.company_id == company_id, Software.status == "ACTIVE") \
        .order_by(Software.name).all()


@router.get("/mine", response_model=List[SeatResponse])
def my_software(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """The caller's active seats, with the license number masked."""
    seats = db.query(SoftwareLicenseAssignment).filter(
        SoftwareLicenseAssignment.user_id == current_user.id, SoftwareLicenseAssignment.is_active.is_(True)
    ).order_by(SoftwareLicenseAssignment.assigned_at.desc()).all()
    return _seat_responses(db, seats)


# --- Licenses and seats across products ------------------------------------------

@router.get("/licenses", response_model=List[LicenseResponse])
def list_licenses(
    search: Optional[str] = None,
    expiring_days: Optional[int] = Query(None, ge=1, le=365),
    db: Session = Depends(get_db),
    current_user: User = Depends(_viewers),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id),
):
    """Every license entitlement with assigned and available seats. expiring_days limits to those ending soon."""
    company_id = _company(current_user, tenant_company_id)
    query = db.query(SoftwareLicense).join(Software, Software.id == SoftwareLicense.software_id) \
        .filter(SoftwareLicense.company_id == company_id)
    if search:
        like = f"%{search}%"
        query = query.filter(Software.name.ilike(like) | SoftwareLicense.license_number.ilike(like))
    if expiring_days:
        now = datetime.utcnow()
        query = query.filter(SoftwareLicense.expiry_date.isnot(None),
                             SoftwareLicense.expiry_date <= now + timedelta(days=expiring_days))
    return _license_responses(db, query.order_by(Software.name, SoftwareLicense.created_at).all(), current_user)


@router.put("/licenses/{license_id}", response_model=LicenseResponse)
def update_license(
    license_id: str,
    update_in: LicenseUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(_managers),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id),
):
    """Change seats or terms (e.g. a renewal). Seats cannot drop below those in use."""
    company_id = _company(current_user, tenant_company_id)
    item = _license(db, license_id, company_id, lock=True)
    data = update_in.model_dump(exclude_unset=True)
    _check_license_refs(db, company_id, {**{"purchase_date": item.purchase_date, "expiry_date": item.expiry_date}, **data},
                        license_id=item.id)
    used = active_seats(db, [item.id]).get(item.id, 0)
    if data.get("seats") is not None and data["seats"] < used:
        raise HTTPException(status_code=400, detail=f"{used} seats are in use; release some before lowering the count.")
    if data.get("status") == "CANCELLED" and used:
        raise HTTPException(status_code=400, detail="Release the seats in use before cancelling this license.")
    old = f"{item.seats} seats, expiry {item.expiry_date:%Y-%m-%d}" if item.expiry_date else f"{item.seats} seats"
    for field, value in data.items():
        setattr(item, field, value)
    software = _product(db, item.software_id, company_id)
    sync_totals(db, software)
    db.commit()
    db.refresh(item)
    log_audit_event(db=db, action="UPDATE_SOFTWARE_LICENSE", entity="SoftwareLicense", company_id=company_id,
                    user_id=current_user.id, entity_id=item.id, old_value=old,
                    new_value=f"{software.name}: {item.seats} seats" + (f", expiry {item.expiry_date:%Y-%m-%d}" if item.expiry_date else ""))
    return _license_responses(db, [item], current_user)[0]


@router.delete("/licenses/{license_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_license(
    license_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles([PlatformRole.SUPER_ADMIN, PlatformRole.IT_ADMIN])),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id),
):
    """Remove a license entered by mistake. Refused while any of its seats are in use or were ever used."""
    company_id = _company(current_user, tenant_company_id)
    item = _license(db, license_id, company_id, lock=True)
    if db.query(SoftwareLicenseAssignment.id).filter(SoftwareLicenseAssignment.license_id == item.id).first():
        raise HTTPException(status_code=400, detail="This license has seat history; cancel it instead of deleting.")
    software = _product(db, item.software_id, company_id)
    db.delete(item)
    sync_totals(db, software)
    db.commit()
    log_audit_event(db=db, action="DELETE_SOFTWARE_LICENSE", entity="SoftwareLicense", company_id=company_id,
                    user_id=current_user.id, entity_id=license_id, old_value=software.name)


@router.get("/assignments", response_model=List[SeatResponse])
def list_seats(
    active: Optional[bool] = True,
    user_id: Optional[str] = None,
    software_id: Optional[str] = None,
    limit: int = Query(200, ge=1, le=1000),
    db: Session = Depends(get_db),
    current_user: User = Depends(_viewers),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id),
):
    """Seat assignments (active by default; active=false for released history)."""
    company_id = _company(current_user, tenant_company_id)
    query = db.query(SoftwareLicenseAssignment).filter(SoftwareLicenseAssignment.company_id == company_id)
    if active is not None:
        query = query.filter(SoftwareLicenseAssignment.is_active.is_(active))
    if user_id:
        query = query.filter(SoftwareLicenseAssignment.user_id == user_id)
    if software_id:
        query = query.filter(SoftwareLicenseAssignment.software_id == software_id)
    seats = query.order_by(SoftwareLicenseAssignment.assigned_at.desc()).limit(limit).all()
    return _seat_responses(db, seats)


@router.post("/assignments/{assignment_id}/release", response_model=SeatResponse)
def release_assignment(
    assignment_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(_managers),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id),
):
    """Revoke a user's seat; it becomes available again."""
    company_id = _company(current_user, tenant_company_id)
    seat = db.query(SoftwareLicenseAssignment).filter(
        SoftwareLicenseAssignment.id == assignment_id, SoftwareLicenseAssignment.company_id == company_id
    ).with_for_update().first()
    if not seat:
        raise HTTPException(status_code=404, detail="Seat assignment not found.")
    release_seat(db, seat, current_user)
    software = db.query(Software).filter(Software.id == seat.software_id).first()
    holder = db.query(User).filter(User.id == seat.user_id).first()
    if holder and holder.id != current_user.id:
        notify(db, holder, title=f"Your access to {software.name if software else 'software'} was removed",
               message=f"{current_user.full_name} released your seat.",
               link=home_link(holder, "/profile", "/agent/assets?tab=software"), type="INFO")
    db.commit()
    log_audit_event(db=db, action="RELEASE_SOFTWARE_SEAT", entity="SoftwareLicenseAssignment", company_id=company_id,
                    user_id=current_user.id, entity_id=seat.id,
                    new_value=f"{software.name if software else seat.software_id} released from {holder.full_name if holder else seat.user_id}")
    return _seat_responses(db, [seat])[0]


@router.put("/assignments/{assignment_id}/deployment", response_model=SeatResponse)
def update_deployment(
    assignment_id: str,
    body: DeploymentUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(_managers),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id),
):
    """
    Record the installation status of a seat. No deployment system is
    connected: an admin records what happened; "Installed" means they
    confirmed it, never that the system installed it.
    """
    company_id = _company(current_user, tenant_company_id)
    seat = db.query(SoftwareLicenseAssignment).filter(
        SoftwareLicenseAssignment.id == assignment_id, SoftwareLicenseAssignment.company_id == company_id
    ).first()
    if not seat:
        raise HTTPException(status_code=404, detail="Seat assignment not found.")
    if not seat.is_active:
        raise HTTPException(status_code=400, detail="This seat has been released.")
    if body.status == "FAILED" and not (body.note or "").strip():
        raise HTTPException(status_code=400, detail="Say what went wrong with the installation.")
    old = seat.deployment_status
    seat.deployment_status = body.status
    seat.deployment_note = (body.note or "").strip() or None
    seat.deployment_updated_at = datetime.utcnow()
    seat.deployment_updated_by = current_user.id
    software = db.query(Software).filter(Software.id == seat.software_id).first()
    holder = db.query(User).filter(User.id == seat.user_id).first()
    if holder and holder.id != current_user.id and body.status in ("INSTALLED", "FAILED"):
        notify(db, holder,
               title=f"{software.name if software else 'Software'} " + ("is installed" if body.status == "INSTALLED" else "could not be installed"),
               message=f"{current_user.full_name}: {seat.deployment_note or 'recorded the installation.'}"[:300],
               link=home_link(holder, "/profile", "/agent/assets?tab=software"),
               type="SUCCESS" if body.status == "INSTALLED" else "WARNING")
    db.commit()
    log_audit_event(db=db, action="UPDATE_SOFTWARE_DEPLOYMENT", entity="SoftwareLicenseAssignment", company_id=company_id,
                    user_id=current_user.id, entity_id=seat.id,
                    old_value=old, new_value=f"{software.name if software else seat.software_id}: {body.status}")
    return _seat_responses(db, [seat])[0]


# --- Products -----------------------------------------------------------------

@router.post("", response_model=SoftwareDetail, status_code=status.HTTP_201_CREATED)
def create_software(
    software_in: SoftwareCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(_managers),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id),
):
    """Register a product, usually with its first license (License Number / License Count)."""
    company_id = _company(current_user, tenant_company_id)
    license_in = software_in.license
    if license_in is None and software_in.total_licenses:
        license_in = LicenseInput(
            seats=software_in.total_licenses, license_type=software_in.license_type or "PERPETUAL",
            cost=software_in.cost or Decimal("0"), expiry_date=software_in.expiry_date,
        )
    if license_in:
        _check_license_refs(db, company_id, license_in.model_dump())

    software = Software(
        company_id=company_id, name=software_in.name.strip(), vendor=(software_in.vendor or "").strip() or None,
        version=(software_in.version or "").strip() or None, status="ACTIVE", total_licenses=0, used_licenses=0,
        approval_required=software_in.approval_required,
    )
    db.add(software)
    db.flush()
    if license_in:
        db.add(SoftwareLicense(company_id=company_id, software_id=software.id, created_by=current_user.id,
                               **license_in.model_dump()))
    sync_totals(db, software)
    db.commit()
    db.refresh(software)
    log_audit_event(db=db, action="CREATE_SOFTWARE_LICENSE", entity="Software", company_id=company_id,
                    user_id=current_user.id, entity_id=software.id,
                    new_value=f"Software: {software.name}, seats: {software.total_licenses}")
    return get_software(software.id, db, current_user, tenant_company_id)


@router.get("", response_model=List[SoftwareResponse])
def list_software(
    skip: int = 0,
    limit: int = Query(100, ge=1, le=500),
    search: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(_viewers),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id),
):
    """Products with seats bought, in use and available."""
    company_id = _company(current_user, tenant_company_id)
    query = db.query(Software).filter(Software.company_id == company_id)
    if search:
        query = query.filter(Software.name.ilike(f"%{search}%") | Software.vendor.ilike(f"%{search}%"))
    products = query.order_by(Software.name).offset(skip).limit(limit).all()
    counts = dict(
        db.query(SoftwareLicense.software_id, func.count())
        .filter(SoftwareLicense.software_id.in_([p.id for p in products]))
        .group_by(SoftwareLicense.software_id).all()
    ) if products else {}
    return [_product_response(p, license_count=counts.get(p.id, 0)) for p in products]


@router.get("/{software_id}", response_model=SoftwareDetail)
def get_software(
    software_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(_viewers),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id),
):
    """One product with its licenses and seat history."""
    company_id = _company(current_user, tenant_company_id)
    software = _product(db, software_id, company_id)
    licenses = db.query(SoftwareLicense).filter(SoftwareLicense.software_id == software.id) \
        .order_by(SoftwareLicense.created_at).all()
    seats = db.query(SoftwareLicenseAssignment).filter(SoftwareLicenseAssignment.software_id == software.id) \
        .order_by(SoftwareLicenseAssignment.is_active.desc(), SoftwareLicenseAssignment.assigned_at.desc()).all()
    return _product_response(
        software, SoftwareDetail, license_count=len(licenses),
        licenses=_license_responses(db, licenses, current_user), seats=_seat_responses(db, seats),
    )


@router.put("/{software_id}", response_model=SoftwareDetail)
def update_software(
    software_id: str,
    update_in: SoftwareUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(_managers),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id),
):
    company_id = _company(current_user, tenant_company_id)
    software = _product(db, software_id, company_id)
    for field, value in update_in.model_dump(exclude_unset=True).items():
        if field == "name":
            software.name = value.strip()
        elif field == "approval_required":
            software.approval_required = bool(value)
        else:
            setattr(software, field, (value or "").strip() or None)
    db.commit()
    log_audit_event(db=db, action="UPDATE_SOFTWARE", entity="Software", company_id=company_id,
                    user_id=current_user.id, entity_id=software.id, new_value=software.name)
    return get_software(software.id, db, current_user, tenant_company_id)


@router.post("/{software_id}/licenses", response_model=LicenseResponse, status_code=status.HTTP_201_CREATED)
def add_license(
    software_id: str,
    license_in: LicenseInput,
    db: Session = Depends(get_db),
    current_user: User = Depends(_managers),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id),
):
    """Record another license purchase for a product (more seats, or a renewal on new terms)."""
    company_id = _company(current_user, tenant_company_id)
    software = _product(db, software_id, company_id)
    _check_license_refs(db, company_id, license_in.model_dump())
    item = SoftwareLicense(company_id=company_id, software_id=software.id, created_by=current_user.id,
                           **license_in.model_dump())
    db.add(item)
    sync_totals(db, software)
    db.commit()
    db.refresh(item)
    log_audit_event(db=db, action="ADD_SOFTWARE_LICENSE", entity="SoftwareLicense", company_id=company_id,
                    user_id=current_user.id, entity_id=item.id,
                    new_value=f"{software.name}: {item.seats} seats ({item.license_type})")
    return _license_responses(db, [item], current_user)[0]


@router.post("/{software_id}/assign", status_code=status.HTTP_201_CREATED)
def assign_software_license(
    software_id: str,
    assign_in: SeatAssign,
    db: Session = Depends(get_db),
    current_user: User = Depends(_managers),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id),
):
    """Give a user one seat (an admin operation; users ask through a software ticket)."""
    company_id = _company(current_user, tenant_company_id)
    software = _product(db, software_id, company_id)
    target = db.query(User).filter(User.id == assign_in.user_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="Target active user not found in this company.")
    seat = assign_seat(db, software, target, current_user, assign_in.license_id, assign_in.asset_id)
    if target.id != current_user.id:
        notify(db, target, title=f"You now have {software.name}",
               message=f"{current_user.full_name} assigned you a seat.",
               link=home_link(target, "/profile", "/agent/assets?tab=software"), type="SUCCESS")
    db.commit()
    log_audit_event(db=db, action="ASSIGN_SOFTWARE_LICENSE", entity="SoftwareLicenseAssignment", company_id=company_id,
                    user_id=current_user.id, entity_id=seat.id, new_value=f"{software.name} assigned to {target.full_name}")
    return {"message": "License assigned successfully.", "assigned_user_id": target.id, "assignment_id": seat.id}


@router.delete("/{software_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_software(
    software_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles([PlatformRole.SUPER_ADMIN, PlatformRole.IT_ADMIN])),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id),
):
    """Remove a product with no seats in use; its licenses and seat history go with it."""
    company_id = _company(current_user, tenant_company_id)
    software = _product(db, software_id, company_id)
    if db.query(SoftwareLicenseAssignment.id).filter(
        SoftwareLicenseAssignment.software_id == software.id, SoftwareLicenseAssignment.is_active.is_(True)
    ).first():
        raise HTTPException(status_code=400, detail="Release the seats in use before removing this software.")
    db.query(AssetRequest).filter(AssetRequest.software_id == software.id).update(
        {"software_id": None, "license_assignment_id": None}, synchronize_session=False)
    db.query(SoftwareLicenseAssignment).filter(SoftwareLicenseAssignment.software_id == software.id).delete()
    db.query(SoftwareLicense).filter(SoftwareLicense.software_id == software.id).delete()
    db.delete(software)
    db.commit()
    log_audit_event(db=db, action="DELETE_SOFTWARE", entity="Software", company_id=company_id,
                    user_id=current_user.id, entity_id=software_id, old_value=software.name)
    return None
