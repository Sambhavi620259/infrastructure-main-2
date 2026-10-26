"""Daily check: tell admins about warranties ending within 30 days (once per asset and end date)."""
import asyncio
import logging
from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from app.core.database import SessionLocal
from app.models.models import Asset, PlatformRole, Software, SoftwareLicense, User
from app.services.access_service import expire_access_grants
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
        title = f"Warranty for {asset.label} ends on {asset.warranty_end:%d %b %Y}"
        days = (asset.warranty_end - now).days
        for admin in admins:
            if already_notified(db, admin.id, title):
                continue
            notify(db, admin, title, f"{asset.name}: {days} day(s) left.", "/assets/warranty", "WARNING")
            created += 1

    # Software licenses expiring or due for renewal (once per license and date).
    licenses = (
        db.query(SoftwareLicense, Software.name)
        .join(Software, Software.id == SoftwareLicense.software_id)
        .filter(SoftwareLicense.status == "ACTIVE", SoftwareLicense.expiry_date.isnot(None),
                SoftwareLicense.expiry_date >= now, SoftwareLicense.expiry_date <= now + timedelta(days=WARN_DAYS))
        .all()
    )
    for item, product in licenses:
        admins = admins_by_company.setdefault(
            item.company_id,
            db.query(User).filter(
                User.company_id == item.company_id,
                User.role.in_([PlatformRole.IT_ADMIN, PlatformRole.SUB_ADMIN]),
                User.status == "ACTIVE",
            ).all(),
        )
        title = f"{product} license ({item.seats} seats) expires on {item.expiry_date:%d %b %Y}"
        for admin in admins:
            if already_notified(db, admin.id, title):
                continue
            notify(db, admin, title, f"{(item.expiry_date - now).days} day(s) left. Renew it under Software Assets.",
                   "/assets/software", "WARNING")
            created += 1
    # Access grants past their end date are ended (and the user told).
    created += expire_access_grants(db)
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
