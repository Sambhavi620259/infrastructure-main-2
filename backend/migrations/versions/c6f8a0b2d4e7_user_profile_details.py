"""users: profile details (phone, job title, employee ID, bio, own organization name/ID, photo)

Revision ID: c6f8a0b2d4e7
Revises: b3e5f7a9c1d4
Create Date: 2026-10-13 12:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'c6f8a0b2d4e7'
down_revision: Union[str, None] = 'b3e5f7a9c1d4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

COLUMNS = (
    ('phone', sa.String(length=30)),
    ('job_title', sa.String(length=100)),
    ('employee_code', sa.String(length=50)),
    ('bio', sa.Text()),
    ('profile_org_name', sa.String(length=150)),
    ('profile_org_code', sa.String(length=60)),
    ('avatar', sa.Text()),
)


def upgrade() -> None:
    for name, column_type in COLUMNS:
        op.add_column('users', sa.Column(name, column_type, nullable=True))


def downgrade() -> None:
    for name, _ in reversed(COLUMNS):
        op.drop_column('users', name)
