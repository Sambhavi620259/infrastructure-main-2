"""audit_sessions: rename created_at to started_at, add completed_at

Revision ID: b41f7c2d9e10
Revises: a873df22c6a7
Create Date: 2026-10-11 14:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'b41f7c2d9e10'
down_revision: Union[str, None] = 'a873df22c6a7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column('audit_sessions', 'created_at', new_column_name='started_at')
    op.add_column('audit_sessions', sa.Column('completed_at', sa.DateTime(), nullable=True))


def downgrade() -> None:
    op.drop_column('audit_sessions', 'completed_at')
    op.alter_column('audit_sessions', 'started_at', new_column_name='created_at')
