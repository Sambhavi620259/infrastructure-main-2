"""asset_requests: processed_by and processed_at

Revision ID: a1d4e6f8b9c0
Revises: f7c3d8a1b2e4
Create Date: 2026-10-11 21:30:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'a1d4e6f8b9c0'
down_revision: Union[str, None] = 'f7c3d8a1b2e4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('asset_requests', sa.Column('processed_by', sa.String(), nullable=True))
    op.add_column('asset_requests', sa.Column('processed_at', sa.DateTime(), nullable=True))
    op.create_foreign_key('fk_asset_requests_processed_by', 'asset_requests', 'users', ['processed_by'], ['id'])
    op.create_index(op.f('ix_asset_requests_processed_by'), 'asset_requests', ['processed_by'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_asset_requests_processed_by'), table_name='asset_requests')
    op.drop_constraint('fk_asset_requests_processed_by', 'asset_requests', type_='foreignkey')
    op.drop_column('asset_requests', 'processed_at')
    op.drop_column('asset_requests', 'processed_by')
