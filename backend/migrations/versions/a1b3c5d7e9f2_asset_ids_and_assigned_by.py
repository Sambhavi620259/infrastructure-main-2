"""Unique Asset ID on every asset, repeatable asset numbers, and who assigned each device

Revision ID: a1b3c5d7e9f2
Revises: e5a7c9d1f3b6
Create Date: 2026-10-24 14:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'a1b3c5d7e9f2'
down_revision: Union[str, None] = 'e5a7c9d1f3b6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('assets', sa.Column('asset_code', sa.String(length=20), nullable=True))
    bind = op.get_bind()
    # AST-000001... per organization, oldest first.
    rows = bind.execute(sa.text("SELECT id, company_id FROM assets ORDER BY company_id, created_at, id")).fetchall()
    counters: dict = {}
    for asset_id, company_id in rows:
        counters[company_id] = counters.get(company_id, 0) + 1
        bind.execute(sa.text("UPDATE assets SET asset_code = :c WHERE id = :i"),
                     {"c": f"AST-{counters[company_id]:06d}", "i": asset_id})
    with op.batch_alter_table('assets') as batch:
        batch.alter_column('asset_code', existing_type=sa.String(length=20), nullable=False)
    op.create_index('uix_company_asset_code', 'assets', ['company_id', 'asset_code'], unique=True)
    # The asset number may now repeat.
    op.drop_index('uix_company_asset_tag', table_name='assets')

    op.add_column('asset_assignments', sa.Column('assigned_by', sa.String(), nullable=True))
    op.create_foreign_key('fk_asset_assignments_assigned_by', 'asset_assignments', 'users', ['assigned_by'], ['id'])
    # Best effort for existing rows: whoever recorded the assignment in the asset's history.
    op.execute("""
        UPDATE asset_assignments SET assigned_by = (
            SELECT l.performed_by FROM asset_lifecycle l
            WHERE l.asset_id = asset_assignments.asset_id AND l.action IN ('ASSIGNED', 'ASSIGNED_VIA_REQUEST')
            ORDER BY l.timestamp DESC LIMIT 1)
    """)


def downgrade() -> None:
    op.drop_constraint('fk_asset_assignments_assigned_by', 'asset_assignments', type_='foreignkey')
    op.drop_column('asset_assignments', 'assigned_by')
    op.create_index('uix_company_asset_tag', 'assets', ['company_id', 'asset_tag'], unique=True)
    op.drop_index('uix_company_asset_code', table_name='assets')
    op.drop_column('assets', 'asset_code')
