"""Implementation file: app/models/models.py"""
import uuid
from datetime import datetime
from enum import Enum as PyEnum
from sqlalchemy import (
    Column, String, DateTime, ForeignKey, Integer, JSON, Numeric, Text, Boolean, Enum, Index
)
from sqlalchemy.orm import relationship
from app.core.database import Base


def gen_uuid():
    return str(uuid.uuid4())


class PlatformRole(str, PyEnum):
    SUPER_ADMIN = "SUPER_ADMIN"
    IT_ADMIN = "IT_ADMIN"
    SUB_ADMIN = "SUB_ADMIN"
    REPORTING_USER = "REPORTING_USER"
    EMPLOYEE = "EMPLOYEE"


class AssetStatusEnum(str, PyEnum):
    IN_STOCK = "IN_STOCK"
    REQUESTED = "REQUESTED"
    ASSIGNED = "ASSIGNED"
    IN_USE = "IN_USE"
    RETURN_REQUESTED = "RETURN_REQUESTED"
    RETURNED = "RETURNED"
    IN_REPAIR = "IN_REPAIR"
    DAMAGED = "DAMAGED"
    LOST = "LOST"
    RETIRED = "RETIRED"
    DISPOSED = "DISPOSED"


class RequestStatusEnum(str, PyEnum):
    PENDING = "PENDING"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"
    CANCELLED = "CANCELLED"


# --- Core Multi-Tenant Models ---

class Company(Base):
    __tablename__ = "companies"

    id = Column(String, primary_key=True, default=gen_uuid)
    name = Column(String(150), nullable=False, unique=True)
    code = Column(String(50), nullable=False, unique=True)
    status = Column(String(20), default="ACTIVE")
    created_at = Column(DateTime, default=datetime.utcnow)

    users = relationship("User", back_populates="company", cascade="all, delete-orphan")
    subscription = relationship("Subscription", back_populates="company", uselist=False, cascade="all, delete-orphan")
    invitation_tokens = relationship("InvitationToken", back_populates="company", cascade="all, delete-orphan")


class Notification(Base):
    """An in-app message for one user, shown under the bell in the top bar."""
    __tablename__ = "notifications"

    id = Column(String, primary_key=True, default=gen_uuid)
    company_id = Column(String, ForeignKey("companies.id"), nullable=True, index=True)
    user_id = Column(String, ForeignKey("users.id"), nullable=False, index=True)
    title = Column(String(200), nullable=False)
    message = Column(Text, nullable=True)
    type = Column(String(20), default="INFO", nullable=False)
    link = Column(String(300), nullable=True)
    is_read = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)


