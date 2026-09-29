"""Implementation file: app/routers/reports.py"""
from typing import Dict, Any, List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import func

from app.core.database import get_db
from app.core.deps import get_current_user, require_roles, get_tenant_company_id
from app.models.models import (
    Asset, AssetCategory, Software, InventoryItem, MaintenanceLog, 
    AssetStatusEnum, PlatformRole, User
)
from app.schemas.schemas import ExecutiveDashboardSummary, AssetCategoryReport

router = APIRouter(prefix="/reports", tags=["Reporting & Analytics"])


@router.get("/dashboard-summary", response_model=ExecutiveDashboardSummary)
def get_executive_dashboard_summary(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id)
):
    """
    Retrieve high-level KPIs and metrics for executive and IT admin dashboards.
    """
    company_id = tenant_company_id or current_user.company_id
    if not company_id and current_user.role != PlatformRole.SUPER_ADMIN:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Company context required."
        )

    asset_query = db.query(Asset)
    software_query = db.query(Software)
    inventory_query = db.query(InventoryItem)

    if current_user.role != PlatformRole.SUPER_ADMIN:
        asset_query = asset_query.filter(Asset.company_id == company_id)
        software_query = software_query.filter(Software.company_id == company_id)
        inventory_query = inventory_query.filter(InventoryItem.company_id == company_id)

    total_assets = asset_query.count()
    assigned_assets = asset_query.filter(Asset.status == AssetStatusEnum.ASSIGNED).count()
    in_stock_assets = asset_query.filter(Asset.status == AssetStatusEnum.IN_STOCK).count()
    maintenance_assets = asset_query.filter(Asset.status == AssetStatusEnum.UNDER_MAINTENANCE).count()

    total_asset_value = db.query(func.sum(Asset.current_value)).filter(
        Asset.company_id == company_id if current_user.role != PlatformRole.SUPER_ADMIN else True
    ).scalar() or 0.0

    total_software_licenses = db.query(func.sum(Software.total_licenses)).filter(
        Software.company_id == company_id if current_user.role != PlatformRole.SUPER_ADMIN else True
    ).scalar() or 0

    used_software_licenses = db.query(func.sum(Software.used_licenses)).filter(
        Software.company_id == company_id if current_user.role != PlatformRole.SUPER_ADMIN else True
    ).scalar() or 0

    low_stock_items = inventory_query.filter(InventoryItem.status == "LOW_STOCK").count()

    return ExecutiveDashboardSummary(
        total_assets=total_assets,
        assigned_assets=assigned_assets,
        in_stock_assets=in_stock_assets,
        under_maintenance_assets=maintenance_assets,
        total_asset_value=round(float(total_asset_value), 2),
        total_software_licenses=total_software_licenses,
        used_software_licenses=used_software_licenses,
        low_stock_inventory_alerts=low_stock_items
    )


@router.get("/assets-by-category", response_model=List[AssetCategoryReport])
def get_assets_by_category_report(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id)
):
    """
    Get breakdown of hardware assets grouped by category with total valuation.
    """
    company_id = tenant_company_id or current_user.company_id

    query = db.query(
        AssetCategory.id.label("category_id"),
        AssetCategory.name.label("category_name"),
        func.count(Asset.id).label("total_count"),
        func.coalesce(func.sum(Asset.current_value), 0.0).label("total_value")
    ).join(Asset, Asset.category_id == AssetCategory.id, isouter=True)

    if current_user.role != PlatformRole.SUPER_ADMIN:
        query = query.filter(AssetCategory.company_id == company_id)

    results = query.group_by(AssetCategory.id, AssetCategory.name).all()

    return [
        AssetCategoryReport(
            category_id=r.category_id,
            category_name=r.category_name,
            total_count=r.total_count,
            total_value=round(float(r.total_value), 2)
        )
        for r in results
    ]


@router.get("/maintenance-cost-analysis")
def get_maintenance_cost_analysis(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles([PlatformRole.SUPER_ADMIN, PlatformRole.IT_ADMIN, PlatformRole.SUB_ADMIN])),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id)
):
    """
    Generate cost and frequency breakdown for asset repairs and preventive maintenance.
    """
    company_id = tenant_company_id or current_user.company_id

    query = db.query(
        MaintenanceLog.maintenance_type,
        func.count(MaintenanceLog.id).label("total_records"),
        func.coalesce(func.sum(MaintenanceLog.cost), 0.0).label("total_cost")
    )

    if current_user.role != PlatformRole.SUPER_ADMIN:
        query = query.filter(MaintenanceLog.company_id == company_id)

    results = query.group_by(MaintenanceLog.maintenance_type).all()

    return {
        "summary": [
            {
                "maintenance_type": r.maintenance_type,
                "total_records": r.total_records,
                "total_cost": round(float(r.total_cost), 2)
            }
            for r in results
        ]
    }


@router.get("/license-utilization")
def get_license_utilization_report(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id)
):
    """
    Report software license allocation efficiency and unused seat metrics.
    """
    company_id = tenant_company_id or current_user.company_id

    query = db.query(Software)
    if current_user.role != PlatformRole.SUPER_ADMIN:
        query = query.filter(Software.company_id == company_id)

    software_items = query.all()

    report_data = []
    for sw in software_items:
        utilization_rate = (sw.used_licenses / sw.total_licenses * 100) if sw.total_licenses > 0 else 0.0
        report_data.append({
            "software_id": sw.id,
            "name": sw.name,
            "vendor": sw.vendor,
            "total_licenses": sw.total_licenses,
            "used_licenses": sw.used_licenses,
            "available_licenses": sw.total_licenses - sw.used_licenses,
            "utilization_rate_pct": round(utilization_rate, 2),
            "total_cost": sw.cost
        })

    return {"license_utilization": report_data}