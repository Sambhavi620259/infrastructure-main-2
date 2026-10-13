"""inventory_requests: users request stock, admins approve and issue it

Revision ID: b3e5f7a9c1d4
Revises: a9d1e3f5b7c2
Create Date: 2026-10-13 10:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'b3e5f7a9c1d4'
down_revision: Union[str, None] = 'a9d1e3f5b7c2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'inventory_requests',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('company_id', sa.String(), nullable=False),
        sa.Column('item_id', sa.String(), nullable=False),
        sa.Column('requested_by', sa.String(), nullable=False),
        sa.Column('quantity', sa.Integer(), nullable=False),
        sa.Column('reason', sa.Text(), nullable=False),
        sa.Column('status', sa.String(length=20), nullable=False),
        sa.Column('rejection_reason', sa.Text(), nullable=True),
        sa.Column('processed_by', sa.String(), nullable=True),
        sa.Column('processed_at', sa.DateTime(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['company_id'], ['companies.id']),
        sa.ForeignKeyConstraint(['item_id'], ['inventory_items.id']),
        sa.ForeignKeyConstraint(['requested_by'], ['users.id']),
        sa.ForeignKeyConstraint(['processed_by'], ['users.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    for column in ('company_id', 'item_id', 'requested_by', 'status'):
        op.create_index(op.f(f'ix_inventory_requests_{column}'), 'inventory_requests', [column], unique=False)


def downgrade() -> None:
    for column in ('company_id', 'item_id', 'requested_by', 'status'):
        op.drop_index(op.f(f'ix_inventory_requests_{column}'), table_name='inventory_requests')
    op.drop_table('inventory_requests')
