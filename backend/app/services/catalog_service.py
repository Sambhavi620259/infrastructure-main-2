"""Starter asset categories and departments for an organization."""
from sqlalchemy.orm import Session

from app.models.models import AssetCategory, Department

DEFAULT_CATEGORIES = [
    "Laptop", "Desktop", "Monitor", "Mobile Phone", "Tablet", "Printer",
    "Network Device", "Server", "Peripheral", "Software License",
]

DEFAULT_DEPARTMENTS = [
    "IT", "Engineering", "Human Resources", "Finance", "Sales", "Marketing", "Operations", "Administration",
]


def ensure_default_catalog(db: Session, company_id: str) -> None:
    """
    Give an organization the starter categories and departments, but only for
    a list that is still empty, so nothing an admin has set up is touched.
    The caller commits.
    """
    if not db.query(AssetCategory.id).filter(AssetCategory.company_id == company_id).first():
        db.add_all(AssetCategory(company_id=company_id, name=name) for name in DEFAULT_CATEGORIES)
    if not db.query(Department.id).filter(Department.company_id == company_id).first():
        db.add_all(Department(company_id=company_id, name=name) for name in DEFAULT_DEPARTMENTS)
