"""assets.serial_number optional (only the asset name is required)

Revision ID: f9c1e3a5b7d0
Revises: e8b0d2f4a6c9
Create Date: 2026-10-13 18:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'f9c1e3a5b7d0'
down_revision: Union[str, None] = 'e8b0d2f4a6c9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # The (company_id, serial_number) unique index treats NULLs as distinct,
    # so several assets may have no serial number.
    op.alter_column('assets', 'serial_number', existing_type=sa.String(length=100), nullable=True)


def downgrade() -> None:
    op.execute("UPDATE assets SET serial_number = id WHERE serial_number IS NULL")
    op.alter_column('assets', 'serial_number', existing_type=sa.String(length=100), nullable=False)
