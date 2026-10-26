"""
Access guard for scoped roles.

- EMPLOYEE (shown as "User"): may reach only the areas that hold their own
  data: assets, tickets, software, access, reports, notifications and profile,
  plus the department names they pick from. Inventory is an IT Admin area. The
  routers then limit each of those to the user's own records.
- SUB_ADMIN: may change data only in the modules on their account
  (users.modules, e.g. ["HAM", "SAM"]).
- REPORTING_USER: read-only, except their own profile, notifications and reports.
- Everyone but the Super Admin: only the modules their organization's plan
  includes (inventory, software, reports, cloud; see plan_features_service).
"""
from typing import Optional

from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from app.core.database import get_db
from app.core.deps import user_from_token
from app.models.models import PlatformRole
from app.services.plan_features_service import FEATURES, company_features, feature_for

# Path prefix -> module that owns it.
MODULE_PREFIXES = (
    ("/api/assets", "HAM"),
    ("/api/asset-requests", "HAM"),
    ("/api/maintenance", "HAM"),
    ("/api/warranty-maintenance", "HAM"),
    ("/api/physical-audit", "HAM"),
    ("/api/depreciation", "HAM"),
    ("/api/inventory", "HAM"),
    ("/api/purchase-orders", "HAM"),
    ("/api/vendors", "HAM"),
    ("/api/departments", "HAM"),
    ("/api/approval-policies", "HAM"),
    ("/api/access", "HAM"),
    ("/api/software", "SAM"),
    ("/api/cloud", "CLOUD"),
    ("/api/discovery", "SCAN"),
    ("/api/reports", "REPORTS"),
)

# Paths any signed-in user may change (their own account and inbox).
ALWAYS_ALLOWED = ("/api/profile", "/api/notifications", "/api/auth")

# The only areas a user (EMPLOYEE) may reach. Each router scopes them to the
# user's own records. Departments are read-only names for the ticket form.
USER_PREFIXES = ("/api/assets", "/api/asset-requests", "/api/reports", "/api/software", "/api/access")
USER_READ_ONLY = ("/api/departments",)


def _under(path: str, prefixes) -> bool:
    return any(path == prefix or path.startswith(prefix + "/") for prefix in prefixes)


def module_for(path: str) -> Optional[str]:
    for prefix, module in MODULE_PREFIXES:
        if path == prefix or path.startswith(prefix + "/"):
            return module
    return None


class ScopedRoleWriteGuard(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        path = request.url.path
        if request.method == "OPTIONS" or not path.startswith("/api/") or path == "/api/health" \
                or path.startswith(ALWAYS_ALLOWED):
            return await call_next(request)
        auth = request.headers.get("authorization", "")
        token = auth[7:] if auth.lower().startswith("bearer ") else None
        if not token:
            return await call_next(request)  # the endpoint itself rejects unauthenticated calls

        # Same session factory the endpoints use (honours test overrides of get_db).
        session_source = request.app.dependency_overrides.get(get_db, get_db)()
        db = next(session_source)
        feature = feature_for(path)
        try:
            user = user_from_token(token, db)
            role, modules = (user.role, set(user.modules or [])) if user else (None, set())
            # Plan features: an organization reaches only the modules its plan includes.
            plan_blocked = bool(
                user and feature and role != PlatformRole.SUPER_ADMIN
                and feature not in company_features(db, user.company_id)
            )
        finally:
            session_source.close()

        if plan_blocked:
            return JSONResponse(
                status_code=403,
                content={"detail": f"Your organization's plan does not include {FEATURES[feature]}. "
                                   "Contact your platform administrator."},
            )

        reading = request.method in ("GET", "HEAD")
        if role == PlatformRole.EMPLOYEE and not (
            _under(path, USER_PREFIXES) or (reading and _under(path, USER_READ_ONLY))
        ):
            return JSONResponse(
                status_code=403,
                content={"detail": "Users can only access their own assets, tickets, software, access and reports."},
            )
        if reading:
            return await call_next(request)
        if role == PlatformRole.REPORTING_USER and module_for(path) != "REPORTS":
            return JSONResponse(status_code=403, content={"detail": "Reporting users have read-only access."})
        if role == PlatformRole.SUB_ADMIN:
            module = module_for(path)
            if module is None or module not in modules:
                return JSONResponse(
                    status_code=403,
                    content={"detail": "This action is outside the modules assigned to your Sub-admin account."},
                )
        return await call_next(request)
