"""Implementation file: app/routers/auth.py"""
import uuid
from datetime import timedelta
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db
from app.core.security import verify_password, create_access_token, get_password_hash
from app.core.deps import get_current_user
from app.models.models import User, Company, Subscription, PlatformRole
from app.schemas.schemas import Token, UserResponse, LoginRequest, RegisterRequest, UserProfile
from app.services.audit_service import log_audit_event

router = APIRouter(prefix="/auth", tags=["Authentication"])


@router.post("/login", response_model=Token)
def login(
    login_data: LoginRequest,
    db: Session = Depends(get_db)
):
    """
    Authenticate user with email and password, returning a JWT access token.
    """
    user = db.query(User).filter(User.email == login_data.email).first()
    if not user or not verify_password(login_data.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if user.status != "ACTIVE":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User account is inactive or suspended"
        )

    access_token_expires = timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={
            "sub": user.id,
            "role": user.role.value,
            "company_id": user.company_id
        },
        expires_delta=access_token_expires
    )

    log_audit_event(
        db=db,
        action="USER_LOGIN",
        entity="User",
        company_id=user.company_id,
        user_id=user.id,
        entity_id=user.id
    )

    return Token(
        access_token=access_token,
        token_type="bearer",
        role=user.role,
        company_id=user.company_id
    )


@router.post("/register", response_model=Token)
def register(
    register_data: RegisterRequest,
    db: Session = Depends(get_db)
):
    """
    Register a new user. IT_ADMIN and SUPER_ADMIN create a new company.
    IT_AGENT joins via invitation token (maps to EMPLOYEE role).
    """
    # Check if email already exists
    existing_user = db.query(User).filter(User.email == register_data.email).first()
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email already registered"
        )

    company = None

    # Map frontend roles to backend enum
    role_map = {
        "IT_AGENT": PlatformRole.EMPLOYEE,
        "IT_ADMIN": PlatformRole.IT_ADMIN,
        "SUPER_ADMIN": PlatformRole.SUPER_ADMIN,
    }
    backend_role = role_map.get(register_data.role, PlatformRole.IT_ADMIN)

    if register_data.role == "IT_AGENT":
        # IT Agent requires invitation token (company code)
        if not register_data.invitationToken:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invitation token required for IT Agent registration"
            )
        company = db.query(Company).filter(Company.code == register_data.invitationToken).first()
        if not company:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid invitation token"
            )
    else:
        # IT_ADMIN or SUPER_ADMIN - create new company
        if register_data.role == "SUPER_ADMIN":
            # Validate registration key (simple hardcoded for now)
            if register_data.registrationKey != "SETUP-2026-ITAM":
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Invalid Super Admin registration key"
                )
        
        # Create new company
        company_code = register_data.email.split("@")[0].upper()[:10]
        unique_suffix = uuid.uuid4().hex[:8]
        company = Company(
            name=f"{register_data.name}'s Company {unique_suffix}",
            code=company_code,
            status="ACTIVE"
        )
        db.add(company)
        db.flush()

        # Create subscription for the company
        subscription = Subscription(
            company_id=company.id,
            plan="ENTERPRISE",
            user_limit=500,
            asset_limit=2000,
            status="ACTIVE"
        )
        db.add(subscription)

    # Create user
    hashed_password = get_password_hash(register_data.password)
    user = User(
        company_id=company.id,
        email=register_data.email,
        hashed_password=hashed_password,
        full_name=register_data.name,
        role=backend_role,
        status="ACTIVE"
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    # Generate access token
    access_token_expires = timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
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
        access_token=access_token,
        token_type="bearer",
        role=user.role,
        company_id=user.company_id
    )


@router.get("/me", response_model=UserResponse)
def read_users_me(
    current_user: User = Depends(get_current_user)
):
    """
    Get profile information for the currently authenticated user.
    """
    return current_user


@router.get("/profile", response_model=UserProfile)
def get_profile(
    current_user: User = Depends(get_current_user)
):
    """
    Get profile information formatted for frontend.
    """
    department_name = current_user.department.name if current_user.department else None
    # Map backend EMPLOYEE to frontend IT_AGENT
    role_value = current_user.role.value
    if role_value == "EMPLOYEE":
        role_value = "IT_AGENT"
    return UserProfile(
        id=current_user.id,
        name=current_user.full_name,
        email=current_user.email,
        role=role_value,
        department=department_name,
        companyId=current_user.company_id,
        avatarUrl=None
    )


@router.get("", response_model=UserProfile)
def get_profile_root(
    current_user: User = Depends(get_current_user)
):
    """
    Get profile information formatted for frontend (alias for /api/profile).
    """
    return get_profile(current_user)


@router.post("/forgot-password")
def forgot_password(
    request_data: dict,
    db: Session = Depends(get_db)
):
    """
    Request password reset for an email address.
    Always returns success to prevent email enumeration.
    """
    email = request_data.get("email")
    if not email:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email is required"
        )
    
    # Check if user exists (but don't reveal)
    user = db.query(User).filter(User.email == email).first()
    
    if user:
        # TODO: Send actual reset email with token
        # For now, just log the request
        log_audit_event(
            db=db,
            action="PASSWORD_RESET_REQUEST",
            entity="User",
            company_id=user.company_id,
            user_id=user.id,
            entity_id=user.id
        )
    
    return {"message": "If the email exists, a password reset link has been sent."}