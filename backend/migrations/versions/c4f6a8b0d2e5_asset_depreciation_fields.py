"""assets: depreciation_method, useful_life_years, salvage_value, current_value

Revision ID: c4f6a8b0d2e5
Revises: b8e2f4a6c1d3
Create Date: 2026-10-12 10:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'c4f6a8b0d2e5'
down_revision: Union[str, None] = 'b8e2f4a6c1d3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('assets', sa.Column('depreciation_method', sa.String(length=30), nullable=False, server_default='STRAIGHT_LINE'))
    op.add_column('assets', sa.Column('useful_life_years', sa.Integer(), nullable=False, server_default='5'))
    op.add_column('assets', sa.Column('salvage_value', sa.Numeric(precision=12, scale=2), nullable=False, server_default='0'))
    op.add_column('assets', sa.Column('current_value', sa.Numeric(precision=12, scale=2), nullable=True))


def downgrade() -> None:
    op.drop_column('assets', 'current_value')
    op.drop_column('assets', 'salvage_value')
    op.drop_column('assets', 'useful_life_years')
    op.drop_column('assets', 'depreciation_method')
