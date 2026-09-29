"""Implementation file: app/routers/departments.py"""
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from pydantic import BaseModel

from app.core.database import get_db
from app.core.deps import get_current_user, require_roles, get_tenant_company_id
from app.models.models import Department, PlatformRole, User
from app.services.audit_service import log_audit_event

router = APIRouter(prefix="/departments", tags=["Department Management"])


class DepartmentCreate(BaseModel):
    name: str
    code: Optional[str] = None
    cost_center: Optional[str] = None

class DepartmentResponse(BaseModel):
    id: str
    company_id: str
    name: str
    code: Optional[str] = None
    cost_center: Optional[str] = None

    class Config:
        orm_mode = True


@router.post("", response_model=DepartmentResponse, status_code=status.HTTP_201_CREATED)
def create_department(
    dept_in: DepartmentCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles([PlatformRole.SUPER_ADMIN, PlatformRole.IT_ADMIN, PlatformRole.SUB_ADMIN])),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id)
):
    """
    Create a new organizational department or cost center.
    """
    company_id = tenant_company_id or current_user.company_id
    if not company_id:
        raise HTTPException(status_code=400, detail="Company context required.")

    dept = Department(
        company_id=company_id,
        name=dept_in.name,
        code=dept_in.code,
        cost_center=dept_in.cost_center
    )
    db.add(dept)
    db.commit()
    db.refresh(dept)

    log_audit_event(
        db=db,
        action="CREATE_DEPARTMENT",
        entity="Department",
        company_id=company_id,
        user_id=current_user.id,
        entity_id=dept.id,
        new_value=f"Department: {dept.name}"
    )

    return dept


@router.get("", response_model=List[DepartmentResponse])
def list_departments(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id)
):
    """
    List all departments configured for the active tenant.
    """
    query = db.query(Department)
    if current_user.role != PlatformRole.SUPER_ADMIN:
        query = query.filter(Department.company_id == tenant_company_id)

    return query.all()


@router.delete("/{department_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_department(
    department_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles([PlatformRole.SUPER_ADMIN, PlatformRole.IT_ADMIN])),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id)
):
    """
    Remove a department.
    """
    query = db.query(Department).filter(Department.id == department_id)
    if current_user.role != PlatformRole.SUPER_ADMIN:
        query = query.filter(Department.company_id == tenant_company_id)

    dept = query.first()
    if not dept:
        raise HTTPException(status_code=404, detail="Department not found.")

    db.delete(dept)
    db.commit()
    return None