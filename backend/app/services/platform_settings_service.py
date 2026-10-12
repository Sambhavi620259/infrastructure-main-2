"""Platform defaults a Super Admin can change, stored in platform_settings."""
from typing import Optional

from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.models.models import PlatformSetting

PLANS = ("TRIAL", "STARTER", "BUSINESS", "ENTERPRISE")


class ProvisioningDefaults(BaseModel):
    """Subscription given to an organization created by IT Admin sign-up."""
    plan: str = Field("ENTERPRISE", pattern="^(TRIAL|STARTER|BUSINESS|ENTERPRISE)$")
    user_limit: int = Field(500, ge=1, le=1_000_000)
    asset_limit: int = Field(2000, ge=1, le=10_000_000)


_KEY = "provisioning_defaults"


def get_provisioning_defaults(db: Session) -> ProvisioningDefaults:
    row = db.query(PlatformSetting).filter(PlatformSetting.name == _KEY).first()
    return ProvisioningDefaults.model_validate_json(row.value) if row else ProvisioningDefaults()


def set_provisioning_defaults(db: Session, defaults: ProvisioningDefaults, user_id: Optional[str]) -> None:
    """The caller commits."""
    row = db.query(PlatformSetting).filter(PlatformSetting.name == _KEY).first()
    if row:
        row.value = defaults.model_dump_json()
        row.updated_by = user_id
    else:
        db.add(PlatformSetting(name=_KEY, value=defaults.model_dump_json(), updated_by=user_id))
