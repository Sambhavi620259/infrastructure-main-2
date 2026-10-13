"""Software seats: assigning and releasing license seats safely.

A product (Software) has license entitlements (SoftwareLicense, each with a
seat count). A seat given to a user is a SoftwareLicenseAssignment; releasing
it keeps the row (is_active = False) as history. Available seats are always
computed from active assignments, never typed in.
"""
from datetime import datetime
from typing import Dict, Optional

from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.models import Asset, Software, SoftwareLicense, SoftwareLicenseAssignment, User


def mask_license_number(number: Optional[str]) -> Optional[str]:
    """Show only the last four characters, e.g. '••••-7Q2X'."""
    if not number:
        return None
    return "••••" + (f"-{number[-4:]}" if len(number) > 4 else "")


def active_seats(db: Session, license_ids) -> Dict[str, int]:
    """License id -> seats in use."""
    ids = list(license_ids)
    if not ids:
        return {}
    rows = (
        db.query(SoftwareLicenseAssignment.license_id, func.count())
        .filter(SoftwareLicenseAssignment.license_id.in_(ids), SoftwareLicenseAssignment.is_active.is_(True))
        .group_by(SoftwareLicenseAssignment.license_id)
        .all()
    )
    return {license_id: count for license_id, count in rows}


def sync_totals(db: Session, software: Software) -> None:
    """Keep the product's summary columns equal to its licenses and active seats."""
    db.flush()
    licenses = db.query(SoftwareLicense).filter(
        SoftwareLicense.software_id == software.id, SoftwareLicense.status == "ACTIVE"
    ).all()
    software.total_licenses = sum(l.seats for l in licenses)
    software.used_licenses = db.query(SoftwareLicenseAssignment).filter(
        SoftwareLicenseAssignment.software_id == software.id, SoftwareLicenseAssignment.is_active.is_(True)
    ).count()
    software.cost = sum((l.cost or 0) for l in licenses)
    expiries = [l.expiry_date for l in licenses if l.expiry_date]
    software.expiry_date = min(expiries) if expiries else None
    if licenses:
        software.license_type = licenses[0].license_type


def assign_seat(db: Session, software: Software, user: User, actor: User,
                license_id: Optional[str] = None, asset_id: Optional[str] = None) -> SoftwareLicenseAssignment:
    """
    Give `user` one seat of `software`. Locks the license row and re-checks
    availability, so two requests cannot take the last seat. Picks the first
    active, unexpired license with a free seat unless `license_id` is given.
    The caller commits.
    """
    if user.company_id != software.company_id or user.status != "ACTIVE":
        raise HTTPException(status_code=404, detail="That user is not an active member of this organization.")
    already = db.query(SoftwareLicenseAssignment.id).filter(
        SoftwareLicenseAssignment.software_id == software.id,
        SoftwareLicenseAssignment.user_id == user.id,
        SoftwareLicenseAssignment.is_active.is_(True),
    ).first()
    if already:
        raise HTTPException(status_code=400, detail=f"{user.full_name} already has a seat of {software.name}.")
    if asset_id and not db.query(Asset.id).filter(Asset.id == asset_id, Asset.company_id == software.company_id).first():
        raise HTTPException(status_code=400, detail="Unknown device.")

    now = datetime.utcnow()
    query = db.query(SoftwareLicense).filter(
        SoftwareLicense.software_id == software.id, SoftwareLicense.status == "ACTIVE"
    )
    if license_id:
        query = query.filter(SoftwareLicense.id == license_id)
    licenses = query.order_by(SoftwareLicense.created_at).with_for_update().all()
    if license_id and not licenses:
        raise HTTPException(status_code=404, detail="License not found for this software.")
    used = active_seats(db, [l.id for l in licenses])
    chosen = next(
        (l for l in licenses if used.get(l.id, 0) < l.seats and (l.expiry_date is None or l.expiry_date >= now)),
        None,
    )
    if chosen is None:
        raise HTTPException(status_code=400, detail=f"No seats of {software.name} are available. Add or renew a license first.")

    assignment = SoftwareLicenseAssignment(
        company_id=software.company_id, software_id=software.id, license_id=chosen.id,
        user_id=user.id, asset_id=asset_id, assigned_by=actor.id, is_active=True,
    )
    db.add(assignment)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="That seat was just assigned by someone else. Try again.")
    sync_totals(db, software)
    return assignment


def release_seat(db: Session, assignment: SoftwareLicenseAssignment, actor: User) -> None:
    """Close a seat assignment; the seat becomes available again. The caller commits."""
    if not assignment.is_active:
        raise HTTPException(status_code=400, detail="This seat has already been released.")
    assignment.is_active = False
    assignment.released_at = datetime.utcnow()
    assignment.released_by = actor.id
    software = db.query(Software).filter(Software.id == assignment.software_id).first()
    if software:
        sync_totals(db, software)
