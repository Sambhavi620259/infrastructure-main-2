"""Warn when an organization reaches 90% / 100% of its subscription limits."""
import math

from sqlalchemy.orm import Session

from app.models.models import Asset, Company, PlatformRole, Subscription, User
from app.services.notification_service import notify_company, notify_super_admins


def check_usage_limits(db: Session, company_id: str) -> None:
    """
    Call after adding a user or an asset (before commit). Notifies only when the
    count lands exactly on 90% or 100% of the limit, so each threshold is
    announced once as it is crossed.
    """
    subscription = db.query(Subscription).filter(Subscription.company_id == company_id).first()
    company = db.query(Company).filter(Company.id == company_id).first()
    if not subscription or not company:
        return
    db.flush()
    usage = {
        "users": (db.query(User).filter(User.company_id == company_id, User.status == "ACTIVE").count(), subscription.user_limit),
        "assets": (db.query(Asset).filter(Asset.company_id == company_id).count(), subscription.asset_limit),
    }
    for kind, (count, limit) in usage.items():
        if not limit:
            continue
        if count == limit:
            level = "has reached"
        elif count == math.ceil(limit * 0.9) and count < limit:
            level = "is at 90% of"
        else:
            continue
        title = f"{company.name} {level} its {kind} limit ({count}/{limit})"
        notify_company(
            db, company_id, [PlatformRole.IT_ADMIN], title=title,
            message="Ask the platform administrator to raise the plan limit if you need more.",
            admin_link="/settings", type="WARNING",
        )
        notify_super_admins(db, title, "Adjust the plan under Subscriptions if needed.", "/super-admin/subscriptions", "WARNING")
