"""Implementation file: app/routers/reports.py"""
import json
import re
from datetime import datetime
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import ValidationError
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_tenant_company_id, require_roles
from app.models.models import PlatformRole, ReportConfig, ReportRun, User
from app.schemas.schemas import (
    ReportConfigResponse, ReportRunCreate, ReportRunResponse, ReportSummaryResponse, ReportTypeResponse,
)
from app.services.audit_service import log_audit_event
from app.services.report_service import REPORT_TYPES, ReportFilters, render_csv

router = APIRouter(prefix="/reports", tags=["Reporting & Analytics"])

# IT Agents (stored as EMPLOYEE) generate operational reports too.
_report_users = require_roles([
    PlatformRole.SUPER_ADMIN, PlatformRole.IT_ADMIN, PlatformRole.SUB_ADMIN, PlatformRole.REPORTING_USER,
    PlatformRole.EMPLOYEE,
])


def _company(current_user: User, tenant_company_id: Optional[str]) -> str:
    """Reports are always for one company; a Super Admin needs one on their account."""
    company_id = tenant_company_id or current_user.company_id
    if not company_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Company context required for reports.")
    return company_id


def _parse_filters(report_type: str, raw: Dict) -> ReportFilters:
    """Keep only the filters this report type uses, then validate them."""
    allowed = REPORT_TYPES[report_type].filters
    relevant = {key: value for key, value in raw.items() if key in allowed and value not in (None, "")}
    try:
        return ReportFilters(**relevant)
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=exc.errors(include_url=False)) from exc


def _filters_dict(filters: ReportFilters) -> Dict:
    return json.loads(filters.model_dump_json(exclude_none=True, exclude_defaults=True))


def _run_response(run: ReportRun, generated_by_name: Optional[str]) -> ReportRunResponse:
    return ReportRunResponse(
        id=run.id,
        name=run.name,
        report_type=run.report_type,
        report_config_id=run.report_config_id,
        filters=json.loads(run.filters_json or "{}"),
        format=run.format,
        row_count=run.row_count,
        generated_by=run.generated_by,
        generated_by_name=generated_by_name,
        created_at=run.created_at,
    )


def _generate(
    db: Session,
    company_id: str,
    user: User,
    report_type: str,
    name: str,
    filters: ReportFilters,
    config_id: Optional[str],
) -> ReportRun:
    table = REPORT_TYPES[report_type].build(db, company_id, filters)
    run = ReportRun(
        company_id=company_id,
        report_config_id=config_id,
        name=name,
        report_type=report_type,
        filters_json=json.dumps(_filters_dict(filters)),
        format="CSV",
        row_count=len(table.rows),
        content=render_csv(table),
        generated_by=user.id,
    )
    db.add(run)
    db.commit()
    db.refresh(run)
    log_audit_event(
        db=db,
        action="GENERATE_REPORT",
        entity="ReportRun",
        company_id=company_id,
        user_id=user.id,
        entity_id=run.id,
        new_value=f"{report_type}: {run.row_count} rows",
    )
    return run


@router.get("/types", response_model=List[ReportTypeResponse])
def list_report_types(current_user: User = Depends(_report_users)):
    """Report types and the filters each one accepts."""
    return [
        ReportTypeResponse(key=t.key, label=t.label, description=t.description, filters=list(t.filters))
        for t in REPORT_TYPES.values()
    ]


@router.get("/summary", response_model=ReportSummaryResponse)
def get_report_summary(
    db: Session = Depends(get_db),
    current_user: User = Depends(_report_users),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id),
):
    company_id = _company(current_user, tenant_company_id)
    month_start = datetime.utcnow().replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    runs = db.query(ReportRun).filter(ReportRun.company_id == company_id)
    return ReportSummaryResponse(
        generated_this_month=runs.filter(ReportRun.created_at >= month_start).count(),
        saved_reports=db.query(ReportConfig).filter(ReportConfig.company_id == company_id).count(),
        last_generated_at=db.query(func.max(ReportRun.created_at)).filter(ReportRun.company_id == company_id).scalar(),
    )


