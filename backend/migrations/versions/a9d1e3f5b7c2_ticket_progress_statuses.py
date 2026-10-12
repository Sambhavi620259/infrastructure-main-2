"""Ticket progress statuses: IN_PROGRESS and FULFILLED

Revision ID: a9d1e3f5b7c2
Revises: f8c0d2e4a6b9
Create Date: 2026-10-12 18:00:00.000000
"""
from typing import Sequence, Union

from alembic import op


revision: str = 'a9d1e3f5b7c2'
down_revision: Union[str, None] = 'f8c0d2e4a6b9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    if op.get_bind().dialect.name == "postgresql":
        # A new enum value cannot be used in the transaction that adds it.
        with op.get_context().autocommit_block():
            op.execute("ALTER TYPE requeststatusenum ADD VALUE IF NOT EXISTS 'IN_PROGRESS'")
            op.execute("ALTER TYPE requeststatusenum ADD VALUE IF NOT EXISTS 'FULFILLED'")
    # Until now approving a ticket handed over the asset at once: those tickets are fulfilled.
    op.execute(
        "UPDATE asset_requests SET status = 'FULFILLED' "
        "WHERE status = 'APPROVED' AND assigned_asset_id IS NOT NULL"
    )


def downgrade() -> None:
    # PostgreSQL cannot drop enum values; map the rows back to the old statuses.
    op.execute("UPDATE asset_requests SET status = 'APPROVED' WHERE status = 'FULFILLED'")
    op.execute("UPDATE asset_requests SET status = 'PENDING' WHERE status = 'IN_PROGRESS'")
