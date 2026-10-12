"""
The Super Admin key: chosen by the first Super Admin at registration and
required for every later Super Admin registration. Only a bcrypt hash is stored.
"""
from datetime import datetime
from typing import Optional

from sqlalchemy.orm import Session

from app.core.security import get_password_hash, verify_password
from app.models.models import PlatformSetting

_KEY_NAME = "super_admin_key_hash"
MIN_KEY_LENGTH = 8


def super_key_exists(db: Session) -> bool:
    return db.query(PlatformSetting.name).filter(PlatformSetting.name == _KEY_NAME).first() is not None


def verify_super_key(db: Session, key: Optional[str]) -> bool:
    row = db.query(PlatformSetting).filter(PlatformSetting.name == _KEY_NAME).first()
    return bool(row and key and verify_password(key, row.value))


def set_super_key(db: Session, key: str, user_id: Optional[str]) -> None:
    """Create or replace the key. The caller commits."""
    row = db.query(PlatformSetting).filter(PlatformSetting.name == _KEY_NAME).first()
    hashed = get_password_hash(key)
    if row:
        row.value = hashed
        row.updated_by = user_id
        row.updated_at = datetime.utcnow()
    else:
        db.add(PlatformSetting(name=_KEY_NAME, value=hashed, updated_by=user_id))
