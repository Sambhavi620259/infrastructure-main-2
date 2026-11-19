"""Implementation file: app/core/security.py"""
import hashlib
from datetime import datetime, timedelta
from typing import Optional, Any, Union
from jose import jwt
from passlib.context import CryptContext
from app.core.config import settings

# Password hashing configuration
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """
    Verify a plain text password against a stored bcrypt hash.
    """
    return pwd_context.verify(plain_password, hashed_password)


def get_password_hash(password: str) -> str:
    """
    Generate a bcrypt hash from a plain text password.
    """
    return pwd_context.hash(password)


def create_access_token(
    data: dict, 
    expires_delta: Optional[timedelta] = None
) -> str:
    """
    Generate a signed JWT access token containing standard and custom claims.
    """
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
        
    to_encode.update({"exp": expire, "iat": datetime.utcnow()})
    encoded_jwt = jwt.encode(
        to_encode, 
        settings.SECRET_KEY, 
        algorithm=settings.ALGORITHM
    )
    return encoded_jwt


def password_fingerprint(hashed_password: str) -> str:
    """
    Short digest of the stored password hash. It is embedded in access tokens
    (claim "pwf") and re-checked on every request, so changing or resetting a
    password invalidates every token issued before it. No schema change needed.
    """
    return hashlib.sha256(hashed_password.encode("utf-8")).hexdigest()[:16]


def token_claims(user) -> dict:
    """Claims placed in an access token for ``user``."""
    return {
        "sub": user.id,
        "role": user.role.value,
        "company_id": user.company_id,
        "pwf": password_fingerprint(user.hashed_password),
    }
