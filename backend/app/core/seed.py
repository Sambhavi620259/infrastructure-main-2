"""Implementation file: app/core/seed.py"""
import logging

from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import SessionLocal
from app.core.security import get_password_hash
from app.models.models import User, PlatformRole

logger = logging.getLogger(__name__)


def seed_initial_users():
    """
    Create the first Super Admin from environment settings, if configured.

    Re-raises on failure. A server that has not seeded its only administrator
    account has not started successfully, and must not report that it has.
    """
    db: Session = SessionLocal()
    try:
        super_admin = db.query(User).filter(User.role == PlatformRole.SUPER_ADMIN).first()
        if super_admin:
            logger.info("Super Admin already exists; skipping seed.")
            return

        if not (settings.SEED_SUPER_ADMIN_EMAIL and settings.SEED_SUPER_ADMIN_PASSWORD):
            logger.info(
                "No Super Admin yet. Register one at /register (Super Admin), or set "
                "SEED_SUPER_ADMIN_EMAIL and SEED_SUPER_ADMIN_PASSWORD."
            )
            return
        if len(settings.SEED_SUPER_ADMIN_PASSWORD) < 12:
            raise RuntimeError("SEED_SUPER_ADMIN_PASSWORD must be at least 12 characters.")

        logger.info("Seeding the first Super Admin from SEED_SUPER_ADMIN_EMAIL\u2026")
        admin_user = User(
            email=settings.SEED_SUPER_ADMIN_EMAIL.strip().lower(),
            hashed_password=get_password_hash(settings.SEED_SUPER_ADMIN_PASSWORD),
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
