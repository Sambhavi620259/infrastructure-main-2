"""Implementation file: app/routers/auth.py"""
from datetime import timedelta
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db
from app.core.security import verify_password, create_access_token, get_password_hash
from app.core.deps import get_current_user
from app.models.models import User
from app.schemas.schemas import Token, UserResponse, LoginRequest
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


@router.get("/me", response_model=UserResponse)
def read_users_me(
    current_user: User = Depends(get_current_user)
):
    """
    Get profile information for the currently authenticated user.
    """
    return current_user