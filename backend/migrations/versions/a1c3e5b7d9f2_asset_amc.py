"""assets: optional AMC (annual maintenance contract) details

Revision ID: a1c3e5b7d9f2
Revises: f9c1e3a5b7d0
Create Date: 2026-10-16 12:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'a1c3e5b7d9f2'
down_revision: Union[str, None] = 'f9c1e3a5b7d0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('assets', sa.Column('amc_vendor_id', sa.String(), sa.ForeignKey('vendors.id'), nullable=True))
    op.add_column('assets', sa.Column('amc_start', sa.DateTime(), nullable=True))
    op.add_column('assets', sa.Column('amc_end', sa.DateTime(), nullable=True))
    op.add_column('assets', sa.Column('amc_cost', sa.Numeric(12, 2), nullable=True))


def downgrade() -> None:
    op.drop_column('assets', 'amc_cost')
    op.drop_column('assets', 'amc_end')
    op.drop_column('assets', 'amc_start')
    op.drop_column('assets', 'amc_vendor_id')
