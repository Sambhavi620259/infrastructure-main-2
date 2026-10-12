"""Implementation file: app/routers/users.py"""
from typing import List, Optional
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_password_hash
from app.core.deps import get_current_user, require_roles, get_tenant_company_id
from app.models.models import (
    AssetAssignment, AssetRequest, AuditLog, Company, Department, PlatformRole, RequestStatusEnum, Subscription, User,
)
from app.schemas.schemas import UserCreate, UserResponse, UserUpdate
from app.routers.asset_requests import OPEN_TICKET_STATUSES
from app.services.agent_id_service import new_agent_id
from app.services.audit_service import log_audit_event
from app.services.usage_alerts import check_usage_limits
from app.services.notification_service import notify

router = APIRouter(prefix="/users", tags=["Users Management"])

_admins = require_roles([PlatformRole.SUPER_ADMIN, PlatformRole.IT_ADMIN])
# Full user records (emails, roles, status). IT Agents (EMPLOYEE) are not
# included: they get names only, from GET /users/directory.
_directory_readers = require_roles([
    PlatformRole.SUPER_ADMIN, PlatformRole.IT_ADMIN, PlatformRole.SUB_ADMIN, PlatformRole.REPORTING_USER,
])


SUB_ADMIN_MODULES = {"HAM", "SAM", "CLOUD", "SCAN", "REPORTS"}
USER_STATUSES = {"ACTIVE", "INACTIVE"}


def _check_user_fields(db: Session, company_id: Optional[str], role: Optional[PlatformRole],
                       modules: Optional[List[str]], department_id: Optional[str]) -> None:
    """Rules shared by create and update. Super Admin accounts are made only at registration."""
    if role == PlatformRole.SUPER_ADMIN:
        raise HTTPException(status_code=403, detail="Super Admin accounts cannot be created or assigned here.")
    if role == PlatformRole.SUB_ADMIN:
        if not modules:
            raise HTTPException(status_code=400, detail="Choose at least one module for a Sub-admin.")
        unknown = sorted(set(modules) - SUB_ADMIN_MODULES)
        if unknown:
            raise HTTPException(status_code=400, detail=f"Unknown module(s): {', '.join(unknown)}.")
    if department_id and not db.query(Department.id).filter(
        Department.id == department_id, Department.company_id == company_id
    ).first():
        raise HTTPException(status_code=400, detail="Unknown department.")


class ActivitySummary(BaseModel):
    tickets_raised: int
    tickets_raised_pending: int
    tickets_in_progress: int
    tickets_approved: int
    tickets_rejected: int
    assets_assigned: int
    assets_unassigned: int
    asset_status_changes: int
    stock_adjustments: int
    reports_generated: int
    assets_held: int


class ActivityEntry(BaseModel):
    id: str
    action: str
    entity: str
    entity_id: Optional[str] = None
    old_value: Optional[str] = None
    new_value: Optional[str] = None
    timestamp: datetime

    model_config = ConfigDict(from_attributes=True)


class UserActivityResponse(BaseModel):
    user: UserResponse
    summary: ActivitySummary
    last_active_at: Optional[datetime] = None
    recent: List[ActivityEntry]


class UserDirectoryEntry(BaseModel):
    """What an IT Agent may see about a colleague: enough to pick them in a form."""
    id: str
    full_name: str
    department_id: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)


def _check_user_limit(db: Session, company_id: str) -> None:
    """Refuse when the company's subscription has no seats left for an active user."""
    subscription = db.query(Subscription).filter(Subscription.company_id == company_id).first()
    if not subscription:
        return
    active = db.query(User).filter(User.company_id == company_id, User.status == "ACTIVE").count()
    if active >= subscription.user_limit:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Subscription user limit ({subscription.user_limit}) reached for this company."
        )


def _is_unassigned_agent(user: User) -> bool:
    """An IT Agent who signed up on their own and is not in any organization yet."""
    return user.company_id is None and user.role == PlatformRole.EMPLOYEE


def _manageable_user(db: Session, user_id: str, current_user: User, tenant_company_id: Optional[str]) -> User:
    """
    A user this admin may add, remove or reactivate: anyone in their company,
    or an IT Agent who is not in any organization yet. Super Admin: anyone.
    """
    user = db.query(User).filter(User.id == user_id).first()
    if user and current_user.role != PlatformRole.SUPER_ADMIN:
        company_id = tenant_company_id or current_user.company_id
        if user.company_id != company_id and not _is_unassigned_agent(user):
            user = None
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")
    return user


