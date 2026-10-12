"""Implementation file: app/routers/departments.py"""
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func

from app.core.database import get_db
from app.core.deps import get_current_user, require_roles, get_tenant_company_id
from app.models.models import Asset, Department, PlatformRole, User
from app.services.audit_service import log_audit_event

router = APIRouter(prefix="/departments", tags=["Department Management"])


class DepartmentCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    description: Optional[str] = None
    department_head: Optional[str] = Field(None, max_length=150)

class DepartmentResponse(BaseModel):
    id: str
    company_id: str
    name: str
    description: Optional[str] = None
    department_head: Optional[str] = None
    status: Optional[str] = "ACTIVE"
    user_count: int = 0
    asset_count: int = 0

    model_config = ConfigDict(from_attributes=True)


def _counts(db: Session, model, department_ids: List[str]) -> dict:
    """department id -> number of rows of `model` in it, in one grouped query."""
    if not department_ids:
        return {}
    rows = (
        db.query(model.department_id, func.count(model.id))
        .filter(model.department_id.in_(department_ids))
        .group_by(model.department_id)
        .all()
    )
    return dict(rows)


@router.post("", response_model=DepartmentResponse, status_code=status.HTTP_201_CREATED)
def create_department(
    dept_in: DepartmentCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles([PlatformRole.SUPER_ADMIN, PlatformRole.IT_ADMIN, PlatformRole.SUB_ADMIN])),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id)
):
    """
    Create a new organizational department.
    """
    company_id = tenant_company_id or current_user.company_id
    if not company_id:
        raise HTTPException(status_code=400, detail="Company context required.")

    name = dept_in.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Department name is required.")
    duplicate = db.query(Department.id).filter(
        Department.company_id == company_id,
        func.lower(Department.name) == name.lower()
    ).first()
    if duplicate:
        raise HTTPException(status_code=400, detail=f"A department named '{name}' already exists.")

    dept = Department(
        company_id=company_id,
        name=name,
        description=dept_in.description,
        department_head=dept_in.department_head
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

    departments = query.order_by(Department.name).all()
    ids = [d.id for d in departments]
    users, assets = _counts(db, User, ids), _counts(db, Asset, ids)
    result = []
    for dept in departments:
        response = DepartmentResponse.model_validate(dept)
        response.user_count = users.get(dept.id, 0)
        response.asset_count = assets.get(dept.id, 0)
        result.append(response)
    return result


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

    # Users and assets reference the department, so deleting it while in use
    # would fail at the database; say why instead.
    users = db.query(User.id).filter(User.department_id == dept.id).count()
    assets = db.query(Asset.id).filter(Asset.department_id == dept.id).count()
    if users or assets:
        raise HTTPException(
            status_code=409,
            detail=f"'{dept.name}' still has {users} user(s) and {assets} asset(s). Move them to another department first."
        )

    db.delete(dept)
    db.commit()
    return None