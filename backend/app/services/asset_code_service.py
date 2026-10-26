"""Asset IDs: AST-000001, AST-000002, ... unique within an organization, never reused.

The asset number (tag) is what people write on the device and may repeat; the
Asset ID is what the system uses to tell two such devices apart.
"""
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.models import Asset, Company

PREFIX = "AST-"


def next_asset_code(db: Session, company_id: str) -> str:
    # Serialise creators of the same organization so two never take the same number.
    db.query(Company.id).filter(Company.id == company_id).with_for_update().first()
    top = 0
    for (code,) in db.query(Asset.asset_code).filter(Asset.company_id == company_id).all():
        if code and code.startswith(PREFIX) and code[len(PREFIX):].isdigit():
            top = max(top, int(code[len(PREFIX):]))
    return f"{PREFIX}{top + 1:06d}"
