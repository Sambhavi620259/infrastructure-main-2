"""Implementation file: app/routers/auth.py"""
import uuid
from datetime import timedelta
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db
from app.core.rate_limit import auth_rate_limit
from app.core.security import verify_password, create_access_token, get_password_hash
from app.core.deps import get_current_user, organization_suspended, profile_role
from app.models.models import User, Company, Subscription, PlatformRole
from app.schemas.schemas import Token, UserResponse, LoginRequest, RegisterRequest, UserProfile
from app.services.audit_service import log_audit_event
from app.services.notification_service import notify, notify_company, notify_super_admins
from app.services.agent_id_service import new_agent_id
from app.services.catalog_service import ensure_default_catalog
from app.services.platform_settings_service import get_provisioning_defaults
from app.services.super_key_service import MIN_KEY_LENGTH, set_super_key, super_key_exists, verify_super_key

router = APIRouter(prefix="/auth", tags=["Authentication"])


@router.post("/login", response_model=Token)
def login(
    login_data: LoginRequest,
    db: Session = Depends(get_db),
    _limited: None = Depends(auth_rate_limit)
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
    if organization_suspended(user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Your organization is suspended. Contact the platform administrator."
        )
    # A Super Admin signs in with password and the Super Admin key.
    if user.role == PlatformRole.SUPER_ADMIN and super_key_exists(db) and not verify_super_key(db, login_data.super_admin_key):
        log_audit_event(db=db, action="SUPER_ADMIN_KEY_FAILED", entity="User", user_id=user.id, entity_id=user.id)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Enter the correct Super Admin key." if login_data.super_admin_key else "Super Admins must enter the Super Admin key.",
            headers={"WWW-Authenticate": "Bearer"},
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
        role=profile_role(user.role),
        company_id=user.company_id
    )


@router.post("/register", response_model=Token)
def register(
    register_data: RegisterRequest,
    db: Session = Depends(get_db),
    _limited: None = Depends(auth_rate_limit)
):
    """
    Register a new user. IT_ADMIN and SUPER_ADMIN create a new company.
    IT_AGENT (stored as EMPLOYEE) signs up with no organization until an IT
    Admin adds them.
    """
    # Check if email already exists
    existing_user = db.query(User).filter(func.lower(User.email) == register_data.email.strip().lower()).first()
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

    creating_super_key = False
    if register_data.role == "IT_AGENT":
        # Agents sign up on their own, without an organization. An IT Admin
        # adds them to one from the Users page (POST /users/{id}/add-to-organization).
        pass
    else:
        # IT_ADMIN or SUPER_ADMIN - create new company
        if register_data.role == "SUPER_ADMIN":
            # The platform has exactly one Super Admin: the first to register.
            if db.query(User.id).filter(User.role == PlatformRole.SUPER_ADMIN).first():
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="This platform already has its Super Admin. Only one Super Admin is allowed."
                )
            key = register_data.registrationKey or ""
            if super_key_exists(db):
                if not verify_super_key(db, key):
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail="Incorrect Super Admin key."
                    )
            else:
                # No key yet: this Super Admin creates it.
                if len(key) < MIN_KEY_LENGTH:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail=f"Create a Super Admin key of at least {MIN_KEY_LENGTH} characters."
                    )
                if key != (register_data.registrationKeyConfirm or ""):
                    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="The two keys do not match.")
                creating_super_key = True
        
        # Create new company
        unique_suffix = uuid.uuid4().hex[:8]
        # Codes are unique, and many admins share an email prefix ("admin@...").
        company_code = f"{register_data.email.split('@')[0].upper()[:10]}-{unique_suffix[:4].upper()}"
        company = Company(
            name=f"{register_data.name}'s Company {unique_suffix}",
            code=company_code,
            status="ACTIVE"
        )
        db.add(company)
        db.flush()

        # Create subscription for the company
        defaults = get_provisioning_defaults(db)
        subscription = Subscription(
            company_id=company.id,
            plan=defaults.plan,
            user_limit=defaults.user_limit,
            asset_limit=defaults.asset_limit,
            status="ACTIVE"
        )
        db.add(subscription)
        ensure_default_catalog(db, company.id)

    # Create user
    hashed_password = get_password_hash(register_data.password)
    is_agent = register_data.role == "IT_AGENT"
    user = User(
        company_id=company.id if company else None,
        email=register_data.email.strip().lower() if is_agent else register_data.email,
        hashed_password=hashed_password,
        full_name=register_data.name,
        agent_id=new_agent_id(db, register_data.name) if is_agent else None,
        role=backend_role,
        status="ACTIVE"
    )
    db.add(user)
    if is_agent:
        db.flush()
        notify_super_admins(
            db, f"New user sign-up: {user.full_name}",
            f"{user.email} is waiting to be added to an organization.", "/super-admin",
        )
        for admin in db.query(User).filter(User.role == PlatformRole.IT_ADMIN, User.status == "ACTIVE").all():
            notify(db, admin, f"New user sign-up: {user.full_name}",
                   f"{user.email} is waiting to be added to an organization.", "/users")
    elif company is not None and backend_role == PlatformRole.IT_ADMIN:
        notify_super_admins(
            db, f"New organization: {company.name}", f"Created by {register_data.name} ({register_data.email}).",
            "/super-admin/companies",
        )
    if creating_super_key:
        db.flush()  # user.id, recorded as who set the key
        set_super_key(db, register_data.registrationKey, user.id)
    try:
        db.commit()
    except IntegrityError:
        # Someone else created the first key at the same moment.
        db.rollback()
        raise HTTPException(status_code=409, detail="A Super Admin key was just created. Register again with that key.")
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
        role=profile_role(user.role),
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
    role_value = profile_role(current_user.role)
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


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