@router.post("", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
def create_user(
    user_in: UserCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles([PlatformRole.SUPER_ADMIN, PlatformRole.IT_ADMIN])),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id)
):
    """
    Create a new user within the authenticated tenant context.
    Super Admins can explicitly pass a target company_id.
    """
    target_company_id = user_in.company_id if current_user.role == PlatformRole.SUPER_ADMIN else (tenant_company_id or current_user.company_id)

    if not target_company_id and current_user.role != PlatformRole.SUPER_ADMIN:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Target company context must be provided."
        )

    # Check for existing email across system
    existing_user = db.query(User).filter(func.lower(User.email) == user_in.email.lower()).first()
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A user with this email address already exists."
        )

    _check_user_fields(db, target_company_id, user_in.role, user_in.modules, user_in.department_id)
    if target_company_id:
        _check_user_limit(db, target_company_id)

    hashed_pwd = get_password_hash(user_in.password)
    new_user = User(
        email=user_in.email,
        hashed_password=hashed_pwd,
        full_name=user_in.full_name,
        role=user_in.role,
        company_id=target_company_id,
        department_id=user_in.department_id,
        location=user_in.location,
        modules=sorted(set(user_in.modules)) if user_in.role == PlatformRole.SUB_ADMIN else None,
        agent_id=new_agent_id(db, user_in.full_name) if user_in.role == PlatformRole.EMPLOYEE else None,
        status="ACTIVE"
    )
    db.add(new_user)
    if target_company_id:
        check_usage_limits(db, target_company_id)
    db.commit()
    db.refresh(new_user)

    log_audit_event(
        db=db,
        action="CREATE_USER",
        entity="User",
        company_id=target_company_id,
        user_id=current_user.id,
        entity_id=new_user.id,
        new_value=f"Email: {new_user.email}, Role: {new_user.role.value}"
    )

    return new_user


@router.get("", response_model=List[UserResponse])
def list_users(
    skip: int = 0,
    limit: int = 100,
    department_id: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(_directory_readers),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id)
):
    """
    List all users in current tenant company.
    """
    company_id = tenant_company_id or current_user.company_id
    query = db.query(User)
    
    if current_user.role != PlatformRole.SUPER_ADMIN:
        if not company_id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Company context required.")
        query = query.filter(User.company_id == company_id)

    if department_id:
        query = query.filter(User.department_id == department_id)

    users = query.offset(skip).limit(limit).all()
    return users


@router.get("/counts")
def get_user_counts(
    db: Session = Depends(get_db),
    current_user: User = Depends(_directory_readers),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id)
):
    """
    Get user counts for dashboard badges.
    """
    company_id = tenant_company_id or current_user.company_id
    if not company_id and current_user.role != PlatformRole.SUPER_ADMIN:
        raise HTTPException(status_code=400, detail="Company context required")

    base = db.query(User)
    if current_user.role != PlatformRole.SUPER_ADMIN:
        base = base.filter(User.company_id == company_id)

    return {
        "total": base.count(),
        "employees": base.filter(User.role == PlatformRole.EMPLOYEE).count(),
        "agents": base.filter(User.role == PlatformRole.EMPLOYEE).count(),
        "admins": base.filter(User.role.in_([PlatformRole.IT_ADMIN, PlatformRole.SUB_ADMIN])).count(),
    }


@router.get("/directory", response_model=List[UserDirectoryEntry])
def list_user_directory(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id)
):
    """Active users of the caller's organization, names only, for pickers such as Assign."""
    company_id = tenant_company_id or current_user.company_id
    if not company_id:
        raise HTTPException(status_code=400, detail="Company context required.")
    return (
        db.query(User)
        .filter(User.company_id == company_id, User.status == "ACTIVE")
        .order_by(User.full_name)
        .all()
    )


@router.get("/unassigned", response_model=List[UserResponse])
def list_unassigned_agents(
    db: Session = Depends(get_db),
    current_user: User = Depends(_admins),
):
    """IT Agents who signed up on their own and are not in any organization yet, newest first."""
    return (
        db.query(User)
        .filter(User.company_id.is_(None), User.role == PlatformRole.EMPLOYEE)
        .order_by(User.created_at.desc())
        .all()
    )


