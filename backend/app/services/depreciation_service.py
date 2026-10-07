"""Implementation file: app/services/depreciation_service.py"""
from datetime import datetime
from typing import Dict, Any


def calculate_asset_depreciation(
    purchase_cost: float,
    purchase_date: datetime,
    salvage_value: float = 0.0,
    useful_life_years: int = 5,
    method: str = "STRAIGHT_LINE"
) -> Dict[str, Any]:
    """
    Calculate asset current valuation and accumulated depreciation.
    Supports STRAIGHT_LINE and DECLINING_BALANCE algorithms.
    """
    if purchase_cost <= 0:
        return {
            "current_value": 0.0,
            "total_depreciated": 0.0,
            "annual_depreciation": 0.0,
            "years_in_service": 0.0
        }

    now = datetime.utcnow()
    if purchase_date > now:
        return {
            "current_value": purchase_cost,
            "total_depreciated": 0.0,
            "annual_depreciation": 0.0,
            "years_in_service": 0.0
        }

    days_in_service = (now - purchase_date).days
    years_in_service = days_in_service / 365.25

    if useful_life_years <= 0:
        useful_life_years = 5

    depreciable_base = max(0.0, purchase_cost - salvage_value)

    if method.upper() == "STRAIGHT_LINE":
        annual_depreciation = depreciable_base / useful_life_years
        total_depreciated = min(depreciable_base, annual_depreciation * years_in_service)
        current_value = max(salvage_value, purchase_cost - total_depreciated)

    elif method.upper() == "DECLINING_BALANCE":
        # Double declining balance method factor (2.0)
        rate = 2.0 / useful_life_years
        current_val = purchase_cost
        full_years = int(years_in_service)
        fractional_year = years_in_service - full_years

        for _ in range(full_years):
            dep = current_val * rate
            if current_val - dep < salvage_value:
                current_val = salvage_value
                break
            current_val -= dep

        if current_val > salvage_value and fractional_year > 0:
            partial_dep = current_val * rate * fractional_year
            current_val = max(salvage_value, current_val - partial_dep)

        current_value = max(salvage_value, current_val)
        total_depreciated = purchase_cost - current_value
        annual_depreciation = purchase_cost * rate

    else:
        # Default to straight line fallback
        annual_depreciation = depreciable_base / useful_life_years
        total_depreciated = min(depreciable_base, annual_depreciation * years_in_service)
        current_value = max(salvage_value, purchase_cost - total_depreciated)

    return {
        "current_value": round(float(current_value), 2),
        "total_depreciated": round(float(total_depreciated), 2),
        "annual_depreciation": round(float(annual_depreciation), 2),
        "years_in_service": round(float(years_in_service), 2)
    }