@router.post("/forgot-password")
def forgot_password(
    request_data: ForgotPasswordRequest,
    db: Session = Depends(get_db),
    _limited: None = Depends(auth_rate_limit)
):
    """
    Ask for a password reset. There is no email service, so the user's IT
    Admins (or the Super Admins, for platform accounts) get an in-app
    notification and reset it from the Users page. Always answers the same way
    so the response does not reveal whether an account exists.
    """
    user = db.query(User).filter(func.lower(User.email) == request_data.email.lower()).first()
    if user and user.status == "ACTIVE":
        title = f"{user.full_name} asked for a password reset"
        message = f"{user.email} cannot sign in. Open the user and choose Reset password."
        if user.company_id:
            notify_company(
                db, user.company_id, [PlatformRole.IT_ADMIN], title=title, message=message,
                admin_link=f"/users/{user.id}", exclude_user_id=user.id, type="WARNING",
            )
        for admin in db.query(User).filter(
            User.role == PlatformRole.SUPER_ADMIN, User.status == "ACTIVE", User.id != user.id
        ).all() if user.role == PlatformRole.SUPER_ADMIN else []:
            notify(db, admin, title, message, "/super-admin/admins", "WARNING")
        db.commit()
        log_audit_event(
            db=db,
            action="PASSWORD_RESET_REQUEST",
            entity="User",
            company_id=user.company_id,
            user_id=user.id,
            entity_id=user.id
        )
    return {"message": "If that account exists, your administrator has been asked to reset the password."}


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str = Field(..., min_length=8, max_length=128)


@router.post("/change-password")
def change_password(
    body: ChangePasswordRequest,
    db: Session = Depends(get_db),
    _limited: None = Depends(auth_rate_limit),
    current_user: User = Depends(get_current_user)
):
    """Change the signed-in user's password after confirming the current one."""
    # Load the row in this request's session so the change is saved here.
    user = db.query(User).filter(User.id == current_user.id).first()
    if not verify_password(body.current_password, user.hashed_password):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Current password is incorrect.")
    if body.current_password == body.new_password:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Choose a password different from the current one.")
    user.hashed_password = get_password_hash(body.new_password)
    db.commit()
    log_audit_event(
        db=db,
        action="CHANGE_PASSWORD",
        entity="User",
        company_id=current_user.company_id,
        user_id=current_user.id,
        entity_id=current_user.id
    )
    return {"message": "Password changed."}


@router.get("/super-admin-key")
def super_admin_key_status(db: Session = Depends(get_db)):
    """Public: whether a Super Admin key exists and whether Super Admin
    registration is still open (only one Super Admin is allowed). Never reveals the key."""
    return {
        "exists": super_key_exists(db),
        "registration_open": db.query(User.id).filter(User.role == PlatformRole.SUPER_ADMIN).first() is None,
    }


class SuperKeyChange(BaseModel):
    current_key: str
    new_key: str = Field(..., min_length=MIN_KEY_LENGTH, max_length=128)


@router.put("/super-admin-key")
def change_super_admin_key(
    body: SuperKeyChange,
    db: Session = Depends(get_db),
    _limited: None = Depends(auth_rate_limit),
    current_user: User = Depends(get_current_user)
):
    """A Super Admin replaces the key; the current key is required."""
    if current_user.role != PlatformRole.SUPER_ADMIN:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only a Super Admin can change this key.")
    if super_key_exists(db) and not verify_super_key(db, body.current_key):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Current Super Admin key is incorrect.")
    set_super_key(db, body.new_key, current_user.id)
    db.commit()
    log_audit_event(db=db, action="CHANGE_SUPER_ADMIN_KEY", entity="PlatformSetting", user_id=current_user.id)
    return {"message": "Super Admin key changed."}
