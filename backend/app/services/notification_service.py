"""
In-app notifications. Helpers only add rows to the session: the caller's
commit saves them together with the change they describe.
"""
from typing import Iterable, Optional

from sqlalchemy.orm import Session

from app.models.models import Notification, PlatformRole, User


def home_link(user: User, admin_path: str, agent_path: str) -> str:
    """Where a notification should open for this user's workspace."""
    return agent_path if user.role == PlatformRole.EMPLOYEE else admin_path


def notify(
    db: Session,
    user: User,
    title: str,
    message: Optional[str] = None,
    link: Optional[str] = None,
    type: str = "INFO",
) -> None:
    db.add(Notification(
        company_id=user.company_id,
        user_id=user.id,
        title=title[:200],
        message=message,
        link=link,
        type=type,
        is_read=False,
    ))


def notify_company(
    db: Session,
    company_id: str,
    roles: Iterable[PlatformRole],
    title: str,
    message: Optional[str] = None,
    admin_link: Optional[str] = None,
    agent_link: Optional[str] = None,
    exclude_user_id: Optional[str] = None,
    type: str = "INFO",
) -> None:
    """Notify every active user in the organization with one of the roles."""
    users = db.query(User).filter(
        User.company_id == company_id,
        User.role.in_(list(roles)),
        User.status == "ACTIVE",
    ).all()
    for user in users:
        if user.id == exclude_user_id:
            continue
        link = home_link(user, admin_link, agent_link) if admin_link or agent_link else None
        notify(db, user, title, message, link, type)


def notify_super_admins(
    db: Session,
    title: str,
    message: Optional[str] = None,
    link: Optional[str] = None,
    type: str = "INFO",
    exclude_user_id: Optional[str] = None,
) -> None:
    for admin in db.query(User).filter(User.role == PlatformRole.SUPER_ADMIN, User.status == "ACTIVE").all():
        if admin.id != exclude_user_id:
            notify(db, admin, title, message, link, type)


def already_notified(db: Session, user_id: str, title: str) -> bool:
    """True if this user already has a notification with exactly this title (de-duplication)."""
    return db.query(Notification.id).filter(Notification.user_id == user_id, Notification.title == title).first() is not None
