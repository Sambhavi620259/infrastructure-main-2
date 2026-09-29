"""Implementation file: app/routers/audit.py"""
from typing import List, Optional, Dict, Any
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from pydantic import BaseModel

from app.core.database import get_db
from app.core.deps import get_current_user, require_roles, get_tenant_company_id
from app.models.models import AuditSession, AuditScanRecord, Asset, PlatformRole, User
from app.services.audit_service import log_audit_event

router = APIRouter(prefix="/physical-audit", tags=["Physical Inventory Audits"])


class AuditSessionCreate(BaseModel):
    title: str
    location_id: Optional[str] = None

class ScanRecordRequest(BaseModel):
    asset_tag: str
    scanned_location: Optional[str] = None


@router.post("/sessions", status_code=status.HTTP_201_CREATED)
def start_physical_audit_session(
    session_in: AuditSessionCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles([PlatformRole.SUPER_ADMIN, PlatformRole.IT_ADMIN])),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id)
):
    """
    Initiate a physical floor inventory scan session.
    """
    company_id = tenant_company_id or current_user.company_id
    if not company_id:
        raise HTTPException(status_code=400, detail="Company context required.")

    audit_sess = AuditSession(
        company_id=company_id,
        title=session_in.title,
        location_id=session_in.location_id,
        started_by=current_user.id,
        status="IN_PROGRESS"
    )
    db.add(audit_sess)
    db.commit()
    db.refresh(audit_sess)

    return {"message": "Physical audit session started.", "session_id": audit_sess.id}


@router.post("/sessions/{session_id}/scan")
def scan_asset_qr(
    session_id: str,
    scan_in: ScanRecordRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id)
):
    """
    Record an asset QR/barcode scan during an active physical audit session.
    """
    company_id = tenant_company_id or current_user.company_id

    sess = db.query(AuditSession).filter(
        AuditSession.id == session_id,
        AuditSession.company_id == company_id
    ).first()

    if not sess or sess.status != "IN_PROGRESS":
        raise HTTPException(status_code=400, detail="Active audit session not found.")

    asset = db.query(Asset).filter(
        Asset.company_id == company_id,
        Asset.asset_tag == scan_in.asset_tag
    ).first()

    record = AuditScanRecord(
        audit_session_id=sess.id,
        asset_id=asset.id if asset else None,
        scanned_tag=scan_in.asset_tag,
        is_verified=True if asset else False,
        scanned_by=current_user.id
    )
    db.add(record)
    db.commit()

    return {
        "status": "VERIFIED" if asset else "UNRECOGNIZED_TAG",
        "asset_id": asset.id if asset else None
    }