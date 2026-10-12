"""add report_runs table

Revision ID: e5b1c9d2a4f7
Revises: d3a8f5e17c62
Create Date: 2026-10-11 17:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'e5b1c9d2a4f7'
down_revision: Union[str, None] = 'd3a8f5e17c62'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('report_runs',
    sa.Column('id', sa.String(), nullable=False),
    sa.Column('company_id', sa.String(), nullable=False),
    sa.Column('report_config_id', sa.String(), nullable=True),
    sa.Column('name', sa.String(length=150), nullable=False),
    sa.Column('report_type', sa.String(length=50), nullable=False),
    sa.Column('filters_json', sa.Text(), nullable=True),
    sa.Column('format', sa.String(length=10), nullable=False),
    sa.Column('row_count', sa.Integer(), nullable=False),
    sa.Column('content', sa.Text(), nullable=False),
    sa.Column('generated_by', sa.String(), nullable=False),
    sa.Column('created_at', sa.DateTime(), nullable=True),
    sa.ForeignKeyConstraint(['company_id'], ['companies.id'], ),
    sa.ForeignKeyConstraint(['report_config_id'], ['report_configs.id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['generated_by'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_report_runs_company_id'), 'report_runs', ['company_id'], unique=False)
    op.create_index(op.f('ix_report_runs_created_at'), 'report_runs', ['created_at'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_report_runs_created_at'), table_name='report_runs')
    op.drop_index(op.f('ix_report_runs_company_id'), table_name='report_runs')
    op.drop_table('report_runs')
