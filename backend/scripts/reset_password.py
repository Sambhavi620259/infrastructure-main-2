"""
Set a new password for one account, from the server. This is the way back in for a
Super Admin who forgot their password (there is no email service), and it needs
access to the database, like the rest of the backend.

    cd backend
    .venv/bin/python scripts/reset_password.py someone@example.com

The new password is asked for without echoing. Signing in again is required
everywhere: tokens issued under the old password stop working.
"""
import getpass
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

from sqlalchemy import func  # noqa: E402

from app.core.database import SessionLocal  # noqa: E402
from app.core.security import get_password_hash  # noqa: E402
from app.models.models import User  # noqa: E402
from app.schemas.schemas import check_password_length  # noqa: E402
from app.services.audit_service import log_audit_event  # noqa: E402


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__)
        return 2
    email = sys.argv[1].strip().lower()
    db = SessionLocal()
    try:
        user = db.query(User).filter(func.lower(User.email) == email).first()
        if not user:
            print(f"No account with the email {email}.")
            return 1
        password = getpass.getpass("New password (8-72 characters): ")
        if len(password) < 8 or password != getpass.getpass("Repeat it: "):
            print("The password must be at least 8 characters and typed the same twice.")
            return 1
        try:
            check_password_length(password)
        except ValueError as error:
            print(error)
            return 1
        user.hashed_password = get_password_hash(password)
        db.commit()
        log_audit_event(db=db, action="PASSWORD_RESET_OFFLINE", entity="User", company_id=user.company_id,
                        user_id=user.id, entity_id=user.id)
        print(f"Password set for {user.email}. They must sign in again.")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
