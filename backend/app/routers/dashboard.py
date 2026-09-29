"""Implementation file: app/routers/dashboard.py"""
from typing import Dict, Any, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import func

from app.core.database import get_db
from app.core.deps import get_current_user, get_tenant_company_id
from app.models.models import (
    Asset, AssetStatusEnum, AssetRequest, RequestStatusEnum, 
    MaintenanceLog, InventoryItem, PlatformRole, User
)

router = APIRouter(prefix="/dashboard", tags=["Dashboard Metrics"])


@router.get("/overview", response_model=Dict[str, Any])
def get_dashboard_overview(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id)
):
    """
    Get unified real-time telemetry and overview metrics for workspace dashboards.
    """
    company_id = tenant_company_id or current_user.company_id
    if not company_id and current_user.role != PlatformRole.SUPER_ADMIN:
        raise HTTPException(status_code=400, detail="Company context required.")

    # Base Filter setup
    asset_q = db.query(Asset)
    req_q = db.query(AssetRequest)
    maint_q = db.query(MaintenanceLog)
    inv_q = db.query(InventoryItem)

    if current_user.role != PlatformRole.SUPER_ADMIN:
        asset_q = asset_q.filter(Asset.company_id == company_id)
        req_q = req_q.filter(AssetRequest.company_id == company_id)
        maint_q = maint_q.filter(MaintenanceLog.company_id == company_id)
        inv_q = inv_q.filter(InventoryItem.company_id == company_id)

    total_assets = asset_q.count()
    assigned_assets = asset_q.filter(Asset.status == AssetStatusEnum.ASSIGNED).count()
    in_stock_assets = asset_q.filter(Asset.status == AssetStatusEnum.IN_STOCK).count()
    maintenance_assets = asset_q.filter(Asset.status == AssetStatusEnum.UNDER_MAINTENANCE).count()
    pending_requests = req_q.filter(AssetRequest.status == RequestStatusEnum.PENDING).count()

    total_valuation = db.query(func.coalesce(func.sum(Asset.current_value), 0.0)).filter(
        Asset.company_id == company_id if current_user.role != PlatformRole.SUPER_ADMIN else True
    ).scalar() or 0.0

    low_stock_alerts = inv_q.filter(InventoryItem.status == "LOW_STOCK").count()

    return {
        "metrics": {
            "total_assets": total_assets,
            "assigned_assets": assigned_assets,
            "in_stock_assets": in_stock_assets,
            "under_maintenance": maintenance_assets,
            "pending_requests": pending_requests,
            "low_stock_alerts": low_stock_alerts,
            "total_asset_valuation": round(float(total_valuation), 2)
        }
    }