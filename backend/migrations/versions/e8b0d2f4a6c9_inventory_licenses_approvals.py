"""Inventory receipts and movements, software licenses and seat history, approval policies, optional asset tag

Revision ID: e8b0d2f4a6c9
Revises: d7a9c1e3f5b8
Create Date: 2026-10-13 16:00:00.000000
"""
import uuid
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'e8b0d2f4a6c9'
down_revision: Union[str, None] = 'd7a9c1e3f5b8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()

    # --- Stock receipts and movements -------------------------------------
    op.add_column('purchase_orders', sa.Column('created_by', sa.String(), sa.ForeignKey('users.id'), nullable=True))
    op.create_table(
        'stock_receipts',
        sa.Column('id', sa.String(), primary_key=True),
        sa.Column('company_id', sa.String(), sa.ForeignKey('companies.id'), nullable=False, index=True),
        sa.Column('purchase_order_id', sa.String(), sa.ForeignKey('purchase_orders.id'), nullable=False, index=True),
        sa.Column('category', sa.String(length=100), nullable=False),
        sa.Column('brand', sa.String(length=100), nullable=True),
        sa.Column('model', sa.String(length=100), nullable=True),
        sa.Column('specifications', sa.Text(), nullable=True),
        sa.Column('quantity', sa.Integer(), nullable=False),
        sa.Column('unit_cost', sa.Numeric(12, 2), nullable=False, server_default='0'),
        sa.Column('location', sa.String(length=100), nullable=True),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('received_by', sa.String(), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('received_at', sa.DateTime(), nullable=True),
    )
    op.create_table(
        'stock_movements',
        sa.Column('id', sa.String(), primary_key=True),
        sa.Column('company_id', sa.String(), sa.ForeignKey('companies.id'), nullable=False, index=True),
        sa.Column('movement_type', sa.String(length=20), nullable=False, index=True),
        sa.Column('item_kind', sa.String(length=20), nullable=False),
        sa.Column('asset_id', sa.String(), sa.ForeignKey('assets.id'), nullable=True, index=True),
        sa.Column('inventory_item_id', sa.String(), sa.ForeignKey('inventory_items.id'), nullable=True, index=True),
        sa.Column('receipt_id', sa.String(), sa.ForeignKey('stock_receipts.id'), nullable=True),
        sa.Column('purchase_order_id', sa.String(), sa.ForeignKey('purchase_orders.id'), nullable=True),
        sa.Column('quantity', sa.Integer(), nullable=False, server_default='1'),
        sa.Column('from_location', sa.String(length=100), nullable=True),
        sa.Column('to_location', sa.String(length=100), nullable=True),
        sa.Column('reason', sa.Text(), nullable=True),
        sa.Column('reference', sa.String(length=64), nullable=True),
        sa.Column('performed_by', sa.String(), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True, index=True),
    )
    op.create_index('uix_company_movement_reference', 'stock_movements', ['company_id', 'reference'], unique=True)

    # --- Assets: optional tag, specifications, receipt link, one active holder ---
    op.alter_column('assets', 'asset_tag', existing_type=sa.String(length=100), nullable=True)
    op.add_column('assets', sa.Column('specifications', sa.Text(), nullable=True))
    op.add_column('assets', sa.Column('receipt_id', sa.String(), sa.ForeignKey('stock_receipts.id'), nullable=True))
    op.create_index('ix_assets_receipt_id', 'assets', ['receipt_id'])
    # Keep only the newest active assignment per asset before enforcing uniqueness.
    bind.execute(sa.text("""
        UPDATE asset_assignments SET is_active = false, returned_at = COALESCE(returned_at, assigned_at)
        WHERE is_active AND id NOT IN (
            SELECT DISTINCT ON (asset_id) id FROM asset_assignments
            WHERE is_active ORDER BY asset_id, assigned_at DESC
        )
    """)) if bind.dialect.name == "postgresql" else None
    op.create_index('uix_asset_active_assignment', 'asset_assignments', ['asset_id'], unique=True,
                    postgresql_where=sa.text('is_active'), sqlite_where=sa.text('is_active'))

    # --- Software: licenses and seat history --------------------------------
    op.add_column('software', sa.Column('created_at', sa.DateTime(), nullable=True))
    op.create_table(
        'software_licenses',
        sa.Column('id', sa.String(), primary_key=True),
        sa.Column('company_id', sa.String(), sa.ForeignKey('companies.id'), nullable=False, index=True),
        sa.Column('software_id', sa.String(), sa.ForeignKey('software.id'), nullable=False, index=True),
        sa.Column('license_type', sa.String(length=50), nullable=False, server_default='PERPETUAL'),
        sa.Column('license_number', sa.String(length=255), nullable=True),
        sa.Column('seats', sa.Integer(), nullable=False),
        sa.Column('purchase_date', sa.DateTime(), nullable=True),
        sa.Column('expiry_date', sa.DateTime(), nullable=True),
        sa.Column('renewal_date', sa.DateTime(), nullable=True),
        sa.Column('cost', sa.Numeric(12, 2), nullable=False, server_default='0'),
        sa.Column('vendor_id', sa.String(), sa.ForeignKey('vendors.id'), nullable=True),
        sa.Column('purchase_order_id', sa.String(), sa.ForeignKey('purchase_orders.id'), nullable=True),
        sa.Column('status', sa.String(length=20), nullable=False, server_default='ACTIVE'),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('created_by', sa.String(), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
    )
    op.create_index('uix_company_license_number', 'software_licenses', ['company_id', 'license_number'], unique=True)
    op.add_column('license_assignments', sa.Column('license_id', sa.String(), sa.ForeignKey('software_licenses.id'), nullable=True))
    op.add_column('license_assignments', sa.Column('asset_id', sa.String(), sa.ForeignKey('assets.id'), nullable=True))
    op.add_column('license_assignments', sa.Column('assigned_by', sa.String(), sa.ForeignKey('users.id'), nullable=True))
    op.add_column('license_assignments', sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.true()))
    op.add_column('license_assignments', sa.Column('released_at', sa.DateTime(), nullable=True))
    op.add_column('license_assignments', sa.Column('released_by', sa.String(), sa.ForeignKey('users.id'), nullable=True))
    op.create_index('ix_license_assignments_license_id', 'license_assignments', ['license_id'])

    # Existing products: their seats, cost, expiry and type become their first license.
    products = bind.execute(sa.text(
        "SELECT id, company_id, license_type, total_licenses, cost, expiry_date FROM software"
    )).fetchall()
    for product_id, company_id, license_type, total, cost, expiry in products:
        used = bind.execute(sa.text("SELECT COUNT(*) FROM license_assignments WHERE software_id = :s"),
                            {"s": product_id}).scalar() or 0
        license_id = str(uuid.uuid4())
        bind.execute(sa.text("""
            INSERT INTO software_licenses (id, company_id, software_id, license_type, seats, expiry_date, cost, status)
            VALUES (:id, :company, :software, :type, :seats, :expiry, :cost, 'ACTIVE')
        """), {"id": license_id, "company": company_id, "software": product_id,
               "type": license_type or "PERPETUAL", "seats": max(total or 0, used, 1),
               "expiry": expiry, "cost": cost or 0})
        bind.execute(sa.text("UPDATE license_assignments SET license_id = :l WHERE software_id = :s"),
                     {"l": license_id, "s": product_id})
    op.create_index('uix_license_user_active', 'license_assignments', ['license_id', 'user_id'], unique=True,
                    postgresql_where=sa.text('is_active'), sqlite_where=sa.text('is_active'))

    # --- Tickets: software access and returns ----------------------------------
    op.add_column('asset_requests', sa.Column('software_id', sa.String(), sa.ForeignKey('software.id'), nullable=True))
    op.add_column('asset_requests', sa.Column('license_assignment_id', sa.String(),
                                              sa.ForeignKey('license_assignments.id'), nullable=True))
    op.add_column('asset_requests', sa.Column('return_condition', sa.String(length=30), nullable=True))
    op.create_index('ix_asset_requests_software_id', 'asset_requests', ['software_id'])

    # --- Approval policies --------------------------------------------------------
    op.create_table(
        'approval_policies',
        sa.Column('id', sa.String(), primary_key=True),
        sa.Column('company_id', sa.String(), sa.ForeignKey('companies.id'), nullable=False, index=True),
        sa.Column('request_type', sa.String(length=30), nullable=False),
        sa.Column('approver_roles', sa.JSON(), nullable=False),
        sa.Column('allow_self_approval', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('updated_by', sa.String(), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
    )
    op.create_index('uix_company_policy_type', 'approval_policies', ['company_id', 'request_type'], unique=True)


def downgrade() -> None:
    op.drop_index('uix_company_policy_type', table_name='approval_policies')
    op.drop_table('approval_policies')
    op.drop_index('ix_asset_requests_software_id', table_name='asset_requests')
    for column in ('return_condition', 'license_assignment_id', 'software_id'):
        op.drop_column('asset_requests', column)
    op.drop_index('uix_license_user_active', table_name='license_assignments')
    op.drop_index('ix_license_assignments_license_id', table_name='license_assignments')
    # Released seats did not exist before; drop them so old code does not count them.
    op.execute("DELETE FROM license_assignments WHERE NOT is_active")
    for column in ('released_by', 'released_at', 'is_active', 'assigned_by', 'asset_id', 'license_id'):
        op.drop_column('license_assignments', column)
    op.drop_index('uix_company_license_number', table_name='software_licenses')
    op.drop_table('software_licenses')
    op.drop_column('software', 'created_at')
    op.drop_index('uix_asset_active_assignment', table_name='asset_assignments')
    op.drop_index('ix_assets_receipt_id', table_name='assets')
    op.drop_column('assets', 'receipt_id')
    op.drop_column('assets', 'specifications')
    # Untagged assets get their id as tag so the old NOT NULL rule can return.
    op.execute("UPDATE assets SET asset_tag = id WHERE asset_tag IS NULL")
    op.alter_column('assets', 'asset_tag', existing_type=sa.String(length=100), nullable=False)
    op.drop_index('uix_company_movement_reference', table_name='stock_movements')
    op.drop_table('stock_movements')
    op.drop_table('stock_receipts')
    op.drop_column('purchase_orders', 'created_by')
