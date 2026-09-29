"""Implementation file: app/core/deps.py"""
from typing import List, Optional
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db
from app.models.models import User, PlatformRole

oauth2_scheme = OAuth2PasswordBearer(
    tokenUrl=f"{settings.API_V1_STR}/auth/login"
)


def get_current_user(
    token: str = Depends(oauth2_scheme), 
    db: Session = Depends(get_db)
) -> User:
    """
    Validates JWT access token, verifies session integrity, and fetches active user context.
    """
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(
            token, 
            settings.SECRET_KEY, 
            algorithms=[settings.ALGORITHM]
        )
        user_id: str = payload.get("sub")
        if user_id is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception

    user = db.query(User).filter(User.id == user_id).first()
    if not user or user.status != "ACTIVE":
        raise credentials_exception
    return user


def require_roles(allowed_roles: List[PlatformRole]):
    """
    Role-Based Access Control (RBAC) dependency factory to enforce endpoint permissions.
    """
    def role_checker(current_user: User = Depends(get_current_user)) -> User:
        if current_user.role not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Insufficient permissions to execute this action"
            )
        return current_user
    return role_checker


def get_tenant_company_id(
    current_user: User = Depends(get_current_user)
) -> Optional[str]:
    """
    Extracts tenant context from the authenticated JWT session.
    Prevents cross-tenant data leakage by enforcing tenant boundaries.
    """
    if current_user.role == PlatformRole.SUPER_ADMIN:
        return None  # Super Admin operates globally across companies
    
    if not current_user.company_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, 
            detail="Authenticated user context is not associated with any active company tenant."
        )
    return current_user.company_id