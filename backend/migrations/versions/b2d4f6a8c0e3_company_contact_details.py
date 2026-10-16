"""companies: contact email, phone, address and office location pin

Revision ID: b2d4f6a8c0e3
Revises: a1c3e5b7d9f2
Create Date: 2026-10-16 15:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'b2d4f6a8c0e3'
down_revision: Union[str, None] = 'a1c3e5b7d9f2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('companies', sa.Column('contact_email', sa.String(length=255), nullable=True))
    op.add_column('companies', sa.Column('contact_phone', sa.String(length=50), nullable=True))
    op.add_column('companies', sa.Column('address', sa.Text(), nullable=True))
    op.add_column('companies', sa.Column('latitude', sa.Float(), nullable=True))
    op.add_column('companies', sa.Column('longitude', sa.Float(), nullable=True))


def downgrade() -> None:
    for column in ('longitude', 'latitude', 'address', 'contact_phone', 'contact_email'):
        op.drop_column('companies', column)
