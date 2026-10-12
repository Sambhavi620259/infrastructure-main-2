"""asset_requests.department_id; starter categories and departments for existing organizations

Revision ID: f7c3d8a1b2e4
Revises: e5b1c9d2a4f7
Create Date: 2026-10-11 20:45:00.000000
"""
import uuid
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'f7c3d8a1b2e4'
down_revision: Union[str, None] = 'e5b1c9d2a4f7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Kept here (not imported) so this migration stays fixed if the app's defaults change.
CATEGORIES = [
    "Laptop", "Desktop", "Monitor", "Mobile Phone", "Tablet", "Printer",
    "Network Device", "Server", "Peripheral", "Software License",
]
DEPARTMENTS = [
    "IT", "Engineering", "Human Resources", "Finance", "Sales", "Marketing", "Operations", "Administration",
]


def upgrade() -> None:
    op.add_column('asset_requests', sa.Column('department_id', sa.String(), nullable=True))
    op.create_foreign_key(
        'fk_asset_requests_department_id', 'asset_requests', 'departments', ['department_id'], ['id']
    )

    # Only organizations whose list is still empty get the starter values.
    bind = op.get_bind()
    companies = [row[0] for row in bind.execute(sa.text("SELECT id FROM companies"))]
    for company_id in companies:
        has_categories = bind.execute(
            sa.text("SELECT 1 FROM asset_categories WHERE company_id = :c LIMIT 1"), {"c": company_id}
        ).first()
        if not has_categories:
            for name in CATEGORIES:
                bind.execute(
                    sa.text("INSERT INTO asset_categories (id, company_id, name) VALUES (:id, :c, :n)"),
                    {"id": str(uuid.uuid4()), "c": company_id, "n": name},
                )
        has_departments = bind.execute(
            sa.text("SELECT 1 FROM departments WHERE company_id = :c LIMIT 1"), {"c": company_id}
        ).first()
        if not has_departments:
            for name in DEPARTMENTS:
                bind.execute(
                    sa.text("INSERT INTO departments (id, company_id, name, status) VALUES (:id, :c, :n, 'ACTIVE')"),
                    {"id": str(uuid.uuid4()), "c": company_id, "n": name},
                )


def downgrade() -> None:
    # The starter rows are ordinary data by now and are left in place.
    op.drop_constraint('fk_asset_requests_department_id', 'asset_requests', type_='foreignkey')
    op.drop_column('asset_requests', 'department_id')
