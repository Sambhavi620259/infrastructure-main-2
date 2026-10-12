"""platform_settings table (holds the hashed Super Admin key)

Revision ID: b8e2f4a6c1d3
Revises: a1d4e6f8b9c0
Create Date: 2026-10-11 22:30:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'b8e2f4a6c1d3'
down_revision: Union[str, None] = 'a1d4e6f8b9c0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('platform_settings',
    sa.Column('name', sa.String(length=100), nullable=False),
    sa.Column('value', sa.Text(), nullable=False),
    sa.Column('updated_by', sa.String(), nullable=True),
    sa.Column('updated_at', sa.DateTime(), nullable=True),
    sa.ForeignKeyConstraint(['updated_by'], ['users.id'], ),
    sa.PrimaryKeyConstraint('name')
    )


def downgrade() -> None:
    op.drop_table('platform_settings')