@router.post("/{user_id}/add-to-organization", response_model=UserResponse)
def add_agent_to_organization(
    user_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(_admins),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id)
):
    """Move a self-registered IT Agent into this admin's organization."""
    company_id = tenant_company_id or current_user.company_id
    if not company_id:
        raise HTTPException(status_code=400, detail="Your account is not in an organization.")
    user = _manageable_user(db, user_id, current_user, tenant_company_id)
    if not _is_unassigned_agent(user):
        raise HTTPException(status_code=400, detail="This user is already in an organization.")
    if user.status == "ACTIVE":
        _check_user_limit(db, company_id)

    user.company_id = company_id
    company = db.query(Company).filter(Company.id == company_id).first()
    notify(
        db, user,
        title=f"You've been added to {company.name if company else 'an organization'}",
        message="Your IT Agent dashboard is ready.",
        link="/agent/dashboard",
        type="SUCCESS",
    )
    check_usage_limits(db, company_id)
    db.commit()
    db.refresh(user)

    log_audit_event(
        db=db,
        action="ADD_USER_TO_ORGANIZATION",
        entity="User",
        company_id=company_id,
        user_id=current_user.id,
        entity_id=user.id,
        new_value=f"Email: {user.email}, Agent ID: {user.agent_id}"
    )
    return user


class PasswordReset(BaseModel):
    new_password: str = Field(..., min_length=8, max_length=128)


@router.post("/{user_id}/reset-password")
def reset_user_password(
    user_id: str,
    body: PasswordReset,
    db: Session = Depends(get_db),
    current_user: User = Depends(_admins),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id)
):
    """Set a temporary password for a user who cannot sign in (they can change it in Settings)."""
    user = _manageable_user(db, user_id, current_user, tenant_company_id)
    if user.role == PlatformRole.SUPER_ADMIN and current_user.role != PlatformRole.SUPER_ADMIN:
        raise HTTPException(status_code=403, detail="Only a Super Admin can reset a Super Admin's password.")
    user.hashed_password = get_password_hash(body.new_password)
    notify(
        db, user,
        title="Your password was reset",
        message=f"{current_user.full_name} set a temporary password. Change it in Settings after signing in.",
        type="WARNING",
    )
    db.commit()
    log_audit_event(
        db=db,
        action="RESET_USER_PASSWORD",
        entity="User",
        company_id=user.company_id,
        user_id=current_user.id,
        entity_id=user.id,
        new_value=f"Temporary password set for {user.email}"
    )
    return {"message": f"Temporary password set for {user.email}."}


@router.post("/{user_id}/reactivate", response_model=UserResponse)
def reactivate_user(
    user_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(_admins),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id)
):
    """Undo a removal: the user can sign in again."""
    user = _manageable_user(db, user_id, current_user, tenant_company_id)
    if user.status == "ACTIVE":
        return user
    if user.company_id:
        _check_user_limit(db, user.company_id)
    user.status = "ACTIVE"
    db.commit()
    db.refresh(user)

    log_audit_event(
        db=db,
        action="REACTIVATE_USER",
        entity="User",
        company_id=user.company_id,
        user_id=current_user.id,
        entity_id=user.id
    )
    return user


@router.get("/{user_id}/activity", response_model=UserActivityResponse)
def get_user_activity(
    user_id: str,
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles([PlatformRole.SUPER_ADMIN, PlatformRole.IT_ADMIN, PlatformRole.SUB_ADMIN])),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id)
):
    """
    Review one user's work: counts of what they have done and their recent
    actions from the audit log, newest first.
    """
    query = db.query(User).filter(User.id == user_id)
    if current_user.role != PlatformRole.SUPER_ADMIN:
        query = query.filter(User.company_id == (tenant_company_id or current_user.company_id))
    user = query.first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")

    actions = dict(
        db.query(AuditLog.action, func.count(AuditLog.id))
        .filter(AuditLog.user_id == user.id)
        .group_by(AuditLog.action)
        .all()
    )
    tickets = db.query(AssetRequest).filter(AssetRequest.company_id == user.company_id)
    summary = ActivitySummary(
        tickets_raised=tickets.filter(AssetRequest.raised_by == user.id).count(),
        # Still open: pending, in progress or approved and waiting for stock.
        tickets_raised_pending=tickets.filter(
            AssetRequest.raised_by == user.id, AssetRequest.status.in_(OPEN_TICKET_STATUSES)
        ).count(),
        tickets_in_progress=tickets.filter(
            AssetRequest.processed_by == user.id, AssetRequest.status == RequestStatusEnum.IN_PROGRESS
        ).count(),
        tickets_approved=tickets.filter(
            AssetRequest.processed_by == user.id,
            AssetRequest.status.in_([RequestStatusEnum.APPROVED, RequestStatusEnum.FULFILLED]),
        ).count(),
        tickets_rejected=tickets.filter(
            AssetRequest.processed_by == user.id, AssetRequest.status == RequestStatusEnum.REJECTED
        ).count(),
        assets_assigned=actions.get("ASSIGN_ASSET", 0),
        assets_unassigned=actions.get("UNASSIGN_ASSET", 0),
        asset_status_changes=actions.get("UPDATE_ASSET", 0),
        stock_adjustments=actions.get("ADJUST_INVENTORY_STOCK", 0),
        reports_generated=actions.get("GENERATE_REPORT", 0),
        assets_held=db.query(AssetAssignment).filter(
            AssetAssignment.user_id == user.id, AssetAssignment.is_active.is_(True)
        ).count(),
    )
    # Sign-ins are logged too but are noise in a work review.
    recent = (
        db.query(AuditLog)
        .filter(AuditLog.user_id == user.id, AuditLog.action != "USER_LOGIN")
        .order_by(AuditLog.timestamp.desc())
        .limit(limit)
        .all()
    )
    last_active_at = db.query(func.max(AuditLog.timestamp)).filter(AuditLog.user_id == user.id).scalar()
    return UserActivityResponse(user=user, summary=summary, last_active_at=last_active_at, recent=recent)


