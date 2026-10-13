"""Approval rules: who may approve each kind of request in an organization.

Each organization can configure, per request type, which roles may approve
and whether the person who raised a request may approve it themselves. When
nothing is configured the defaults below apply: admins and sub-admins
approve, and nobody approves their own request.
"""
from typing import Dict, Iterable, List

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.models import ApprovalPolicy, PlatformRole, User

# ASSET: asset requests; SOFTWARE: software access; RETURN: device returns;
# ISSUE: problems with an asset; STOCK: consumable stock requests;
# PURCHASE_ORDER: approving (ordering) a purchase order.
REQUEST_TYPES = ("ASSET", "SOFTWARE", "RETURN", "ISSUE", "STOCK", "PURCHASE_ORDER")

# Roles that may ever be approvers. Users (EMPLOYEE) and reporting users never approve.
APPROVER_ROLES = (PlatformRole.SUPER_ADMIN.value, PlatformRole.IT_ADMIN.value, PlatformRole.SUB_ADMIN.value)

DEFAULT_APPROVERS: List[str] = list(APPROVER_ROLES)

# Ticket type (asset_requests.ticket_type) -> approval request type.
TICKET_REQUEST_TYPE: Dict[str, str] = {"REQUEST": "ASSET", "SOFTWARE": "SOFTWARE", "RETURN": "RETURN", "ISSUE": "ISSUE"}


def policy_for(db: Session, company_id: str, request_type: str) -> Dict:
    """The effective rule for one request type: stored, or the default."""
    row = db.query(ApprovalPolicy).filter(
        ApprovalPolicy.company_id == company_id, ApprovalPolicy.request_type == request_type
    ).first()
    if row is None:
        return {"request_type": request_type, "approver_roles": list(DEFAULT_APPROVERS),
                "allow_self_approval": False, "configured": False}
    return {"request_type": request_type, "approver_roles": list(row.approver_roles or []),
            "allow_self_approval": bool(row.allow_self_approval), "configured": True}


def all_policies(db: Session, company_id: str) -> List[Dict]:
    return [policy_for(db, company_id, request_type) for request_type in REQUEST_TYPES]


def require_approver(db: Session, user: User, company_id: str, request_type: str,
                     requester_ids: Iterable[str]) -> None:
    """Raise 403 unless `user` may approve/reject/fulfil this request under the organization's rule."""
    policy = policy_for(db, company_id, request_type)
    if user.role.value not in policy["approver_roles"]:
        raise HTTPException(status_code=403, detail="Your role is not an approver for this kind of request.")
    if not policy["allow_self_approval"] and user.id in {r for r in requester_ids if r}:
        raise HTTPException(
            status_code=403,
            detail="You raised this request, so someone else must approve it (self-approval is off for this request type).",
        )
