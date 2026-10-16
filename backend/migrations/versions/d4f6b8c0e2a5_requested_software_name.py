"""asset_requests: software asked for by name when it is not registered yet

Revision ID: d4f6b8c0e2a5
Revises: c3e5a7b9d1f4
Create Date: 2026-10-16 19:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'd4f6b8c0e2a5'
down_revision: Union[str, None] = 'c3e5a7b9d1f4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('asset_requests', sa.Column('requested_software_name', sa.String(length=150), nullable=True))


def downgrade() -> None:
    op.drop_column('asset_requests', 'requested_software_name')
