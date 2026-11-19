"""
Which part of the API belongs to which module, and what scoped roles may read.

- SUB_ADMIN: may change data only in the modules on their account.
- REPORTING_USER: read-only. Reports are always readable; any other data (assets,
  inventory, software, cloud, discovery, dashboard statistics) is readable only
  for the modules assigned on their account. Users, finance, audit logs and
  platform settings are never readable.

Used by ScopedRoleWriteGuard (writes) and get_current_user (every request).
"""
from typing import Optional

from app.models.models import PlatformRole, User

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
    ("/api/dashboard", "HAM"),
    ("/api/software", "SAM"),
    ("/api/cloud", "CLOUD"),
    ("/api/discovery", "SCAN"),
    ("/api/reports", "REPORTS"),
)

# Modules a Sub-admin administers or a Reporting user may additionally read.
DATA_MODULES = {"HAM", "SAM", "CLOUD", "SCAN"}

# Paths any signed-in user may use (their own account and inbox).
ALWAYS_ALLOWED = ("/api/profile", "/api/notifications", "/api/auth", "/api/health")


def module_for(path: str) -> Optional[str]:
    for prefix, module in MODULE_PREFIXES:
        if path == prefix or path.startswith(prefix + "/"):
            return module
    return None


def reporting_user_may_read(user: User, path: str) -> bool:
    """True if a REPORTING_USER account may call ``path`` (reads)."""
    if path.startswith(ALWAYS_ALLOWED):
        return True
    module = module_for(path)
    if module == "REPORTS":
        return True
    return module is not None and module in set(user.modules or [])
