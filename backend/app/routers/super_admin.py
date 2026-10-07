"""Implementation file: app/routers/super_admin.py"""
from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import require_roles
from app.models.models import Company, Subscription, PlatformRole, User
from app.schemas.schemas import (
    CompanyCreate, CompanyResponse, CompanyUpdate, SubscriptionResponse
)
from app.services.audit_service import log_audit_event

router = APIRouter(prefix="/super-admin", tags=["Super Admin"])


@router.post(
    "/companies", 
    response_model=CompanyResponse, 
    status_code=status.HTTP_201_CREATED
)
def create_company_tenant(
    company_in: CompanyCreate,
    db: Session = Depends(get_db),
    admin_user: User = Depends(require_roles([PlatformRole.SUPER_ADMIN]))
):
    """
    Create a new tenant company along with its default subscription plan.
    Accessible exclusively by Super Admins.
    """
    existing_company = db.query(Company).filter(
        (Company.name == company_in.name) | (Company.code == company_in.code)
    ).first()
    
    if existing_company:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A company with this name or code already exists."
        )

    new_company = Company(
        name=company_in.name,
        code=company_in.code
    )
    db.add(new_company)
    db.flush()

    new_subscription = Subscription(
        company_id=new_company.id,
        plan=company_in.plan,
        user_limit=company_in.user_limit,
        asset_limit=company_in.asset_limit
    )
    db.add(new_subscription)
    db.commit()
    db.refresh(new_company)

    log_audit_event(
        db=db,
        action="CREATE_COMPANY_TENANT",
        entity="Company",
        company_id=new_company.id,
        user_id=admin_user.id,
        entity_id=new_company.id,
        new_value=f"Company: {new_company.name}, Code: {new_company.code}"
    )

    return new_company


@router.get("/companies", response_model=List[CompanyResponse])
def list_companies(
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    admin_user: User = Depends(require_roles([PlatformRole.SUPER_ADMIN]))
):
    """
    Retrieve all platform tenants across the system.
    """
    companies = db.query(Company).offset(skip).limit(limit).all()
    return companies


@router.get("/companies/{company_id}", response_model=CompanyResponse)
def get_company_details(
    company_id: str,
    db: Session = Depends(get_db),
    admin_user: User = Depends(require_roles([PlatformRole.SUPER_ADMIN]))
):
    """
    Get detailed information for a specific tenant company.
    """
    company = db.query(Company).filter(Company.id == company_id).first()
    if not company:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Company tenant not found."
        )
    return company


@router.put("/companies/{company_id}", response_model=CompanyResponse)
def update_company(
    company_id: str,
    company_in: CompanyUpdate,
    db: Session = Depends(get_db),
    admin_user: User = Depends(require_roles([PlatformRole.SUPER_ADMIN]))
):
    """
    Update company tenant metadata or toggle active status.
    """
    company = db.query(Company).filter(Company.id == company_id).first()
    if not company:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Company tenant not found."
        )

    old_status = company.status
    
    # Handle update fields flexibly
    update_data = company_in.model_dump(exclude_unset=True) if hasattr(company_in, "model_dump") else company_in.dict(exclude_unset=True)
    
    for field, value in update_data.items():
        setattr(company, field, value)

    db.commit()
    db.refresh(company)

    log_audit_event(
        db=db,
        action="UPDATE_COMPANY",
        entity="Company",
        company_id=company.id,
        user_id=admin_user.id,
        entity_id=company.id,
        old_value=f"Status: {old_status}",
        new_value=f"Status: {company.status}"
    )

    return company


@router.get("/subscriptions", response_model=List[SubscriptionResponse])
def list_subscriptions(
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    admin_user: User = Depends(require_roles([PlatformRole.SUPER_ADMIN]))
):
    """
    List subscription metrics and limits across all tenants.
    """
    return db.query(Subscription).offset(skip).limit(limit).all()