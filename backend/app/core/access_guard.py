"""
Write guard for scoped roles.

- SUB_ADMIN: may change data only in the modules on their account
  (users.modules, e.g. ["HAM", "SAM"]).
- REPORTING_USER: read-only, except their own profile, notifications and reports.

Reads (GET) are not restricted here (pickers need them, and the routers limit
what each role sees); a Reporting user's reads are limited in get_current_user
using app/core/permissions.py.
"""
from typing import Optional

from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from app.core.database import get_db
from app.core.deps import user_from_token
from app.core.permissions import ALWAYS_ALLOWED, module_for
from app.models.models import PlatformRole


class ScopedRoleWriteGuard(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if request.method in ("GET", "HEAD", "OPTIONS") or request.url.path.startswith(ALWAYS_ALLOWED):
            return await call_next(request)
        auth = request.headers.get("authorization", "")
        token = auth[7:] if auth.lower().startswith("bearer ") else None
        if not token:
            return await call_next(request)  # the endpoint itself rejects unauthenticated calls

        # Same session factory the endpoints use (honours test overrides of get_db).
        session_source = request.app.dependency_overrides.get(get_db, get_db)()
        db = next(session_source)
        try:
            user = user_from_token(token, db)
            role, modules = (user.role, set(user.modules or [])) if user else (None, set())
        finally:
            session_source.close()

        path = request.url.path
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
