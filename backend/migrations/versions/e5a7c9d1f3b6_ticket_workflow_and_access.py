"""Ticket workflow (statuses, priority, comments, files, history, approvals),
reserved hardware, software approval/deployment, and access management

Revision ID: e5a7c9d1f3b6
Revises: d4f6b8c0e2a5
Create Date: 2026-10-17 10:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'e5a7c9d1f3b6'
down_revision: Union[str, None] = 'd4f6b8c0e2a5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

NEW_STATUSES = ("UNDER_REVIEW", "PENDING_APPROVAL", "WAITING_INVENTORY", "WAITING_LICENSE", "WAITING_USER", "CLOSED")


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        # A new enum value cannot be used in the transaction that adds it.
        with op.get_context().autocommit_block():
            for value in NEW_STATUSES:
                op.execute(f"ALTER TYPE requeststatusenum ADD VALUE IF NOT EXISTS '{value}'")

    op.create_table(
        'access_resources',
        sa.Column('id', sa.String(), primary_key=True),
        sa.Column('company_id', sa.String(), sa.ForeignKey('companies.id'), nullable=False, index=True),
        sa.Column('name', sa.String(length=150), nullable=False),
        sa.Column('resource_type', sa.String(length=30), nullable=False, server_default='APPLICATION'),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('owner_id', sa.String(), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('access_levels', sa.JSON(), nullable=False),
        sa.Column('privileged_levels', sa.JSON(), nullable=False),
        sa.Column('max_days', sa.Integer(), nullable=True),
        sa.Column('status', sa.String(length=20), nullable=False, server_default='ACTIVE'),
        sa.Column('created_by', sa.String(), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
    )
    op.create_index('uix_access_resource_name', 'access_resources', ['company_id', 'name'], unique=True)

    op.create_table(
        'access_grants',
        sa.Column('id', sa.String(), primary_key=True),
        sa.Column('company_id', sa.String(), sa.ForeignKey('companies.id'), nullable=False, index=True),
        sa.Column('resource_id', sa.String(), sa.ForeignKey('access_resources.id'), nullable=False, index=True),
        sa.Column('user_id', sa.String(), sa.ForeignKey('users.id'), nullable=False, index=True),
        sa.Column('access_level', sa.String(length=50), nullable=False),
        sa.Column('ticket_id', sa.String(), sa.ForeignKey('asset_requests.id'), nullable=True),
        sa.Column('granted_by', sa.String(), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('granted_at', sa.DateTime(), nullable=True),
        sa.Column('expires_at', sa.DateTime(), nullable=True),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column('revoked_at', sa.DateTime(), nullable=True),
        sa.Column('revoked_by', sa.String(), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('revoke_reason', sa.Text(), nullable=True),
    )
    op.create_index('uix_access_grant_active', 'access_grants', ['resource_id', 'user_id'], unique=True,
                    postgresql_where=sa.text('is_active'), sqlite_where=sa.text('is_active'))

    for name, columns in {
        'ticket_comments': [
            sa.Column('author_id', sa.String(), sa.ForeignKey('users.id'), nullable=False),
            sa.Column('body', sa.Text(), nullable=False),
            sa.Column('internal', sa.Boolean(), nullable=False, server_default=sa.false()),
        ],
        'ticket_attachments': [
            sa.Column('uploaded_by', sa.String(), sa.ForeignKey('users.id'), nullable=False),
            sa.Column('filename', sa.String(length=255), nullable=False),
            sa.Column('content_type', sa.String(length=100), nullable=False),
            sa.Column('size', sa.Integer(), nullable=False),
            sa.Column('data', sa.LargeBinary(), nullable=False),
        ],
        'ticket_events': [
            sa.Column('actor_id', sa.String(), sa.ForeignKey('users.id'), nullable=True),
            sa.Column('action', sa.String(length=40), nullable=False),
            sa.Column('from_status', sa.String(length=30), nullable=True),
            sa.Column('to_status', sa.String(length=30), nullable=True),
            sa.Column('note', sa.Text(), nullable=True),
            sa.Column('internal', sa.Boolean(), nullable=False, server_default=sa.false()),
        ],
        'ticket_approvals': [
            sa.Column('approver_id', sa.String(), sa.ForeignKey('users.id'), nullable=False),
            sa.Column('kind', sa.String(length=20), nullable=False),
            sa.Column('decision', sa.String(length=20), nullable=False),
            sa.Column('note', sa.Text(), nullable=True),
        ],
    }.items():
        op.create_table(
            name,
            sa.Column('id', sa.String(), primary_key=True),
            sa.Column('company_id', sa.String(), sa.ForeignKey('companies.id'), nullable=False, index=True),
            sa.Column('ticket_id', sa.String(), sa.ForeignKey('asset_requests.id'), nullable=False, index=True),
            *columns,
            sa.Column('created_at', sa.DateTime(), nullable=True),
        )
    op.create_index('ix_ticket_events_created_at', 'ticket_events', ['created_at'])

    with op.batch_alter_table('asset_requests') as batch:
        batch.add_column(sa.Column('ticket_no', sa.Integer(), nullable=True))
        batch.add_column(sa.Column('priority', sa.String(length=10), nullable=False, server_default='MEDIUM'))
        batch.add_column(sa.Column('required_date', sa.DateTime(), nullable=True))
        batch.add_column(sa.Column('additional_comments', sa.Text(), nullable=True))
        batch.add_column(sa.Column('assignee_id', sa.String(), nullable=True))
        batch.add_column(sa.Column('expected_date', sa.DateTime(), nullable=True))
        batch.add_column(sa.Column('procurement_note', sa.Text(), nullable=True))
        batch.add_column(sa.Column('resolved_at', sa.DateTime(), nullable=True))
        batch.add_column(sa.Column('closed_at', sa.DateTime(), nullable=True))
        batch.add_column(sa.Column('reopen_count', sa.Integer(), nullable=False, server_default='0'))
        batch.add_column(sa.Column('access_resource_id', sa.String(), nullable=True))
        batch.add_column(sa.Column('access_level', sa.String(length=50), nullable=True))
        batch.add_column(sa.Column('access_until', sa.DateTime(), nullable=True))
        batch.add_column(sa.Column('access_grant_id', sa.String(), nullable=True))
        batch.create_foreign_key('fk_ticket_assignee', 'users', ['assignee_id'], ['id'])
        batch.create_foreign_key('fk_ticket_access_resource', 'access_resources', ['access_resource_id'], ['id'])
        batch.create_foreign_key('fk_ticket_access_grant', 'access_grants', ['access_grant_id'], ['id'])
    op.create_index('ix_asset_requests_assignee_id', 'asset_requests', ['assignee_id'])
    op.create_index('ix_asset_requests_access_resource_id', 'asset_requests', ['access_resource_id'])

    # Number existing tickets per organization, oldest first, then make numbers unique.
    op.execute("""
        UPDATE asset_requests SET ticket_no = numbered.n
        FROM (SELECT id, ROW_NUMBER() OVER (PARTITION BY company_id ORDER BY created_at, id) AS n
              FROM asset_requests) AS numbered
        WHERE asset_requests.id = numbered.id
    """) if bind.dialect.name == "postgresql" else op.execute("""
        UPDATE asset_requests SET ticket_no = (
            SELECT COUNT(*) FROM asset_requests AS other
            WHERE other.company_id = asset_requests.company_id
              AND (other.created_at < asset_requests.created_at
                   OR (other.created_at = asset_requests.created_at AND other.id <= asset_requests.id)))
    """)
    op.create_index('uix_company_ticket_no', 'asset_requests', ['company_id', 'ticket_no'], unique=True)
    # Tickets someone picked up but nobody had approved yet are now "under review";
    # resolved tickets keep FULFILLED (shown as Resolved) with their resolution time.
    op.execute("UPDATE asset_requests SET status = 'UNDER_REVIEW' WHERE status = 'IN_PROGRESS'")
    op.execute("UPDATE asset_requests SET resolved_at = processed_at WHERE status = 'FULFILLED'")

    op.add_column('software', sa.Column('approval_required', sa.Boolean(), nullable=False, server_default=sa.true()))
    with op.batch_alter_table('license_assignments') as batch:
        batch.add_column(sa.Column('deployment_status', sa.String(length=20), nullable=True))
        batch.add_column(sa.Column('deployment_note', sa.Text(), nullable=True))
        batch.add_column(sa.Column('deployment_updated_at', sa.DateTime(), nullable=True))
        batch.add_column(sa.Column('deployment_updated_by', sa.String(), nullable=True))
        batch.create_foreign_key('fk_seat_deployment_by', 'users', ['deployment_updated_by'], ['id'])


def downgrade() -> None:
    with op.batch_alter_table('license_assignments') as batch:
        batch.drop_constraint('fk_seat_deployment_by', type_='foreignkey')
        for column in ('deployment_updated_by', 'deployment_updated_at', 'deployment_note', 'deployment_status'):
            batch.drop_column(column)
    op.drop_column('software', 'approval_required')
    # PostgreSQL cannot drop enum values; map rows back to the old statuses.
    op.execute("UPDATE asset_requests SET status = 'IN_PROGRESS' WHERE status IN "
                "('UNDER_REVIEW', 'PENDING_APPROVAL', 'WAITING_USER')")
    op.execute("UPDATE asset_requests SET status = 'APPROVED' WHERE status IN ('WAITING_INVENTORY', 'WAITING_LICENSE')")
    op.execute("UPDATE asset_requests SET status = 'FULFILLED' WHERE status = 'CLOSED'")
    op.drop_index('uix_company_ticket_no', table_name='asset_requests')
    op.drop_index('ix_asset_requests_access_resource_id', table_name='asset_requests')
    op.drop_index('ix_asset_requests_assignee_id', table_name='asset_requests')
    with op.batch_alter_table('asset_requests') as batch:
        batch.drop_constraint('fk_ticket_access_grant', type_='foreignkey')
        batch.drop_constraint('fk_ticket_access_resource', type_='foreignkey')
        batch.drop_constraint('fk_ticket_assignee', type_='foreignkey')
        for column in ('access_grant_id', 'access_until', 'access_level', 'access_resource_id', 'reopen_count',
                       'closed_at', 'resolved_at', 'procurement_note', 'expected_date', 'assignee_id',
                       'additional_comments', 'required_date', 'priority', 'ticket_no'):
            batch.drop_column(column)
    for name in ('ticket_approvals', 'ticket_events', 'ticket_attachments', 'ticket_comments'):
        op.drop_table(name)
    op.drop_index('uix_access_grant_active', table_name='access_grants')
    op.drop_table('access_grants')
    op.drop_index('uix_access_resource_name', table_name='access_resources')
    op.drop_table('access_resources')
