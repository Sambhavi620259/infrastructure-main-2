"""Implementation file: app/routers/audit.py"""
from typing import List, Optional, Dict, Any
from datetime import datetime
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status, WebSocket, WebSocketDisconnect
from sqlalchemy.orm import Session
from sqlalchemy import func
from pydantic import BaseModel, ConfigDict

from app.core.database import get_db
from app.core.deps import get_current_user, require_roles, get_tenant_company_id, user_from_token
from app.models.models import AuditSession, AuditScanRecord, Asset, PlatformRole, User
from app.services.audit_service import log_audit_event
from app.services.notification_service import notify_company

router = APIRouter(prefix="/physical-audit", tags=["Physical Inventory Audits"])


# WebSocket connection manager for real-time audit updates
class AuditConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, List[WebSocket]] = {}

    async def connect(self, session_id: str, websocket: WebSocket):
        await websocket.accept()
        if session_id not in self.active_connections:
            self.active_connections[session_id] = []
        self.active_connections[session_id].append(websocket)

    def disconnect(self, session_id: str, websocket: WebSocket):
        if session_id in self.active_connections:
            self.active_connections[session_id].remove(websocket)
            if not self.active_connections[session_id]:
                del self.active_connections[session_id]

    async def broadcast_to_session(self, session_id: str, message: dict):
        if session_id in self.active_connections:
            disconnected = []
            for connection in self.active_connections[session_id]:
                try:
                    await connection.send_json(message)
                except:
                    disconnected.append(connection)
            for conn in disconnected:
                self.disconnect(session_id, conn)


audit_manager = AuditConnectionManager()


@router.websocket("/ws/{session_id}")
async def audit_websocket(
    websocket: WebSocket,
    session_id: str,
    token: Optional[str] = Query(None),
    db: Session = Depends(get_db)
):
    """
    WebSocket endpoint for real-time audit scan updates.
    Browsers cannot set headers on a WebSocket, so the JWT comes as ?token=.
    """
    user = user_from_token(token, db)
    if user is None:
        await websocket.accept()  # so the browser receives the close code
        await websocket.close(code=4401, reason="Not authenticated")
        return

    sess = db.query(AuditSession).filter(AuditSession.id == session_id).first()
    if not sess or (user.role != PlatformRole.SUPER_ADMIN and sess.company_id != user.company_id):
        await websocket.accept()  # so the browser receives the close code
        await websocket.close(code=4004, reason="Session not found")
        return

    await audit_manager.connect(session_id, websocket)
    try:
        while True:
            data = await websocket.receive_text()
            await websocket.send_text(f"pong: {data}")
    except WebSocketDisconnect:
        audit_manager.disconnect(session_id, websocket)


# Helper to broadcast scan updates
async def broadcast_scan_update(session_id: str, scan_data: dict):
    """Call this after scan to notify WebSocket clients."""
    await audit_manager.broadcast_to_session(session_id, {
        "event": "SCAN_UPDATE",
        "scan": scan_data,
        "timestamp": datetime.utcnow().isoformat()
    })


class AuditSessionCreate(BaseModel):
    title: str
    location_id: Optional[str] = None

class ScanRecordRequest(BaseModel):
    asset_tag: str
    scanned_location: Optional[str] = None

class AuditSessionResponse(BaseModel):
    id: str
    company_id: str
    title: str
    location_id: Optional[str]
    status: str
    started_by: str
    started_at: datetime
    completed_at: Optional[datetime]
    verified_count: int
    exception_count: int

    model_config = ConfigDict(from_attributes=True)


class ScanRecordResponse(BaseModel):
    id: str
    audit_session_id: str
    asset_id: Optional[str]
    scanned_tag: str
    is_verified: bool
    scanned_by: str
    scanned_at: datetime

    model_config = ConfigDict(from_attributes=True)


def _get_session(db: Session, session_id: str, current_user: User, tenant_company_id: Optional[str]) -> AuditSession:
    """Fetch a session the caller may see; Super Admin is not tenant-scoped."""
    query = db.query(AuditSession).filter(AuditSession.id == session_id)
    if current_user.role != PlatformRole.SUPER_ADMIN:
        query = query.filter(AuditSession.company_id == (tenant_company_id or current_user.company_id))
    sess = query.first()
    if not sess:
        raise HTTPException(status_code=404, detail="Audit session not found.")
    return sess


def _scan_counts(db: Session, session_ids: List[str]) -> Dict[str, Dict[bool, int]]:
    """Map session id -> {is_verified: count} in one grouped query."""
    if not session_ids:
        return {}
    rows = (
        db.query(AuditScanRecord.audit_session_id, AuditScanRecord.is_verified, func.count())
        .filter(AuditScanRecord.audit_session_id.in_(session_ids))
        .group_by(AuditScanRecord.audit_session_id, AuditScanRecord.is_verified)
        .all()
    )
    counts: Dict[str, Dict[bool, int]] = {}
    for session_id, is_verified, count in rows:
        counts.setdefault(session_id, {})[bool(is_verified)] = count
    return counts


