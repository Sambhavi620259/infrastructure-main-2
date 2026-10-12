"""discovered_devices: os_name, serial_number, cpu_model, ram_gb, last_seen

Revision ID: e6b8c0d2f4a1
Revises: d5a7b9c1e3f2
Create Date: 2026-10-12 12:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'e6b8c0d2f4a1'
down_revision: Union[str, None] = 'd5a7b9c1e3f2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('discovered_devices', sa.Column('os_name', sa.String(length=150), nullable=True))
    op.add_column('discovered_devices', sa.Column('serial_number', sa.String(length=100), nullable=True))
    op.add_column('discovered_devices', sa.Column('cpu_model', sa.String(length=150), nullable=True))
    op.add_column('discovered_devices', sa.Column('ram_gb', sa.Numeric(precision=8, scale=2), nullable=True))
    op.add_column('discovered_devices', sa.Column('last_seen', sa.DateTime(), nullable=True))


def downgrade() -> None:
    for column in ('last_seen', 'ram_gb', 'cpu_model', 'serial_number', 'os_name'):
        op.drop_column('discovered_devices', column)
