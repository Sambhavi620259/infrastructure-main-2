"""add warranty_claims table

Revision ID: c7e2a91f4b3d
Revises: b41f7c2d9e10
Create Date: 2026-10-11 15:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'c7e2a91f4b3d'
down_revision: Union[str, None] = 'b41f7c2d9e10'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('warranty_claims',
    sa.Column('id', sa.String(), nullable=False),
    sa.Column('company_id', sa.String(), nullable=False),
    sa.Column('asset_id', sa.String(), nullable=False),
    sa.Column('claim_number', sa.String(length=100), nullable=True),
    sa.Column('issue_description', sa.Text(), nullable=False),
    sa.Column('status', sa.String(length=50), nullable=False),
    sa.Column('submitted_by', sa.String(), nullable=False),
    sa.Column('resolution_notes', sa.Text(), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=True),
    sa.Column('updated_at', sa.DateTime(), nullable=True),
    sa.ForeignKeyConstraint(['asset_id'], ['assets.id'], ),
    sa.ForeignKeyConstraint(['company_id'], ['companies.id'], ),
    sa.ForeignKeyConstraint(['submitted_by'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_warranty_claims_asset_id'), 'warranty_claims', ['asset_id'], unique=False)
    op.create_index(op.f('ix_warranty_claims_company_id'), 'warranty_claims', ['company_id'], unique=False)
    op.create_index(op.f('ix_warranty_claims_created_at'), 'warranty_claims', ['created_at'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_warranty_claims_created_at'), table_name='warranty_claims')
    op.drop_index(op.f('ix_warranty_claims_company_id'), table_name='warranty_claims')
    op.drop_index(op.f('ix_warranty_claims_asset_id'), table_name='warranty_claims')
    op.drop_table('warranty_claims')
