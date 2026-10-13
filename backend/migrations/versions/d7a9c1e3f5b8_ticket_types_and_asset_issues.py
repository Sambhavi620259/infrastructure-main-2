"""asset_requests: ticket type (REQUEST / ISSUE), the asset an issue is about, resolution note

Revision ID: d7a9c1e3f5b8
Revises: c6f8a0b2d4e7
Create Date: 2026-10-13 14:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'd7a9c1e3f5b8'
down_revision: Union[str, None] = 'c6f8a0b2d4e7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('asset_requests', sa.Column('ticket_type', sa.String(length=20), nullable=False,
                                              server_default='REQUEST'))
    op.add_column('asset_requests', sa.Column('asset_id', sa.String(), nullable=True))
    op.add_column('asset_requests', sa.Column('resolution_note', sa.Text(), nullable=True))
    op.create_foreign_key('fk_asset_requests_asset_id', 'asset_requests', 'assets', ['asset_id'], ['id'])
    op.create_index(op.f('ix_asset_requests_ticket_type'), 'asset_requests', ['ticket_type'], unique=False)
    op.create_index(op.f('ix_asset_requests_asset_id'), 'asset_requests', ['asset_id'], unique=False)
    op.alter_column('asset_requests', 'asset_category_id', existing_type=sa.String(), nullable=True)


def downgrade() -> None:
    op.execute("DELETE FROM asset_requests WHERE ticket_type = 'ISSUE'")
    op.alter_column('asset_requests', 'asset_category_id', existing_type=sa.String(), nullable=False)
    op.drop_index(op.f('ix_asset_requests_asset_id'), table_name='asset_requests')
    op.drop_index(op.f('ix_asset_requests_ticket_type'), table_name='asset_requests')
    op.drop_constraint('fk_asset_requests_asset_id', 'asset_requests', type_='foreignkey')
    op.drop_column('asset_requests', 'resolution_note')
    op.drop_column('asset_requests', 'asset_id')
    op.drop_column('asset_requests', 'ticket_type')
