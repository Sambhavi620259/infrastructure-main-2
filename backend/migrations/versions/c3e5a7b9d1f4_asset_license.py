"""assets: optional license on a hardware device (e.g. OEM operating system key)

Revision ID: c3e5a7b9d1f4
Revises: b2d4f6a8c0e3
Create Date: 2026-10-16 18:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'c3e5a7b9d1f4'
down_revision: Union[str, None] = 'b2d4f6a8c0e3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('assets', sa.Column('license_type', sa.String(length=30), nullable=True))
    op.add_column('assets', sa.Column('license_number', sa.String(length=255), nullable=True))
    op.add_column('assets', sa.Column('license_expiry', sa.DateTime(), nullable=True))


def downgrade() -> None:
    op.drop_column('assets', 'license_expiry')
    op.drop_column('assets', 'license_number')
    op.drop_column('assets', 'license_type')
