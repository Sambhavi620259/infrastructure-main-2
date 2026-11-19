"""Implementation file: app/core/deps.py"""
from typing import List, Optional
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from sqlalchemy.orm import Session, joinedload

from app.core.config import settings
from app.core.database import get_db
from app.core.permissions import reporting_user_may_read
from app.core.security import password_fingerprint
from app.models.models import User, PlatformRole

oauth2_scheme = OAuth2PasswordBearer(
    tokenUrl=f"{settings.API_V1_STR}/auth/login"
)


def user_from_token(token: Optional[str], db: Session) -> Optional[User]:
    """
    Resolve a JWT access token to its active user, or None if the token is
    missing, invalid, expired, or belongs to an inactive account.
    """
    if not token:
        return None
    try:
        payload = jwt.decode(
            token,
            settings.SECRET_KEY,
            algorithms=[settings.ALGORITHM]
        )
    except JWTError:
        return None
    user_id = payload.get("sub")
    if user_id is None:
        return None

    # Load the company with the user: organization_suspended() reads it on every request.
    user = db.query(User).options(joinedload(User.company)).filter(User.id == user_id).first()
    if not user or user.status != "ACTIVE" or organization_suspended(user):
        return None
    # Tokens issued before the last password change/reset (or without the
    # claim) are no longer valid.
    if payload.get("pwf") != password_fingerprint(user.hashed_password):
        return None
    return user


def organization_suspended(user: User) -> bool:
    """A Super Admin can suspend an organization; its users are then locked out."""
    return user.role != PlatformRole.SUPER_ADMIN and user.company is not None and user.company.status != "ACTIVE"


def get_current_user(
    request: Request,
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db)
) -> User:
    """
    Validates JWT access token, verifies session integrity, and fetches active user context.
    """
    user = user_from_token(token, db)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )
    # A Reporting user reads reports plus only the modules assigned to them.
    if user.role == PlatformRole.REPORTING_USER and not reporting_user_may_read(user, request.url.path):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Your Reporting account does not include access to this data.",
        )
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


def profile_role(role: PlatformRole) -> str:
    """Role name the frontend uses: IT Agents are stored as EMPLOYEE."""
    return "IT_AGENT" if role == PlatformRole.EMPLOYEE else role.value


# --- WebSocket authentication -------------------------------------------------

WS_MAX_MESSAGE_CHARS = 1024
WS_MAX_CONNECTIONS_PER_USER = 10
_ws_open: dict = {}


def ws_origin_allowed(origin: Optional[str]) -> bool:
    """Browsers always send Origin on a WebSocket. Reject pages from other sites
    (cross-site WebSocket hijacking); clients that send no Origin are not browsers."""
    if not origin:
        return True
    return origin.rstrip("/") in {o.rstrip("/") for o in settings.CORS_ORIGINS}


def ws_authenticate(websocket, token: Optional[str], authorize=None):
    """
    Authenticate a WebSocket and run an optional ``authorize(db, user) -> close
    code or None`` check. Uses a short-lived DB session that is closed before
    returning, so an idle socket never holds a pooled connection.

    Returns (user_id, None) on success or (None, (close_code, reason)).
    """
    if not ws_origin_allowed(websocket.headers.get("origin")):
        return None, (4403, "Origin not allowed")
    source = websocket.app.dependency_overrides.get(get_db, get_db)()
    db = next(source)
    try:
        user = user_from_token(token, db)
        if user is None:
            return None, (4401, "Not authenticated")
        if authorize is not None:
            failure = authorize(db, user)
            if failure:
                return None, failure
        user_id = user.id
    finally:
        source.close()
    if _ws_open.get(user_id, 0) >= WS_MAX_CONNECTIONS_PER_USER:
        return None, (4429, "Too many open connections")
    _ws_open[user_id] = _ws_open.get(user_id, 0) + 1
    return user_id, None


def ws_release(user_id: str) -> None:
    remaining = _ws_open.get(user_id, 0) - 1
    if remaining > 0:
        _ws_open[user_id] = remaining
    else:
        _ws_open.pop(user_id, None)
