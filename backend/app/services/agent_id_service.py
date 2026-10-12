from sqlalchemy.orm import Session

from app.models.models import InvitationToken, User

_NAME_LENGTH = 20


def new_agent_id(db: Session, full_name: str) -> str:
    """RAHULSHARMA01, RAHULSHARMA02, ... unique across users (and older invitations)."""
    base = "".join(ch for ch in full_name.upper() if ch.isalnum())[:_NAME_LENGTH] or "AGENT"
    taken = {
        row[0]
        for model in (InvitationToken, User)
        for row in db.query(model.agent_id).filter(model.agent_id.like(f"{base}%")).all()
    }
    number = 1
    while f"{base}{number:02d}" in taken:
        number += 1
    return f"{base}{number:02d}"
