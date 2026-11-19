"""Daily check: tell admins about warranties ending within 30 days (once per asset and end date)."""
import asyncio
import logging
from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from app.core.database import SessionLocal
from app.models.models import Asset, PlatformRole, User
from app.services.notification_service import already_notified, notify

logger = logging.getLogger(__name__)

WARN_DAYS = 30
CHECK_INTERVAL_SECONDS = 24 * 60 * 60


def run_warranty_alerts(db: Session) -> int:
    """Create the due warranty notifications. Returns how many were created."""
    now = datetime.utcnow()
    expiring = (
        db.query(Asset)
        .filter(Asset.warranty_end.isnot(None), Asset.warranty_end >= now, Asset.warranty_end <= now + timedelta(days=WARN_DAYS))
        .all()
    )
    admins_by_company: dict = {}
    created = 0
    for asset in expiring:
        admins = admins_by_company.setdefault(
            asset.company_id,
            db.query(User).filter(
                User.company_id == asset.company_id,
                User.role.in_([PlatformRole.IT_ADMIN, PlatformRole.SUB_ADMIN]),
                User.status == "ACTIVE",
            ).all(),
        )
        title = f"Warranty for {asset.asset_tag} ends on {asset.warranty_end:%d %b %Y}"
        days = (asset.warranty_end - now).days
        for admin in admins:
            if already_notified(db, admin.id, title):
                continue
            notify(db, admin, title, f"{asset.name}: {days} day(s) left.", "/assets/warranty", "WARNING")
            created += 1
    db.commit()
    return created


def _run_once() -> int:
    db = SessionLocal()
    try:
        return run_warranty_alerts(db)
    finally:
        db.close()


async def warranty_alert_loop() -> None:
    """Background task started with the API: run now, then once a day."""
    while True:
        try:
            created = await asyncio.to_thread(_run_once)
            if created:
                logger.info("Warranty alerts created: %s", created)
        except Exception:
            logger.exception("Warranty alert check failed")
        await asyncio.sleep(CHECK_INTERVAL_SECONDS)
