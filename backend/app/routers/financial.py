"""Implementation file: app/routers/financial.py"""
from typing import Dict, Any, List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import func

from app.core.database import get_db
from app.core.deps import get_current_user, require_roles, get_tenant_company_id
from app.models.models import Asset, Department, PlatformRole, User
from app.services.audit_service import log_audit_event

router = APIRouter(prefix="/financial", tags=["Financial Analytics & Budgeting"])


@router.get("/summary", response_model=Dict[str, Any])
def get_financial_summary(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles([PlatformRole.SUPER_ADMIN, PlatformRole.IT_ADMIN, PlatformRole.SUB_ADMIN])),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id)
):
    """
    Retrieve financial overview including total asset expenditure, accumulated depreciation, and net book value.
    """
    company_id = tenant_company_id or current_user.company_id
    if not company_id and current_user.role != PlatformRole.SUPER_ADMIN:
        raise HTTPException(status_code=400, detail="Company context required.")

    query = db.query(
        func.coalesce(func.sum(Asset.purchase_price), 0.0).label("total_purchase_cost"),
        func.coalesce(func.sum(Asset.current_value), 0.0).label("net_book_value")
    )

    if current_user.role != PlatformRole.SUPER_ADMIN:
        query = query.filter(Asset.company_id == company_id)

    res = query.first()
    total_cost = float(res.total_purchase_cost) if res else 0.0
    net_value = float(res.net_book_value) if res else 0.0
    accumulated_depreciation = max(0.0, total_cost - net_value)

    return {
        "company_id": company_id,
        "total_asset_cost": round(total_cost, 2),
        "net_book_value": round(net_value, 2),
        "accumulated_depreciation": round(accumulated_depreciation, 2)
    }


@router.get("/department-breakdown", response_model=List[Dict[str, Any]])
def get_department_financial_breakdown(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles([PlatformRole.SUPER_ADMIN, PlatformRole.IT_ADMIN, PlatformRole.SUB_ADMIN])),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id)
):
    """
    Get asset valuation and financial allocation broken down by company department.
    """
    company_id = tenant_company_id or current_user.company_id

    query = db.query(
        Department.id.label("department_id"),
        Department.name.label("department_name"),
        func.count(Asset.id).label("asset_count"),
        func.coalesce(func.sum(Asset.purchase_price), 0.0).label("total_cost"),
        func.coalesce(func.sum(Asset.current_value), 0.0).label("current_value")
    ).outerjoin(Asset, Asset.department_id == Department.id)

    if current_user.role != PlatformRole.SUPER_ADMIN:
        query = query.filter(Department.company_id == company_id)

    results = query.group_by(Department.id, Department.name).all()

    return [
        {
            "department_id": r.department_id,
            "department_name": r.department_name,
            "asset_count": r.asset_count,
            "total_cost": round(float(r.total_cost), 2),
            "current_value": round(float(r.current_value), 2)
        }
        for r in results
    ]