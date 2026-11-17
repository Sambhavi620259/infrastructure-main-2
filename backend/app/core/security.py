"""Implementation file: app/core/security.py"""
import hashlib
import hmac
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


def password_fingerprint(hashed_password: Optional[str]) -> str:
    """
    A short value that changes whenever the user's password does. A token carries
    it, so every token issued before a password change or reset stops working.
    """
    return hmac.new(settings.SECRET_KEY.encode(), (hashed_password or "").encode(), hashlib.sha256).hexdigest()[:24]


def issue_token(user, expires_delta: Optional[timedelta] = None) -> str:
    """The access token for a signed-in user, bound to their current password."""
    return create_access_token(
        data={
            "sub": user.id,
            "role": user.role.value,
            "company_id": user.company_id,
            "pv": password_fingerprint(user.hashed_password),
        },
        expires_delta=expires_delta,
    )


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