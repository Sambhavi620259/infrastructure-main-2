"""invitations: agent_id and full_name; users: agent_id

Revision ID: d3a8f5e17c62
Revises: c7e2a91f4b3d
Create Date: 2026-10-11 16:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'd3a8f5e17c62'
down_revision: Union[str, None] = 'c7e2a91f4b3d'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('invitation_tokens', sa.Column('agent_id', sa.String(length=32), nullable=True))
    op.add_column('invitation_tokens', sa.Column('full_name', sa.String(length=150), nullable=True))
    op.create_index(op.f('ix_invitation_tokens_agent_id'), 'invitation_tokens', ['agent_id'], unique=True)
    op.add_column('users', sa.Column('agent_id', sa.String(length=32), nullable=True))
    op.create_index(op.f('ix_users_agent_id'), 'users', ['agent_id'], unique=True)


def downgrade() -> None:
    op.drop_index(op.f('ix_users_agent_id'), table_name='users')
    op.drop_column('users', 'agent_id')
    op.drop_index(op.f('ix_invitation_tokens_agent_id'), table_name='invitation_tokens')
    op.drop_column('invitation_tokens', 'full_name')
    op.drop_column('invitation_tokens', 'agent_id')
