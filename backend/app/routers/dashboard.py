"""Implementation file: app/routers/dashboard.py"""
from typing import Dict, Any, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import func

from app.core.database import get_db
from app.core.deps import get_current_user, get_tenant_company_id
from app.models.models import (
    Asset, AssetStatusEnum, AssetRequest, RequestStatusEnum, 
    Maintenance, InventoryItem, PlatformRole, User, InventoryRequest, PurchaseOrder, Software, SoftwareLicense,
    SoftwareLicenseAssignment,
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
    maint_q = db.query(Maintenance)
    inv_q = db.query(InventoryItem)

    # A Super Admin acting inside an organization sees that organization only.
    if company_id:
        asset_q = asset_q.filter(Asset.company_id == company_id)
        req_q = req_q.filter(AssetRequest.company_id == company_id)
        maint_q = maint_q.filter(Maintenance.company_id == company_id)
        inv_q = inv_q.filter(InventoryItem.company_id == company_id)

    total_assets = asset_q.count()
    assigned_assets = asset_q.filter(Asset.status.in_([AssetStatusEnum.ASSIGNED, AssetStatusEnum.IN_USE])).count()
    in_stock_assets = asset_q.filter(Asset.status == AssetStatusEnum.IN_STOCK).count()
    maintenance_assets = asset_q.filter(Asset.status == AssetStatusEnum.IN_REPAIR).count()
    pending_requests = req_q.filter(AssetRequest.status == RequestStatusEnum.PENDING).count()

    total_valuation = db.query(func.coalesce(func.sum(Asset.purchase_price), 0.0)).filter(
        Asset.company_id == company_id if company_id else True
    ).scalar() or 0.0

    low_stock_alerts = inv_q.filter(InventoryItem.quantity <= InventoryItem.reorder_level).count()

    software_q = db.query(Software)
    license_q = db.query(SoftwareLicense).filter(SoftwareLicense.status == "ACTIVE")
    seat_q = db.query(SoftwareLicenseAssignment).filter(SoftwareLicenseAssignment.is_active.is_(True))
    stock_req_q = db.query(InventoryRequest).filter(InventoryRequest.status == "PENDING")
    po_q = db.query(PurchaseOrder).filter(PurchaseOrder.status == "PENDING")
    if company_id:
        software_q = software_q.filter(Software.company_id == company_id)
        license_q = license_q.filter(SoftwareLicense.company_id == company_id)
        seat_q = seat_q.filter(SoftwareLicenseAssignment.company_id == company_id)
        stock_req_q = stock_req_q.filter(InventoryRequest.company_id == company_id)
        po_q = po_q.filter(PurchaseOrder.company_id == company_id)
    license_seats = int(license_q.with_entities(func.coalesce(func.sum(SoftwareLicense.seats), 0)).scalar() or 0)
    seats_assigned = seat_q.count()
    # Everything waiting for a decision: open tickets, stock requests and unapproved POs.
    pending_approvals = (
        req_q.filter(AssetRequest.status.in_([
            RequestStatusEnum.PENDING, RequestStatusEnum.UNDER_REVIEW, RequestStatusEnum.PENDING_APPROVAL,
        ])).count()
        + stock_req_q.count() + po_q.count()
    )

    return {
        "metrics": {
            "total_assets": total_assets,
            "assigned_assets": assigned_assets,
            "in_stock_assets": in_stock_assets,
            "under_maintenance": maintenance_assets,
            "pending_requests": pending_requests,
            "low_stock_alerts": low_stock_alerts,
            "software_products": software_q.count(),
            "license_seats": license_seats,
            "license_seats_assigned": seats_assigned,
            "pending_approvals": pending_approvals,
            "total_asset_valuation": round(float(total_valuation), 2)
        }
    }