"""Implementation file: app/routers/profile.py

The signed-in user's own account: details, editable name / location, and
their recent activity. Works for every role.
"""
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user, profile_role
from app.models.models import AuditLog, PlatformRole, User
from app.schemas.schemas import UserProfile, UserProfileResponse
from app.services.audit_service import log_audit_event

router = APIRouter(prefix="/profile", tags=["Profile"])


class ProfileUpdate(BaseModel):
    name: str = Field(..., min_length=2, max_length=150)
    location: Optional[str] = Field(None, max_length=100)


class ProfileActivity(BaseModel):
    id: str
    action: str
    entity: str
    new_value: Optional[str] = None
    timestamp: datetime

    model_config = ConfigDict(from_attributes=True)


def _profile(db: Session, user: User) -> UserProfileResponse:
    logins = (
        db.query(AuditLog.timestamp)
        .filter(AuditLog.user_id == user.id, AuditLog.action == "USER_LOGIN")
        .order_by(AuditLog.timestamp.desc())
        .limit(2)
        .all()
    )
    return UserProfileResponse(
        user=UserProfile(
            id=user.id,
            name=user.full_name,
            email=user.email,
            role=profile_role(user.role),
            department=user.department.name if user.department else None,
            companyId=user.company_id,
            companyName=user.company.name if user.company else None,
            agentId=user.agent_id,
            location=user.location,
            modules=list(user.modules or []) if user.role == PlatformRole.SUB_ADMIN else [],
            memberSince=user.created_at,
            previousLoginAt=logins[1][0] if len(logins) > 1 else None,
            avatarUrl=None,
        )
    )


@router.get("", response_model=UserProfileResponse)
def get_profile(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    # Load in this request's session so department / organization can be read.
    return _profile(db, db.query(User).filter(User.id == current_user.id).first())


@router.put("", response_model=UserProfileResponse)
def update_profile(
    update_in: ProfileUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Change your own display name and location. Email and role are managed by admins."""
    user = db.query(User).filter(User.id == current_user.id).first()
    old = f"{user.full_name} / {user.location or '-'}"
    user.full_name = update_in.name.strip()
    user.location = (update_in.location or "").strip() or None
    db.commit()
    db.refresh(user)
    log_audit_event(
        db=db, action="UPDATE_PROFILE", entity="User", company_id=user.company_id, user_id=user.id,
        entity_id=user.id, old_value=old, new_value=f"{user.full_name} / {user.location or '-'}",
    )
    return _profile(db, user)


@router.get("/activity", response_model=List[ProfileActivity])
def my_activity(
    limit: int = Query(15, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Your own recent actions, newest first, including sign-ins."""
    return (
        db.query(AuditLog)
        .filter(AuditLog.user_id == current_user.id)
        .order_by(AuditLog.timestamp.desc())
        .limit(limit)
        .all()
    )
