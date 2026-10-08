"""Implementation file: app/routers/users.py"""
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_password_hash
from app.core.deps import get_current_user, require_roles, get_tenant_company_id
from app.models.models import User, PlatformRole, Subscription, Company
from app.schemas.schemas import UserCreate, UserResponse, UserUpdate
from app.services.audit_service import log_audit_event

router = APIRouter(prefix="/users", tags=["Users Management"])


@router.post("", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
def create_user(
    user_in: UserCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles([PlatformRole.SUPER_ADMIN, PlatformRole.IT_ADMIN])),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id)
):
    """
    Create a new user within the authenticated tenant context.
    Super Admins can explicitly pass a target company_id.
    """
    target_company_id = user_in.company_id if current_user.role == PlatformRole.SUPER_ADMIN else (tenant_company_id or current_user.company_id)

    if not target_company_id and current_user.role != PlatformRole.SUPER_ADMIN:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Target company context must be provided."
        )

    # Check for existing email across system
    existing_user = db.query(User).filter(User.email == user_in.email).first()
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A user with this email address already exists."
        )

    # Verify subscription limits if tenant is specified
    if target_company_id:
        subscription = db.query(Subscription).filter(Subscription.company_id == target_company_id).first()
        if subscription:
            current_user_count = db.query(User).filter(
                User.company_id == target_company_id, 
                User.status == "ACTIVE"
            ).count()
            if current_user_count >= subscription.user_limit:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Subscription user limit ({subscription.user_limit}) reached for this company."
                )

    hashed_pwd = get_password_hash(user_in.password)
    new_user = User(
        email=user_in.email,
        hashed_password=hashed_pwd,
        full_name=user_in.full_name,
        role=user_in.role,
        company_id=target_company_id,
        department_id=user_in.department_id,
        location=user_in.location,
        modules=user_in.modules if user_in.role == PlatformRole.SUB_ADMIN else None,
        status="ACTIVE"
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)

    log_audit_event(
        db=db,
        action="CREATE_USER",
        entity="User",
        company_id=target_company_id,
        user_id=current_user.id,
        entity_id=new_user.id,
        new_value=f"Email: {new_user.email}, Role: {new_user.role.value}"
    )

    return new_user


@router.get("", response_model=List[UserResponse])
def list_users(
    skip: int = 0,
    limit: int = 100,
    department_id: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id)
):
    """
    List all users in current tenant company.
    """
    company_id = tenant_company_id or current_user.company_id
    query = db.query(User)
    
    if current_user.role != PlatformRole.SUPER_ADMIN:
        if not company_id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Company context required.")
        query = query.filter(User.company_id == company_id)

    if department_id:
        query = query.filter(User.department_id == department_id)

    users = query.offset(skip).limit(limit).all()
    return users


@router.get("/{user_id}", response_model=UserResponse)
def get_user_by_id(
    user_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id)
):
    """
    Retrieve specific user details.
    """
    company_id = tenant_company_id or current_user.company_id
    query = db.query(User).filter(User.id == user_id)
    
    if current_user.role != PlatformRole.SUPER_ADMIN:
        if not company_id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Company context required.")
        query = query.filter(User.company_id == company_id)

    user = query.first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found."
        )
    return user


@router.put("/{user_id}", response_model=UserResponse)
def update_user(
    user_id: str,
    user_in: UserUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles([PlatformRole.SUPER_ADMIN, PlatformRole.IT_ADMIN])),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id)
):
    """
    Update user profile, department, location, or role.
    """
    company_id = tenant_company_id or current_user.company_id
    query = db.query(User).filter(User.id == user_id)
    
    if current_user.role != PlatformRole.SUPER_ADMIN:
        if not company_id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Company context required.")
        query = query.filter(User.company_id == company_id)

    user = query.first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found."
        )

    old_role = user.role.value
    
    update_data = user_in.model_dump(exclude_unset=True) if hasattr(user_in, "model_dump") else user_in.dict(exclude_unset=True)
    for field, value in update_data.items():
        setattr(user, field, value)

    db.commit()
    db.refresh(user)

    log_audit_event(
        db=db,
        action="UPDATE_USER",
        entity="User",
        company_id=user.company_id,
        user_id=current_user.id,
        entity_id=user.id,
        old_value=f"Role: {old_role}",
        new_value=f"Role: {user.role.value}, Status: {user.status}"
    )

    return user


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def deactivate_user(
    user_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles([PlatformRole.SUPER_ADMIN, PlatformRole.IT_ADMIN])),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id)
):
    """
    Soft delete / deactivate user account.
    """
    company_id = tenant_company_id or current_user.company_id
    query = db.query(User).filter(User.id == user_id)
    
    if current_user.role != PlatformRole.SUPER_ADMIN:
        if not company_id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Company context required.")
        query = query.filter(User.company_id == company_id)

    user = query.first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found."
        )

    user.status = "INACTIVE"
    db.commit()

    log_audit_event(
        db=db,
        action="DEACTIVATE_USER",
        entity="User",
        company_id=user.company_id,
        user_id=current_user.id,
        entity_id=user.id
    )
    return None