class PlatformSetting(Base):
    """Platform-wide values, one row per name (e.g. the hashed Super Admin key)."""
    __tablename__ = "platform_settings"

    name = Column(String(100), primary_key=True)
    value = Column(Text, nullable=False)
    updated_by = Column(String, ForeignKey("users.id"), nullable=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class InvitationToken(Base):
    __tablename__ = "invitation_tokens"

    id = Column(String, primary_key=True, default=gen_uuid)
    token = Column(String(64), nullable=False, unique=True, index=True)
    # Login-style ID handed to the agent with the code, e.g. RAHULSHARMA01.
    agent_id = Column(String(32), nullable=True, unique=True, index=True)
    full_name = Column(String(150), nullable=True)
    company_id = Column(String, ForeignKey("companies.id"), nullable=False, index=True)
    created_by = Column(String, ForeignKey("users.id"), nullable=False)
    email = Column(String(255), nullable=True)
    department = Column(String(100), nullable=True)
    expires_at = Column(DateTime, nullable=False)
    used_at = Column(DateTime, nullable=True)
    used_by = Column(String, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    company = relationship("Company", back_populates="invitation_tokens")
    creator = relationship("User", foreign_keys=[created_by], back_populates="created_invitations")
    used_by_user = relationship("User", foreign_keys=[used_by], back_populates="used_invitations")


class Subscription(Base):
    __tablename__ = "subscriptions"

    id = Column(String, primary_key=True, default=gen_uuid)
    company_id = Column(String, ForeignKey("companies.id"), nullable=False, unique=True)
    plan = Column(String(50), default="ENTERPRISE")
    user_limit = Column(Integer, default=500)
    asset_limit = Column(Integer, default=2000)
    start_date = Column(DateTime, default=datetime.utcnow)
    end_date = Column(DateTime, nullable=True)
    status = Column(String(20), default="ACTIVE")

    company = relationship("Company", back_populates="subscription")


class User(Base):
    __tablename__ = "users"

    id = Column(String, primary_key=True, default=gen_uuid)
    company_id = Column(String, ForeignKey("companies.id"), nullable=True, index=True)
    department_id = Column(String, ForeignKey("departments.id"), nullable=True)
    email = Column(String(255), nullable=False, unique=True, index=True)
    hashed_password = Column(String(255), nullable=False)
    full_name = Column(String(150), nullable=False)
    # Set for IT Agents who joined through an invitation.
    agent_id = Column(String(32), nullable=True, unique=True, index=True)
    role = Column(Enum(PlatformRole), default=PlatformRole.EMPLOYEE, nullable=False)
    # Which ITAM modules a SUB_ADMIN administers, e.g. ["HAM", "SAM"].
    # The requirements define sub-admin specialisations as a scope within one
    # role, not as separate roles. Null or empty for every other role.
    modules = Column(JSON, nullable=True)
    status = Column(String(20), default="ACTIVE")
    location = Column(String(100), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    company = relationship("Company", back_populates="users")
    department = relationship("Department", back_populates="users")
    created_invitations = relationship("InvitationToken", foreign_keys="InvitationToken.created_by", back_populates="creator")
    used_invitations = relationship("InvitationToken", foreign_keys="InvitationToken.used_by", back_populates="used_by_user")


class Department(Base):
    __tablename__ = "departments"

    id = Column(String, primary_key=True, default=gen_uuid)
    company_id = Column(String, ForeignKey("companies.id"), nullable=False, index=True)
    name = Column(String(100), nullable=False)
    description = Column(Text, nullable=True)
    department_head = Column(String(150), nullable=True)
    status = Column(String(20), default="ACTIVE")

    users = relationship("User", back_populates="department")


# --- Asset Management ---

class AssetCategory(Base):
    __tablename__ = "asset_categories"

    id = Column(String, primary_key=True, default=gen_uuid)
    company_id = Column(String, ForeignKey("companies.id"), nullable=False, index=True)
    name = Column(String(100), nullable=False)
    description = Column(Text, nullable=True)


class Asset(Base):
    __tablename__ = "assets"

    id = Column(String, primary_key=True, default=gen_uuid)
    company_id = Column(String, ForeignKey("companies.id"), nullable=False, index=True)
    asset_tag = Column(String(100), nullable=False, index=True)
    serial_number = Column(String(100), nullable=False, index=True)
    name = Column(String(150), nullable=False)
    category = Column(String(100), nullable=False)
    type = Column(String(50), nullable=True)
    brand = Column(String(100), nullable=True)
    model = Column(String(100), nullable=True)
    purchase_date = Column(DateTime, nullable=True)
    purchase_price = Column(Numeric(12, 2), default=0.0)
    vendor_id = Column(String, ForeignKey("vendors.id"), nullable=True)
    warranty_start = Column(DateTime, nullable=True)
    warranty_end = Column(DateTime, nullable=True)
    # Depreciation inputs and the last calculated book value.
    depreciation_method = Column(String(30), default="STRAIGHT_LINE", nullable=False, server_default="STRAIGHT_LINE")
    useful_life_years = Column(Integer, default=5, nullable=False, server_default="5")
    salvage_value = Column(Numeric(12, 2), default=0, nullable=False, server_default="0")
    current_value = Column(Numeric(12, 2), nullable=True)
    location_id = Column(String, nullable=True)
    department_id = Column(String, ForeignKey("departments.id"), nullable=True)
    status = Column(Enum(AssetStatusEnum), default=AssetStatusEnum.IN_STOCK, nullable=False, index=True)
    condition = Column(String(50), default="EXCELLENT")
    description = Column(Text, nullable=True)
    created_by = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        Index("uix_company_asset_tag", "company_id", "asset_tag", unique=True),
        Index("uix_company_serial", "company_id", "serial_number", unique=True),
    )


class AssetAssignment(Base):
    __tablename__ = "asset_assignments"

    id = Column(String, primary_key=True, default=gen_uuid)
    company_id = Column(String, ForeignKey("companies.id"), nullable=False, index=True)
    asset_id = Column(String, ForeignKey("assets.id"), nullable=False, index=True)
    user_id = Column(String, ForeignKey("users.id"), nullable=False, index=True)
    assigned_at = Column(DateTime, default=datetime.utcnow)
    returned_at = Column(DateTime, nullable=True)
    is_active = Column(Boolean, default=True)


class AssetRequest(Base):
    __tablename__ = "asset_requests"

    id = Column(String, primary_key=True, default=gen_uuid)
    company_id = Column(String, ForeignKey("companies.id"), nullable=False, index=True)
    requested_by = Column(String, ForeignKey("users.id"), nullable=False, index=True)
    # Who created the ticket (an agent may raise one on someone else's behalf).
    raised_by = Column(String, ForeignKey("users.id"), nullable=True, index=True)
    asset_category_id = Column(String, nullable=False)
    department_id = Column(String, ForeignKey("departments.id"), nullable=True)
    requested_for = Column(String(150), nullable=True)
    reason = Column(Text, nullable=False)
    status = Column(Enum(RequestStatusEnum), default=RequestStatusEnum.PENDING, nullable=False, index=True)
    assigned_asset_id = Column(String, ForeignKey("assets.id"), nullable=True)
    rejection_reason = Column(Text, nullable=True)
    # Who approved or rejected the ticket, and when.
    processed_by = Column(String, ForeignKey("users.id"), nullable=True, index=True)
    processed_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class AssetReturnRequest(Base):
    __tablename__ = "asset_returns"

    id = Column(String, primary_key=True, default=gen_uuid)
    company_id = Column(String, ForeignKey("companies.id"), nullable=False, index=True)
    asset_id = Column(String, ForeignKey("assets.id"), nullable=False)
    requested_by = Column(String, ForeignKey("users.id"), nullable=False)
    reason = Column(Text, nullable=False)
    condition_on_return = Column(String(50), default="GOOD")
    status = Column(Enum(RequestStatusEnum), default=RequestStatusEnum.PENDING, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)


class AssetLifecycle(Base):
    __tablename__ = "asset_lifecycle"

    id = Column(String, primary_key=True, default=gen_uuid)
    company_id = Column(String, ForeignKey("companies.id"), nullable=False, index=True)
    asset_id = Column(String, ForeignKey("assets.id"), nullable=False, index=True)
    action = Column(String(50), nullable=False)
    previous_status = Column(String(50), nullable=True)
    new_status = Column(String(50), nullable=False)
    performed_by = Column(String, ForeignKey("users.id"), nullable=False)
    remarks = Column(Text, nullable=True)
    timestamp = Column(DateTime, default=datetime.utcnow, index=True)


# --- Inventory & Consumables ---

class InventoryItem(Base):
    __tablename__ = "inventory_items"

    id = Column(String, primary_key=True, default=gen_uuid)
    company_id = Column(String, ForeignKey("companies.id"), nullable=False, index=True)
    name = Column(String(150), nullable=False)
    category = Column(String(100), nullable=False)
    quantity = Column(Integer, default=0)
    reorder_level = Column(Integer, default=10)
    unit_cost = Column(Numeric(12, 2), default=0.0)
    location = Column(String(100), nullable=True)
    status = Column(String(20), default="IN_STOCK")


# --- Software & Licensing ---

class Software(Base):
    __tablename__ = "software"

    id = Column(String, primary_key=True, default=gen_uuid)
    company_id = Column(String, ForeignKey("companies.id"), nullable=False, index=True)
    name = Column(String(150), nullable=False)
    vendor = Column(String(150), nullable=True)
    version = Column(String(50), nullable=True)
    license_type = Column(String(50), default="PERPETUAL")
    total_licenses = Column(Integer, default=1)
    used_licenses = Column(Integer, default=0)
    cost = Column(Numeric(12, 2), default=0.0)
    status = Column(String(20), default="ACTIVE")
    expiry_date = Column(DateTime, nullable=True)


class SoftwareLicenseAssignment(Base):
    __tablename__ = "license_assignments"

    id = Column(String, primary_key=True, default=gen_uuid)
    company_id = Column(String, ForeignKey("companies.id"), nullable=False, index=True)
    software_id = Column(String, ForeignKey("software.id"), nullable=False)
    user_id = Column(String, ForeignKey("users.id"), nullable=False)
    assigned_at = Column(DateTime, default=datetime.utcnow)


# --- Vendors, Procurement & Maintenance ---

class Vendor(Base):
    __tablename__ = "vendors"

    id = Column(String, primary_key=True, default=gen_uuid)
    company_id = Column(String, ForeignKey("companies.id"), nullable=False, index=True)
    name = Column(String(150), nullable=False)
    contact = Column(String(100), nullable=True)
    email = Column(String(150), nullable=True)
    phone = Column(String(50), nullable=True)
    address = Column(Text, nullable=True)
    gst = Column(String(50), nullable=True)
    status = Column(String(20), default="ACTIVE")


class PurchaseOrder(Base):
    __tablename__ = "purchase_orders"

    id = Column(String, primary_key=True, default=gen_uuid)
    company_id = Column(String, ForeignKey("companies.id"), nullable=False, index=True)
    po_number = Column(String(100), nullable=False)
    vendor_id = Column(String, ForeignKey("vendors.id"), nullable=False)
    order_date = Column(DateTime, default=datetime.utcnow)
    total_amount = Column(Numeric(12, 2), default=0.0)
    status = Column(String(50), default="PENDING")


class Maintenance(Base):
    __tablename__ = "maintenance"

    id = Column(String, primary_key=True, default=gen_uuid)
    company_id = Column(String, ForeignKey("companies.id"), nullable=False, index=True)
    asset_id = Column(String, ForeignKey("assets.id"), nullable=False)
    issue = Column(Text, nullable=False)
    reported_by = Column(String, ForeignKey("users.id"), nullable=False)
    vendor_id = Column(String, ForeignKey("vendors.id"), nullable=True)
    cost = Column(Numeric(12, 2), default=0.0)
    start_date = Column(DateTime, default=datetime.utcnow)
    completion_date = Column(DateTime, nullable=True)
    status = Column(String(50), default="IN_PROGRESS")


class WarrantyClaim(Base):
    __tablename__ = "warranty_claims"

    id = Column(String, primary_key=True, default=gen_uuid)
    company_id = Column(String, ForeignKey("companies.id"), nullable=False, index=True)
    asset_id = Column(String, ForeignKey("assets.id"), nullable=False, index=True)
    claim_number = Column(String(100), nullable=True)
    issue_description = Column(Text, nullable=False)
    # SUBMITTED -> IN_REVIEW -> APPROVED | REJECTED -> RESOLVED
    status = Column(String(50), default="SUBMITTED", nullable=False)
    submitted_by = Column(String, ForeignKey("users.id"), nullable=False)
    resolution_notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


# --- Discovery & Cloud Resources ---

class DiscoveredDevice(Base):
    __tablename__ = "discovered_devices"

    id = Column(String, primary_key=True, default=gen_uuid)
    company_id = Column(String, ForeignKey("companies.id"), nullable=False, index=True)
    ip_address = Column(String(50), nullable=False)
    mac_address = Column(String(50), nullable=False)
    hostname = Column(String(150), nullable=True)
    device_type = Column(String(50), nullable=True)
    os_name = Column(String(150), nullable=True)
    serial_number = Column(String(100), nullable=True)
    cpu_model = Column(String(150), nullable=True)
    ram_gb = Column(Numeric(8, 2), nullable=True)
    last_seen = Column(DateTime, nullable=True)
    # UNMANAGED -> MANAGED (promoted to an asset) or IGNORED
    status = Column(String(50), default="UNMANAGED")


class CloudResource(Base):
    __tablename__ = "cloud_resources"

    id = Column(String, primary_key=True, default=gen_uuid)
    company_id = Column(String, ForeignKey("companies.id"), nullable=False, index=True)
    provider = Column(String(50), nullable=False)
    account_id = Column(String(100), nullable=False)
    resource_id = Column(String(150), nullable=False)
    resource_type = Column(String(100), nullable=False)
    region = Column(String(50), nullable=True)
    monthly_cost = Column(Numeric(12, 2), default=0.0)
    status = Column(String(50), default="RUNNING")


# --- Financial & Audit Tracking ---

class FinancialRecord(Base):
    __tablename__ = "financial_records"

    id = Column(String, primary_key=True, default=gen_uuid)
    company_id = Column(String, ForeignKey("companies.id"), nullable=False, index=True)
    entity_type = Column(String(50), nullable=False)
    entity_id = Column(String, nullable=False)
    record_type = Column(String(50), nullable=False)  # CAPEX, OPEX, DEPRECIATION
    amount = Column(Numeric(12, 2), default=0.0)
    transaction_date = Column(DateTime, default=datetime.utcnow)
    notes = Column(Text, nullable=True)


class ReportConfig(Base):
    __tablename__ = "report_configs"

    id = Column(String, primary_key=True, default=gen_uuid)
    company_id = Column(String, ForeignKey("companies.id"), nullable=False, index=True)
    name = Column(String(150), nullable=False)
    report_type = Column(String(50), nullable=False)
    config_json = Column(Text, nullable=True)
    created_by = Column(String, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)


class ReportRun(Base):
    """One generated report. The CSV is stored so the export can be downloaded
    again later exactly as it was produced."""
    __tablename__ = "report_runs"

    id = Column(String, primary_key=True, default=gen_uuid)
    company_id = Column(String, ForeignKey("companies.id"), nullable=False, index=True)
    report_config_id = Column(String, ForeignKey("report_configs.id", ondelete="SET NULL"), nullable=True)
    name = Column(String(150), nullable=False)
    report_type = Column(String(50), nullable=False)
    filters_json = Column(Text, nullable=True)
    format = Column(String(10), default="CSV", nullable=False)
    row_count = Column(Integer, default=0, nullable=False)
    content = Column(Text, nullable=False)
    generated_by = Column(String, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id = Column(String, primary_key=True, default=gen_uuid)
    company_id = Column(String, nullable=True, index=True)
    user_id = Column(String, nullable=True, index=True)
    action = Column(String(100), nullable=False)
    entity = Column(String(100), nullable=False)
    entity_id = Column(String, nullable=True)
    old_value = Column(Text, nullable=True)
    new_value = Column(Text, nullable=True)
    ip_address = Column(String(50), nullable=True)
    timestamp = Column(DateTime, default=datetime.utcnow, index=True)


class AuditSession(Base):
    __tablename__ = "audit_sessions"

    id = Column(String, primary_key=True, default=gen_uuid)
    company_id = Column(String, ForeignKey("companies.id"), nullable=False, index=True)
    title = Column(String(150), nullable=False)
    location_id = Column(String, nullable=True)
    started_by = Column(String, ForeignKey("users.id"), nullable=False)
    status = Column(String(50), default="IN_PROGRESS")
    started_at = Column(DateTime, default=datetime.utcnow)
    completed_at = Column(DateTime, nullable=True)


class AuditScanRecord(Base):
    __tablename__ = "audit_scan_records"

    id = Column(String, primary_key=True, default=gen_uuid)
    audit_session_id = Column(String, ForeignKey("audit_sessions.id"), nullable=False, index=True)
    asset_id = Column(String, ForeignKey("assets.id"), nullable=True, index=True)
    scanned_tag = Column(String(100), nullable=False)
    is_verified = Column(Boolean, default=False)
    scanned_by = Column(String, ForeignKey("users.id"), nullable=False)
    scanned_at = Column(DateTime, default=datetime.utcnow)