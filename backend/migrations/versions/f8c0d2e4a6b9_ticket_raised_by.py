"""asset_requests.raised_by (who created the ticket)

Revision ID: f8c0d2e4a6b9
Revises: e6b8c0d2f4a1
Create Date: 2026-10-12 13:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'f8c0d2e4a6b9'
down_revision: Union[str, None] = 'e6b8c0d2f4a1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('asset_requests', sa.Column('raised_by', sa.String(), nullable=True))
    op.create_foreign_key('fk_asset_requests_raised_by', 'asset_requests', 'users', ['raised_by'], ['id'])
    op.create_index(op.f('ix_asset_requests_raised_by'), 'asset_requests', ['raised_by'], unique=False)
    # Existing tickets: the requester is the best record of who raised them.
    op.execute("UPDATE asset_requests SET raised_by = requested_by WHERE raised_by IS NULL")


def downgrade() -> None:
    op.drop_index(op.f('ix_asset_requests_raised_by'), table_name='asset_requests')
    op.drop_constraint('fk_asset_requests_raised_by', 'asset_requests', type_='foreignkey')
    op.drop_column('asset_requests', 'raised_by')