@router.get("/{user_id}", response_model=UserResponse)
def get_user_by_id(
    user_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(_directory_readers),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id)
):
    """
    Retrieve specific user details.
    """
    company_id = tenant_company_id or current_user.company_id
    query = db.query(User).filter(User.id == user_id)
    
    if current_user.role != PlatformRole.SUPER_ADMIN:
        if not company_id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Company context required.")
        query = query.filter(User.company_id == company_id)

    user = query.first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found."
        )
    return user


@router.put("/{user_id}", response_model=UserResponse)
def update_user(
    user_id: str,
    user_in: UserUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles([PlatformRole.SUPER_ADMIN, PlatformRole.IT_ADMIN])),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id)
):
    """
    Update user profile, department, location, or role.
    """
    company_id = tenant_company_id or current_user.company_id
    query = db.query(User).filter(User.id == user_id)
    
    if current_user.role != PlatformRole.SUPER_ADMIN:
        if not company_id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Company context required.")
        query = query.filter(User.company_id == company_id)

    user = query.first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found."
        )

    old_role = user.role.value

    update_data = user_in.model_dump(exclude_unset=True)
    if user.id == current_user.id and ("role" in update_data or "status" in update_data):
        raise HTTPException(status_code=400, detail="You cannot change your own role or status.")
    if "status" in update_data:
        update_data["status"] = (update_data["status"] or "").upper()
        if update_data["status"] not in USER_STATUSES:
            raise HTTPException(status_code=400, detail="Status must be ACTIVE or INACTIVE.")
    new_role = update_data.get("role") or user.role
    _check_user_fields(
        db, user.company_id,
        update_data.get("role") or (PlatformRole.SUB_ADMIN if new_role == PlatformRole.SUB_ADMIN and "modules" in update_data else None),
        update_data.get("modules", user.modules) if new_role == PlatformRole.SUB_ADMIN else None,
        update_data.get("department_id"),
    )
    if new_role == PlatformRole.SUB_ADMIN:
        if "modules" in update_data:
            update_data["modules"] = sorted(set(update_data["modules"] or []))
    else:
        update_data["modules"] = None
    if new_role == PlatformRole.EMPLOYEE and not user.agent_id:
        user.agent_id = new_agent_id(db, update_data.get("full_name") or user.full_name)
    for field, value in update_data.items():
        setattr(user, field, value)

    db.commit()
    db.refresh(user)

    log_audit_event(
        db=db,
        action="UPDATE_USER",
        entity="User",
        company_id=user.company_id,
        user_id=current_user.id,
        entity_id=user.id,
        old_value=f"Role: {old_role}",
        new_value=f"Role: {user.role.value}, Status: {user.status}"
    )

    return user


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def deactivate_user(
    user_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles([PlatformRole.SUPER_ADMIN, PlatformRole.IT_ADMIN])),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id)
):
    """
    Remove a user: the account is deactivated (kept for history) and can no
    longer sign in. Reversible with POST /users/{id}/reactivate.
    """
    user = _manageable_user(db, user_id, current_user, tenant_company_id)
    if user.id == current_user.id:
        raise HTTPException(status_code=400, detail="You cannot remove your own account.")

    user.status = "INACTIVE"
    db.commit()

    log_audit_event(
        db=db,
        action="DEACTIVATE_USER",
        entity="User",
        company_id=user.company_id,
        user_id=current_user.id,
        entity_id=user.id
    )
    return None