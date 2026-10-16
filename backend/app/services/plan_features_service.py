"""
Features each subscription plan includes, chosen by the Super Admin and
stored in platform_settings. Assets, tickets, users and settings are always
available; the modules below can be switched off per plan. Until a Super
Admin changes it, every plan includes every feature.
"""
import json
from typing import Dict, List, Optional, Set

from sqlalchemy.orm import Session

from app.models.models import PlatformSetting, Subscription
from app.services.platform_settings_service import PLANS

FEATURES: Dict[str, str] = {
    "INVENTORY": "Inventory & vendors",
    "SOFTWARE": "Software assets & licenses",
    "REPORTS": "Reports & analytics",
    "CLOUD": "Cloud",
}

# API path prefix -> the feature it belongs to.
FEATURE_PREFIXES = (
    ("/api/inventory", "INVENTORY"),
    ("/api/purchase-orders", "INVENTORY"),
    ("/api/vendors", "INVENTORY"),
    ("/api/software", "SOFTWARE"),
    ("/api/reports", "REPORTS"),
    ("/api/cloud", "CLOUD"),
)

_KEY = "plan_features"


def feature_for(path: str) -> Optional[str]:
    for prefix, feature in FEATURE_PREFIXES:
        if path == prefix or path.startswith(prefix + "/"):
            return feature
    return None


def get_plan_features(db: Session) -> Dict[str, List[str]]:
    row = db.query(PlatformSetting).filter(PlatformSetting.name == _KEY).first()
    stored = json.loads(row.value) if row else {}
    return {plan: [f for f in stored.get(plan, list(FEATURES)) if f in FEATURES] for plan in PLANS}


def set_plan_features(db: Session, plans: Dict[str, List[str]], user_id: Optional[str]) -> Dict[str, List[str]]:
    """The caller validates and commits."""
    value = {plan: sorted(set(plans.get(plan, []))) for plan in PLANS}
    row = db.query(PlatformSetting).filter(PlatformSetting.name == _KEY).first()
    if row:
        row.value = json.dumps(value)
        row.updated_by = user_id
    else:
        db.add(PlatformSetting(name=_KEY, value=json.dumps(value), updated_by=user_id))
    return value


def company_features(db: Session, company_id: Optional[str]) -> Set[str]:
    """Features the organization's plan includes. No organization: none of the plan features."""
    if not company_id:
        return set()
    plan = db.query(Subscription.plan).filter(Subscription.company_id == company_id).scalar() or "ENTERPRISE"
    return set(get_plan_features(db).get(plan, list(FEATURES)))
