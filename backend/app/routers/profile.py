"""Implementation file: app/routers/profile.py

The signed-in user's own account: details, editable name / location, and
their recent activity. Works for every role.
"""
import base64
import binascii
import re
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user, profile_role
from app.models.models import AuditLog, PlatformRole, User
from app.schemas.schemas import UserProfile, UserProfileResponse
from app.services.audit_service import log_audit_event

router = APIRouter(prefix="/profile", tags=["Profile"])

# About 300 KB of image data once base64-encoded.
MAX_AVATAR_CHARS = 400_000
_DATA_URL = re.compile(r"^data:image/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$")
_MAGIC = {"png": b"\x89PNG", "jpeg": b"\xff\xd8\xff", "webp": b"RIFF"}


class ProfileUpdate(BaseModel):
    name: str = Field(..., min_length=2, max_length=150)
    location: Optional[str] = Field(None, max_length=100)
    phone: Optional[str] = Field(None, max_length=30, pattern=r"^[0-9+()\-\s]*$")
    jobTitle: Optional[str] = Field(None, max_length=100)
    employeeId: Optional[str] = Field(None, max_length=50)
    bio: Optional[str] = Field(None, max_length=500)
    organizationName: Optional[str] = Field(None, max_length=150)
    organizationId: Optional[str] = Field(None, max_length=60)


class AvatarUpload(BaseModel):
    # A data URL, e.g. "data:image/jpeg;base64,...". The browser resizes the
    # photo to a small square first, so this stays well under the limit.
    image: str = Field(..., max_length=MAX_AVATAR_CHARS)


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
            avatarUrl=user.avatar,
            phone=user.phone,
            jobTitle=user.job_title,
            employeeId=user.employee_code,
            bio=user.bio,
            organizationName=user.profile_org_name,
            organizationId=user.profile_org_code,
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
    """Change your own details. Email, role and the account's organization are managed by admins."""
    user = db.query(User).filter(User.id == current_user.id).first()
    old = f"{user.full_name} / {user.location or '-'}"
    clean = lambda value: (value or "").strip() or None  # noqa: E731
    user.full_name = update_in.name.strip()
    user.location = clean(update_in.location)
    user.phone = clean(update_in.phone)
    user.job_title = clean(update_in.jobTitle)
    user.employee_code = clean(update_in.employeeId)
    user.bio = clean(update_in.bio)
    user.profile_org_name = clean(update_in.organizationName)
    user.profile_org_code = clean(update_in.organizationId)
    db.commit()
    db.refresh(user)
    log_audit_event(
        db=db, action="UPDATE_PROFILE", entity="User", company_id=user.company_id, user_id=user.id,
        entity_id=user.id, old_value=old, new_value=f"{user.full_name} / {user.location or '-'}",
    )
    return _profile(db, user)


@router.put("/avatar", response_model=UserProfileResponse)
def upload_avatar(
    upload: AvatarUpload,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Set your profile photo (PNG, JPEG or WebP, sent as a data URL)."""
    match = _DATA_URL.match(upload.image)
    if not match:
        raise HTTPException(status_code=400, detail="Upload a PNG, JPEG or WebP image.")
    try:
        raw = base64.b64decode(match.group(2), validate=True)
    except (binascii.Error, ValueError):
        raise HTTPException(status_code=400, detail="The image could not be read.")
    if not raw.startswith(_MAGIC[match.group(1)]):
        raise HTTPException(status_code=400, detail="The file is not a valid image.")
    user = db.query(User).filter(User.id == current_user.id).first()
    user.avatar = upload.image
    db.commit()
    db.refresh(user)
    log_audit_event(db=db, action="UPDATE_PROFILE_PHOTO", entity="User", company_id=user.company_id,
                    user_id=user.id, entity_id=user.id, new_value="Profile photo changed")
    return _profile(db, user)


@router.delete("/avatar", response_model=UserProfileResponse)
def remove_avatar(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Remove your profile photo; your initials are shown instead."""
    user = db.query(User).filter(User.id == current_user.id).first()
    user.avatar = None
    db.commit()
    db.refresh(user)
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
