"""Implementation file: app/routers/cloud.py"""
from typing import List, Optional, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from pydantic import BaseModel

from app.core.database import get_db
from app.core.deps import get_current_user, require_roles, get_tenant_company_id
from app.models.models import CloudResource, PlatformRole, User
from app.services.audit_service import log_audit_event

router = APIRouter(prefix="/cloud", tags=["Cloud IT Asset Management"])


class CloudResourceCreate(BaseModel):
    provider: str  # AWS, Azure, GCP
    resource_id: str
    resource_type: str  # EC2, S3, RDS, VM
    region: str
    cost_monthly: Optional[float] = 0.0

class CloudResourceResponse(BaseModel):
    id: str
    company_id: str
    provider: str
    resource_id: str
    resource_type: str
    region: str
    cost_monthly: float

    class Config:
        orm_mode = True


@router.post("/resources", response_model=CloudResourceResponse, status_code=status.HTTP_201_CREATED)
def register_cloud_resource(
    res_in: CloudResourceCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles([PlatformRole.SUPER_ADMIN, PlatformRole.IT_ADMIN, PlatformRole.SUB_ADMIN])),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id)
):
    """
    Register a cloud instance, bucket, or service component into ITAM inventory.
    """
    company_id = tenant_company_id or current_user.company_id
    if not company_id:
        raise HTTPException(status_code=400, detail="Company context required.")

    cloud_res = CloudResource(
        company_id=company_id,
        provider=res_in.provider.upper(),
        resource_id=res_in.resource_id,
        resource_type=res_in.resource_type,
        region=res_in.region,
        monthly_cost=res_in.cost_monthly
    )
    db.add(cloud_res)
    db.commit()
    db.refresh(cloud_res)

    log_audit_event(
        db=db,
        action="REGISTER_CLOUD_RESOURCE",
        entity="CloudResource",
        company_id=company_id,
        user_id=current_user.id,
        entity_id=cloud_res.id,
        new_value=f"Provider: {cloud_res.provider}, Resource: {cloud_res.resource_id}"
    )

    return cloud_res


@router.get("/resources", response_model=List[CloudResourceResponse])
def list_cloud_resources(
    provider: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id)
):
    """
    List all cloud virtual assets across AWS, Azure, or GCP.
    """
    query = db.query(CloudResource)
    if current_user.role != PlatformRole.SUPER_ADMIN:
        query = query.filter(CloudResource.company_id == tenant_company_id)

    if provider:
        query = query.filter(CloudResource.provider == provider.upper())

    return query.all()