def _session_response(sess: AuditSession, counts: Dict[bool, int]) -> AuditSessionResponse:
    return AuditSessionResponse(
        id=sess.id,
        company_id=sess.company_id,
        title=sess.title,
        location_id=sess.location_id,
        status=sess.status,
        started_by=sess.started_by,
        started_at=sess.started_at,
        completed_at=sess.completed_at,
        verified_count=counts.get(True, 0),
        exception_count=counts.get(False, 0),
    )


@router.get("/sessions", response_model=List[AuditSessionResponse])
def list_audit_sessions(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id)
):
    """
    List all physical audit sessions for the tenant.
    """
    company_id = tenant_company_id or current_user.company_id
    if not company_id and current_user.role != PlatformRole.SUPER_ADMIN:
        raise HTTPException(status_code=400, detail="Company context required.")

    query = db.query(AuditSession)
    if current_user.role != PlatformRole.SUPER_ADMIN:
        query = query.filter(AuditSession.company_id == company_id)

    sessions = query.order_by(AuditSession.started_at.desc()).all()
    counts = _scan_counts(db, [sess.id for sess in sessions])
    return [_session_response(sess, counts.get(sess.id, {})) for sess in sessions]


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


@router.get("/sessions/{session_id}", response_model=AuditSessionResponse)
def get_audit_session(
    session_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id)
):
    """
    Retrieve one audit session with its verified/exception counts.
    """
    sess = _get_session(db, session_id, current_user, tenant_company_id)
    return _session_response(sess, _scan_counts(db, [sess.id]).get(sess.id, {}))


@router.get("/sessions/{session_id}/scans", response_model=List[ScanRecordResponse])
def list_session_scans(
    session_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id)
):
    """
    List the scans recorded in an audit session, newest first.
    """
    sess = _get_session(db, session_id, current_user, tenant_company_id)
    return (
        db.query(AuditScanRecord)
        .filter(AuditScanRecord.audit_session_id == sess.id)
        .order_by(AuditScanRecord.scanned_at.desc())
        .all()
    )


@router.post("/sessions/{session_id}/complete", response_model=AuditSessionResponse)
def complete_audit_session(
    session_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles([PlatformRole.SUPER_ADMIN, PlatformRole.IT_ADMIN])),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id)
):
    """
    Mark an audit session as completed.
    """
    sess = _get_session(db, session_id, current_user, tenant_company_id)

    if sess.status != "IN_PROGRESS":
        raise HTTPException(status_code=400, detail="Only in-progress sessions can be completed.")

    sess.status = "COMPLETED"
    sess.completed_at = datetime.utcnow()
    counts = _scan_counts(db, [sess.id]).get(sess.id, {})
    notify_company(
        db, sess.company_id, [PlatformRole.IT_ADMIN, PlatformRole.SUB_ADMIN],
        title=f"Audit completed: {sess.title}",
        message=f"{counts.get(True, 0)} verified, {counts.get(False, 0)} exception(s).",
        admin_link=f"/assets/audit/{sess.id}", exclude_user_id=current_user.id,
        type="WARNING" if counts.get(False, 0) else "SUCCESS",
    )
    db.commit()
    db.refresh(sess)

    return _session_response(sess, _scan_counts(db, [sess.id]).get(sess.id, {}))


@router.post("/sessions/{session_id}/scan")
def scan_asset_qr(
    session_id: str,
    scan_in: ScanRecordRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id)
):
    """
    Record an asset QR/barcode scan during an active physical audit session.
    """
    sess = _get_session(db, session_id, current_user, tenant_company_id)
    if sess.status != "IN_PROGRESS":
        raise HTTPException(status_code=400, detail="Active audit session not found.")

    asset = db.query(Asset).filter(
        Asset.company_id == sess.company_id,
        # Untagged devices are scanned by their serial number.
        (Asset.asset_tag == scan_in.asset_tag) | (Asset.serial_number == scan_in.asset_tag)
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
    db.refresh(record)

    # Broadcast real-time update
    scan_dict = {
        "id": record.id,
        "audit_session_id": record.audit_session_id,
        "asset_id": record.asset_id,
        "scanned_tag": record.scanned_tag,
        "is_verified": record.is_verified,
        "scanned_by": record.scanned_by,
        "scanned_at": record.scanned_at.isoformat() if record.scanned_at else None,
        "asset_name": asset.name if asset else None,
        "asset_category": asset.category if asset else None,
    }
    # Sync endpoint runs in a worker thread with no event loop, so hand the
    # broadcast to BackgroundTasks rather than asyncio.create_task.
    background_tasks.add_task(broadcast_scan_update, session_id, scan_dict)

    return {
        "status": "VERIFIED" if asset else "UNRECOGNIZED_TAG",
        "asset_id": asset.id if asset else None
    }