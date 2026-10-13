"""Implementation file: app/routers/approvals.py

Approval rules per organization: which roles approve each request type and
whether self-approval is allowed. IT Admins (and Super Admins) configure
them; the rules are enforced in the ticket, stock-request and purchase-order
endpoints through app/services/approval_service.py.
"""
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import get_tenant_company_id, require_roles
from app.models.models import ApprovalPolicy, PlatformRole, User
from app.services.approval_service import APPROVER_ROLES, REQUEST_TYPES, all_policies, policy_for
from app.services.audit_service import log_audit_event

router = APIRouter(prefix="/approval-policies", tags=["Approval Rules"])

_readers = require_roles([PlatformRole.SUPER_ADMIN, PlatformRole.IT_ADMIN, PlatformRole.SUB_ADMIN])
_editors = require_roles([PlatformRole.SUPER_ADMIN, PlatformRole.IT_ADMIN])


class PolicyResponse(BaseModel):
    request_type: str
    approver_roles: List[str]
    allow_self_approval: bool
    # False while the organization still uses the default rule.
    configured: bool


class PolicyUpdate(BaseModel):
    approver_roles: List[str] = Field(..., min_length=1)
    allow_self_approval: bool = False


def _company(user: User, tenant_company_id: Optional[str]) -> str:
    company_id = tenant_company_id or user.company_id
    if not company_id:
        raise HTTPException(status_code=400, detail="Company context required.")
    return company_id


@router.get("", response_model=List[PolicyResponse])
def list_policies(
    db: Session = Depends(get_db),
    current_user: User = Depends(_readers),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id),
):
    return all_policies(db, _company(current_user, tenant_company_id))


@router.put("/{request_type}", response_model=PolicyResponse)
def update_policy(
    request_type: str,
    update_in: PolicyUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(_editors),
    tenant_company_id: Optional[str] = Depends(get_tenant_company_id),
):
    """Set who approves one request type. Only admin roles can be approvers."""
    company_id = _company(current_user, tenant_company_id)
    request_type = request_type.upper()
    if request_type not in REQUEST_TYPES:
        raise HTTPException(status_code=404, detail="Unknown request type.")
    roles = sorted(set(update_in.approver_roles))
    invalid = [role for role in roles if role not in APPROVER_ROLES]
    if invalid:
        raise HTTPException(status_code=400, detail=f"These roles cannot approve requests: {', '.join(invalid)}.")
    if current_user.role == PlatformRole.IT_ADMIN and PlatformRole.IT_ADMIN.value not in roles \
            and PlatformRole.SUB_ADMIN.value not in roles:
        raise HTTPException(status_code=400, detail="Keep at least one organization role (IT Admin or Sub-admin) as approver.")

    before = policy_for(db, company_id, request_type)
    row = db.query(ApprovalPolicy).filter(
        ApprovalPolicy.company_id == company_id, ApprovalPolicy.request_type == request_type
    ).first()
    if row is None:
        row = ApprovalPolicy(company_id=company_id, request_type=request_type)
        db.add(row)
    row.approver_roles = roles
    row.allow_self_approval = update_in.allow_self_approval
    row.updated_by = current_user.id
    db.commit()
    log_audit_event(
        db=db, action="UPDATE_APPROVAL_POLICY", entity="ApprovalPolicy", company_id=company_id,
        user_id=current_user.id, entity_id=row.id,
        old_value=f"{request_type}: {', '.join(before['approver_roles'])}; self-approval {'on' if before['allow_self_approval'] else 'off'}",
        new_value=f"{request_type}: {', '.join(roles)}; self-approval {'on' if row.allow_self_approval else 'off'}",
    )
    return policy_for(db, company_id, request_type)