@router.post("/runs", response_model=ReportRunResponse, status_code=status.HTTP_201_CREATED)
def create_report(
    run_in: ReportRunCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(_report_users),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id),
):
    """
    Generate a report now. The CSV is stored and listed under recent exports;
    with save=true the settings are also kept as a saved report.
    """
    company_id = _company(current_user, tenant_company_id)
    if run_in.report_type not in REPORT_TYPES:
        raise HTTPException(status_code=400, detail=f"Unknown report type '{run_in.report_type}'.")
    filters = _parse_filters(run_in.report_type, run_in.filters)
    name = (run_in.name or "").strip() or REPORT_TYPES[run_in.report_type].label

    config_id = None
    if run_in.save:
        config = ReportConfig(
            company_id=company_id,
            name=name,
            report_type=run_in.report_type,
            config_json=json.dumps(_filters_dict(filters)),
            created_by=current_user.id,
        )
        db.add(config)
        db.flush()
        config_id = config.id

    run = _generate(db, company_id, current_user, run_in.report_type, name, filters, config_id)
    return _run_response(run, current_user.full_name)


@router.get("/runs", response_model=List[ReportRunResponse])
def list_report_runs(
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: User = Depends(_report_users),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id),
):
    """Recently generated reports, newest first."""
    company_id = _company(current_user, tenant_company_id)
    rows = (
        db.query(ReportRun, User.full_name)
        .outerjoin(User, User.id == ReportRun.generated_by)
        .filter(ReportRun.company_id == company_id)
        .order_by(ReportRun.created_at.desc())
        .limit(limit)
        .all()
    )
    return [_run_response(run, name) for run, name in rows]


@router.get("/runs/{run_id}/download")
def download_report(
    run_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(_report_users),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id),
):
    """The stored CSV for a generated report."""
    company_id = _company(current_user, tenant_company_id)
    run = db.query(ReportRun).filter(ReportRun.id == run_id, ReportRun.company_id == company_id).first()
    if not run:
        raise HTTPException(status_code=404, detail="Report not found.")
    slug = re.sub(r"[^A-Za-z0-9]+", "-", run.name).strip("-").lower() or "report"
    filename = f"{slug}-{run.created_at:%Y-%m-%d}.csv"
    return Response(
        content=run.content,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/saved", response_model=List[ReportConfigResponse])
def list_saved_reports(
    db: Session = Depends(get_db),
    current_user: User = Depends(_report_users),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id),
):
    """Saved report settings, with when each was last generated."""
    company_id = _company(current_user, tenant_company_id)
    last_runs = (
        db.query(ReportRun.report_config_id, func.max(ReportRun.created_at).label("last_run_at"))
        .filter(ReportRun.company_id == company_id, ReportRun.report_config_id.isnot(None))
        .group_by(ReportRun.report_config_id)
        .subquery()
    )
    rows = (
        db.query(ReportConfig, last_runs.c.last_run_at)
        .outerjoin(last_runs, last_runs.c.report_config_id == ReportConfig.id)
        .filter(ReportConfig.company_id == company_id)
        .order_by(ReportConfig.created_at.desc())
        .all()
    )
    return [
        ReportConfigResponse(
            id=config.id,
            name=config.name,
            report_type=config.report_type,
            filters=json.loads(config.config_json or "{}"),
            created_by=config.created_by,
            created_at=config.created_at,
            last_run_at=last_run_at,
        )
        for config, last_run_at in rows
    ]


@router.post("/saved/{config_id}/run", response_model=ReportRunResponse, status_code=status.HTTP_201_CREATED)
def run_saved_report(
    config_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(_report_users),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id),
):
    """Generate a fresh copy of a saved report with its stored settings."""
    company_id = _company(current_user, tenant_company_id)
    config = db.query(ReportConfig).filter(ReportConfig.id == config_id, ReportConfig.company_id == company_id).first()
    if not config:
        raise HTTPException(status_code=404, detail="Saved report not found.")
    if config.report_type not in REPORT_TYPES:
        raise HTTPException(status_code=400, detail=f"Report type '{config.report_type}' is no longer available.")
    filters = _parse_filters(config.report_type, json.loads(config.config_json or "{}"))
    run = _generate(db, company_id, current_user, config.report_type, config.name, filters, config.id)
    return _run_response(run, current_user.full_name)


@router.delete("/saved/{config_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_saved_report(
    config_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(_report_users),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id),
):
    """Delete saved settings. Reports already generated from them are kept."""
    company_id = _company(current_user, tenant_company_id)
    config = db.query(ReportConfig).filter(ReportConfig.id == config_id, ReportConfig.company_id == company_id).first()
    if not config:
        raise HTTPException(status_code=404, detail="Saved report not found.")
    db.query(ReportRun).filter(ReportRun.report_config_id == config.id).update({"report_config_id": None})
    db.delete(config)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
