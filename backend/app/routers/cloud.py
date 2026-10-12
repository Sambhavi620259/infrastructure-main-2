"""Implementation file: app/routers/cloud.py

Cloud resources (VMs, buckets, databases…) tracked alongside hardware, with
their monthly cost.
"""
from decimal import Decimal
from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user, get_tenant_company_id, require_roles
from app.models.models import CloudResource, PlatformRole, User
from app.services.audit_service import log_audit_event

router = APIRouter(prefix="/cloud", tags=["Cloud Asset Management"])

_admins = require_roles([PlatformRole.SUPER_ADMIN, PlatformRole.IT_ADMIN, PlatformRole.SUB_ADMIN])
Provider = Literal["AWS", "AZURE", "GCP", "OTHER"]
ResourceStatus = Literal["RUNNING", "STOPPED", "TERMINATED"]


class CloudResourceCreate(BaseModel):
    provider: Provider
    account_id: str = Field(..., min_length=1, max_length=100)
    resource_id: str = Field(..., min_length=1, max_length=150)
    resource_type: str = Field(..., min_length=1, max_length=100)
    region: Optional[str] = Field(None, max_length=50)
    monthly_cost: Decimal = Field(Decimal("0"), ge=0)


class CloudResourceUpdate(BaseModel):
    status: Optional[ResourceStatus] = None
    monthly_cost: Optional[Decimal] = Field(None, ge=0)
    region: Optional[str] = Field(None, max_length=50)


class CloudResourceResponse(BaseModel):
    id: str
    company_id: str
    provider: str
    account_id: str
    resource_id: str
    resource_type: str
    region: Optional[str] = None
    monthly_cost: Decimal
    status: str

    model_config = ConfigDict(from_attributes=True)


def _company_id(current_user: User, tenant_company_id: Optional[str]) -> str:
    company_id = tenant_company_id or current_user.company_id
    if not company_id:
        raise HTTPException(status_code=400, detail="Company context required.")
    return company_id


@router.post("/resources", response_model=CloudResourceResponse, status_code=status.HTTP_201_CREATED)
def register_cloud_resource(
    res_in: CloudResourceCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(_admins),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id)
):
    """Track a cloud resource. The provider's resource ID must be unique per organization."""
    company_id = _company_id(current_user, tenant_company_id)
    if db.query(CloudResource.id).filter(
        CloudResource.company_id == company_id,
        CloudResource.provider == res_in.provider,
        CloudResource.resource_id == res_in.resource_id.strip(),
    ).first():
        raise HTTPException(status_code=400, detail="This resource is already tracked.")

    resource = CloudResource(
        company_id=company_id,
        provider=res_in.provider,
        account_id=res_in.account_id.strip(),
        resource_id=res_in.resource_id.strip(),
        resource_type=res_in.resource_type.strip(),
        region=res_in.region,
        monthly_cost=res_in.monthly_cost,
        status="RUNNING",
    )
    db.add(resource)
    db.commit()
    db.refresh(resource)

    log_audit_event(
        db=db,
        action="REGISTER_CLOUD_RESOURCE",
        entity="CloudResource",
        company_id=company_id,
        user_id=current_user.id,
        entity_id=resource.id,
        new_value=f"{resource.provider} {resource.resource_type} {resource.resource_id}"
    )
    return resource


@router.get("/resources", response_model=List[CloudResourceResponse])
def list_cloud_resources(
    provider: Optional[Provider] = None,
    resource_status: Optional[ResourceStatus] = Query(None, alias="status"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id)
):
    query = db.query(CloudResource)
    if current_user.role != PlatformRole.SUPER_ADMIN:
        query = query.filter(CloudResource.company_id == _company_id(current_user, tenant_company_id))
    if provider:
        query = query.filter(CloudResource.provider == provider)
    if resource_status:
        query = query.filter(CloudResource.status == resource_status)
    return query.order_by(CloudResource.provider, CloudResource.resource_type).all()


@router.put("/resources/{resource_id}", response_model=CloudResourceResponse)
def update_cloud_resource(
    resource_id: str,
    update_in: CloudResourceUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(_admins),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id)
):
    """Record a status change (e.g. stopped / terminated) or a new monthly cost."""
    query = db.query(CloudResource).filter(CloudResource.id == resource_id)
    if current_user.role != PlatformRole.SUPER_ADMIN:
        query = query.filter(CloudResource.company_id == _company_id(current_user, tenant_company_id))
    resource = query.first()
    if not resource:
        raise HTTPException(status_code=404, detail="Cloud resource not found.")
    for field, value in update_in.model_dump(exclude_unset=True).items():
        setattr(resource, field, value)
    db.commit()
    db.refresh(resource)
    log_audit_event(
        db=db,
        action="UPDATE_CLOUD_RESOURCE",
        entity="CloudResource",
        company_id=resource.company_id,
        user_id=current_user.id,
        entity_id=resource.id,
        new_value=f"{resource.resource_id}: {resource.status}, {resource.monthly_cost}/month"
    )
    return resource
