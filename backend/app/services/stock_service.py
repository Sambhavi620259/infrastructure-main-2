"""Stock movement ledger.

Every receipt, registration, assignment, return, transfer, issue and
adjustment is recorded as a StockMovement. A client-supplied `reference`
(unique per organization) makes a submit safe to retry: the same movement is
never recorded twice.
"""
from typing import Optional

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.models import StockMovement

MOVEMENT_TYPES = ("RECEIPT", "REGISTER", "ASSIGN", "RETURN", "TRANSFER", "ISSUE", "ADJUSTMENT", "REPAIR", "RETIRE")


def ensure_new_reference(db: Session, company_id: str, reference: Optional[str]) -> None:
    """409 if this reference was already used, i.e. the same submit arrived twice."""
    if reference and db.query(StockMovement.id).filter(
        StockMovement.company_id == company_id, StockMovement.reference == reference
    ).first():
        raise HTTPException(status_code=409, detail="This stock movement was already recorded.")


def record_movement(db: Session, company_id: str, movement_type: str, item_kind: str, performed_by: Optional[str],
                    quantity: int = 1, reference: Optional[str] = None, **fields) -> StockMovement:
    """Add a movement to the session (the caller commits, together with the change it records)."""
    ensure_new_reference(db, company_id, reference)
    movement = StockMovement(
        company_id=company_id, movement_type=movement_type, item_kind=item_kind, quantity=quantity,
        reference=reference or None, performed_by=performed_by, **fields,
    )
    db.add(movement)
    return movement
