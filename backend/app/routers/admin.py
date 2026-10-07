"""Implementation file: app/routers/admin.py"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_password_hash, create_access_token
from app.core.deps import get_current_user
from app.models.models import User, Company, PlatformRole
from app.schemas.schemas import Token
from app.services.audit_service import log_audit_event
from app.core.config import settings
from datetime import timedelta

router = APIRouter(prefix="/admin", tags=["Admin"])


@router.post("/invite")
def invite_user(
    invite_data: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Create an invitation for an IT Agent to join the company.
    Returns an invitation token (company code).
    """
    # Only IT_ADMIN and SUPER_ADMIN can invite
    if current_user.role not in [PlatformRole.IT_ADMIN, PlatformRole.SUPER_ADMIN]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only IT Admin or Super Admin can invite agents"
        )
    
    email = invite_data.get("email")
    department = invite_data.get("department", "IT Support")
    
    if not email:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email is required"
        )
    
    # Check if user already exists
    existing_user = db.query(User).filter(User.email == email).first()
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User with this email already exists"
        )
    
    # Get company code as invitation token
    company = db.query(Company).filter(Company.id == current_user.company_id).first()
    if not company:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Company not found"
        )
    
    log_audit_event(
        db=db,
        action="INVITE_AGENT",
        entity="User",
        company_id=current_user.company_id,
        user_id=current_user.id,
        entity_id=None
    )
    
    return {"invitationToken": company.code}


@router.post("/invite/complete")
def complete_invite(
    invite_data: dict,
    db: Session = Depends(get_db)
):
    """
    Complete IT Agent registration using invitation token.
    """
    name = invite_data.get("name")
    email = invite_data.get("email")
    password = invite_data.get("password")
    invitation_token = invite_data.get("invitationToken")
    
    if not all([name, email, password, invitation_token]):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="All fields are required"
        )
    
    # Find company by invitation token (company code)
    company = db.query(Company).filter(Company.code == invitation_token).first()
    if not company:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid invitation token"
        )
    
    # Check if email already exists
    existing_user = db.query(User).filter(User.email == email).first()
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email already registered"
        )
    
    # Create user as IT_AGENT (maps to EMPLOYEE role)
    hashed_password = get_password_hash(password)
    user = User(
        company_id=company.id,
        email=email,
        hashed_password=hashed_password,
        full_name=name,
        role=PlatformRole.EMPLOYEE,
        status="ACTIVE"
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    
    # Generate access token
    access_token_expires = timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token_obj = create_access_token(
        data={
            "sub": user.id,
            "role": user.role.value,
            "company_id": user.company_id
        },
        expires_delta=access_token_expires
    )
    
    log_audit_event(
        db=db,
        action="USER_REGISTER",
        entity="User",
        company_id=user.company_id,
        user_id=user.id,
        entity_id=user.id
    )
    
    return Token(
        access_token=access_token_obj,
        token_type="bearer",
        role=user.role,
        company_id=user.company_id
    )