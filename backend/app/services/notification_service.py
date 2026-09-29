from typing import Optional, List
from sqlalchemy.orm import Session

from app.models.models import Notification, User, PlatformRole


def create_notification(
    db: Session,
    user_id: str,
    company_id: str,
    title: str,
    message: str,
    type: str = "INFO"
) -> Notification:
    """
    Create and record an in-app notification for a specific user.
    """
    notification = Notification(
        company_id=company_id,
        user_id=user_id,
        title=title,
        message=message,
        type=type,
        is_read=False
    )
    db.add(notification)
    db.commit()
    db.refresh(notification)
    return notification


def notify_company_admins(
    db: Session,
    company_id: str,
    title: str,
    message: str,
    type: str = "ALERT"
) -> List[Notification]:
    """
    Broadcast an in-app notification to all administrative users within a company tenant.
    """
    admins = db.query(User).filter(
        User.company_id == company_id,
        User.role.in_([PlatformRole.IT_ADMIN, PlatformRole.SUB_ADMIN]),
        User.is_active == True
    ).all()

    notifications = []
    for admin in admins:
        n = Notification(
            company_id=company_id,
            user_id=admin.id,
            title=title,
            message=message,
            type=type,
            is_read=False
        )
        db.add(n)
        notifications.append(n)

    db.commit()
    return notifications