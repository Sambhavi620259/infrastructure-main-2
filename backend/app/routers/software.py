"""Implementation file: app/routers/software.py"""
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_current_user, require_roles, get_tenant_company_id
from app.models.models import Software, SoftwareLicenseAssignment, PlatformRole, User
from app.schemas.schemas import SoftwareCreate, SoftwareResponse, LicenseAssignRequest
from app.services.audit_service import log_audit_event

router = APIRouter(prefix="/software", tags=["Software & License Management"])


@router.post("", response_model=SoftwareResponse, status_code=status.HTTP_201_CREATED)
def create_software(
    software_in: SoftwareCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles([PlatformRole.SUPER_ADMIN, PlatformRole.IT_ADMIN, PlatformRole.SUB_ADMIN])),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id)
):
    """
    Register a new software license asset within the tenant account.
    """
    company_id = tenant_company_id or current_user.company_id
    if not company_id and current_user.role != PlatformRole.SUPER_ADMIN:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, 
            detail="Valid company context is required."
        )

    software = Software(
        company_id=company_id,
        name=software_in.name,
        vendor=software_in.vendor,
        version=software_in.version,
        license_type=software_in.license_type,
        total_licenses=software_in.total_licenses,
        used_licenses=0,
        cost=software_in.cost,
        expiry_date=software_in.expiry_date,
        status="ACTIVE"
    )
    db.add(software)
    db.commit()
    db.refresh(software)

    log_audit_event(
        db=db,
        action="CREATE_SOFTWARE_LICENSE",
        entity="Software",
        company_id=company_id,
        user_id=current_user.id,
        entity_id=software.id,
        new_value=f"Software: {software.name}, Licenses: {software.total_licenses}"
    )

    return software


@router.get("", response_model=List[SoftwareResponse])
def list_software(
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id)
):
    """
    List all software entries and license allocation usage.
    """
    company_id = tenant_company_id or current_user.company_id
    query = db.query(Software)
    
    if current_user.role != PlatformRole.SUPER_ADMIN:
        if not company_id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Company context required.")
        query = query.filter(Software.company_id == company_id)

    return query.offset(skip).limit(limit).all()


@router.get("/{software_id}", response_model=SoftwareResponse)
def get_software(
    software_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id)
):
    """
    Retrieve single software license details.
    """
    company_id = tenant_company_id or current_user.company_id
    query = db.query(Software).filter(Software.id == software_id)
    
    if current_user.role != PlatformRole.SUPER_ADMIN:
        if not company_id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Company context required.")
        query = query.filter(Software.company_id == company_id)

    software = query.first()
    if not software:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, 
            detail="Software asset not found."
        )
    return software


@router.post("/{software_id}/assign", status_code=status.HTTP_201_CREATED)
def assign_software_license(
    software_id: str,
    assign_in: LicenseAssignRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles([PlatformRole.SUPER_ADMIN, PlatformRole.IT_ADMIN, PlatformRole.SUB_ADMIN])),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id)
):
    """
    Assign an available software license key to an active user.
    """
    company_id = tenant_company_id or current_user.company_id
    query = db.query(Software).filter(Software.id == software_id)
    
    if current_user.role != PlatformRole.SUPER_ADMIN:
        if not company_id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Company context required.")
        query = query.filter(Software.company_id == company_id)

    software = query.first()
    if not software:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, 
            detail="Software asset not found."
        )

    if software.used_licenses >= software.total_licenses:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No available licenses remaining for this software."
        )

    target_user = db.query(User).filter(
        User.id == assign_in.user_id,
        User.company_id == software.company_id,
        User.status == "ACTIVE"
    ).first()

    if not target_user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, 
            detail="Target active user not found in this company."
        )

    # Check for duplicate license assignment
    existing_assignment = db.query(SoftwareLicenseAssignment).filter(
        SoftwareLicenseAssignment.software_id == software.id,
        SoftwareLicenseAssignment.user_id == target_user.id
    ).first()

    if existing_assignment:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="License is already assigned to this user."
        )

    assignment = SoftwareLicenseAssignment(
        company_id=software.company_id,
        software_id=software.id,
        user_id=target_user.id
    )
    software.used_licenses += 1

    db.add(assignment)
    db.commit()
    db.refresh(assignment)

    log_audit_event(
        db=db,
        action="ASSIGN_SOFTWARE_LICENSE",
        entity="SoftwareLicenseAssignment",
        company_id=software.company_id,
        user_id=current_user.id,
        entity_id=assignment.id,
        new_value=f"Software ID: {software.id}, User ID: {target_user.id}"
    )

    return {"message": "License assigned successfully.", "assigned_user_id": target_user.id}


@router.delete("/{software_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_software(
    software_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles([PlatformRole.SUPER_ADMIN, PlatformRole.IT_ADMIN])),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id)
):
    """
    Remove a software entry and revoke all assigned seats.
    """
    company_id = tenant_company_id or current_user.company_id
    query = db.query(Software).filter(Software.id == software_id)
    
    if current_user.role != PlatformRole.SUPER_ADMIN:
        if not company_id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Company context required.")
        query = query.filter(Software.company_id == company_id)

    software = query.first()
    if not software:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, 
            detail="Software asset not found."
        )

    db.query(SoftwareLicenseAssignment).filter(
        SoftwareLicenseAssignment.software_id == software.id
    ).delete()

    db.delete(software)
    db.commit()

    log_audit_event(
        db=db,
        action="DELETE_SOFTWARE",
        entity="Software",
        company_id=software.company_id,
        user_id=current_user.id,
        entity_id=software_id
    )

    return None