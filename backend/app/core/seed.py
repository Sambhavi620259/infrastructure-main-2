"""Implementation file: app/core/seed.py"""
import logging

from sqlalchemy.orm import Session

from app.core.database import SessionLocal
from app.core.security import get_password_hash
from app.models.models import User, PlatformRole

logger = logging.getLogger(__name__)


def seed_initial_users():
    """
    Ensure a Super Admin account exists.

    Re-raises on failure. A server that has not seeded its only administrator
    account has not started successfully, and must not report that it has.
    """
    db: Session = SessionLocal()
    try:
        super_admin = db.query(User).filter(User.role == PlatformRole.SUPER_ADMIN).first()
        if super_admin:
            logger.info("Super Admin already exists; skipping seed.")
            return

        logger.info("Seeding default Super Admin\u2026")
        admin_user = User(
            email="superadmin@boldandwise.com",
            hashed_password=get_password_hash("AdminPassword123!"),
            full_name="Super Administrator",
            role=PlatformRole.SUPER_ADMIN,
            status="ACTIVE",
        )
        db.add(admin_user)
        db.commit()
        logger.info("Super Admin created successfully.")
    except Exception:
        db.rollback()
        logger.exception("Failed to seed the initial Super Admin account.")
        raise
    finally:
        db.close()


if __name__ == "__main__":
    from app.core.logging_config import configure_logging

    configure_logging()
    seed_initial_users()
