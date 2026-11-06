"""More than one license on a hardware asset

Revision ID: b2c4d6e8f0a1
Revises: a1b3c5d7e9f2
Create Date: 2026-11-06 10:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'b2c4d6e8f0a1'
down_revision: Union[str, None] = 'a1b3c5d7e9f2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('assets', sa.Column('extra_licenses', sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column('assets', 'extra_licenses')
