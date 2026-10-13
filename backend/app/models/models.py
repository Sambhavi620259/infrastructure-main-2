"""Implementation file: app/models/models.py"""
import uuid
from datetime import datetime
from enum import Enum as PyEnum
from sqlalchemy import (
    Column, String, DateTime, ForeignKey, Integer, JSON, Numeric, Text, Boolean, Enum, Index, text
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
    # Ticket flow: PENDING -> IN_PROGRESS -> APPROVED (waiting for stock) -> FULFILLED,
    # or REJECTED / CANCELLED. Return requests use PENDING / APPROVED / REJECTED.
    PENDING = "PENDING"
    IN_PROGRESS = "IN_PROGRESS"
    APPROVED = "APPROVED"
    FULFILLED = "FULFILLED"
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
    # Details the user fills in on their own profile.
    phone = Column(String(30), nullable=True)
    job_title = Column(String(100), nullable=True)
    employee_code = Column(String(50), nullable=True)
    bio = Column(Text, nullable=True)
    # Organization name / ID as the user enters them on their profile. Display
    # only: the account's real organization is company_id, set by the IT Admin.
    profile_org_name = Column(String(150), nullable=True)
    profile_org_code = Column(String(60), nullable=True)
    # Profile photo as a small data URL (resized in the browser before upload).
    avatar = Column(Text, nullable=True)
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
    # Optional; when given it is unique within the organization.
    asset_tag = Column(String(100), nullable=True, index=True)
    # Optional too; when given it is unique within the organization.
    serial_number = Column(String(100), nullable=True, index=True)
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
    specifications = Column(Text, nullable=True)
    # The stock receipt this device arrived in, when registered from one.
    receipt_id = Column(String, ForeignKey("stock_receipts.id"), nullable=True, index=True)
    created_by = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        # NULL tags do not collide, so untagged assets are allowed.
        Index("uix_company_asset_tag", "company_id", "asset_tag", unique=True),
        Index("uix_company_serial", "company_id", "serial_number", unique=True),
    )

    @property
    def label(self) -> str:
        """How the asset is named in messages: its tag, or its serial number when untagged."""
        if self.asset_tag:
            return self.asset_tag
        return f"S/N {self.serial_number}" if self.serial_number else self.name


class AssetAssignment(Base):
    __tablename__ = "asset_assignments"

    id = Column(String, primary_key=True, default=gen_uuid)
    company_id = Column(String, ForeignKey("companies.id"), nullable=False, index=True)
    asset_id = Column(String, ForeignKey("assets.id"), nullable=False, index=True)
    user_id = Column(String, ForeignKey("users.id"), nullable=False, index=True)
    assigned_at = Column(DateTime, default=datetime.utcnow)
    returned_at = Column(DateTime, nullable=True)
    is_active = Column(Boolean, default=True)

    __table_args__ = (
        # A device has at most one current holder, even under concurrent requests.
        Index("uix_asset_active_assignment", "asset_id", unique=True,
              postgresql_where=text("is_active"), sqlite_where=text("is_active")),
    )


class AssetRequest(Base):
    __tablename__ = "asset_requests"

    id = Column(String, primary_key=True, default=gen_uuid)
    company_id = Column(String, ForeignKey("companies.id"), nullable=False, index=True)
    requested_by = Column(String, ForeignKey("users.id"), nullable=False, index=True)
    # Who created the ticket (an agent may raise one on someone else's behalf).
    raised_by = Column(String, ForeignKey("users.id"), nullable=True, index=True)
    # REQUEST: asks for an asset of a category. ISSUE: a problem with an asset
    # the requester holds (asset_id), resolved by an admin with a note.
    ticket_type = Column(String(20), default="REQUEST", nullable=False, index=True)
    asset_id = Column(String, ForeignKey("assets.id"), nullable=True, index=True)
    resolution_note = Column(Text, nullable=True)
    # SOFTWARE tickets: the product asked for, and the seat given on fulfilment.
    software_id = Column(String, ForeignKey("software.id"), nullable=True, index=True)
    license_assignment_id = Column(String, ForeignKey("license_assignments.id"), nullable=True)
    # RETURN tickets: condition confirmed when the device is handed back.
    return_condition = Column(String(30), nullable=True)
    # Required for REQUEST tickets; for ISSUE tickets, the asset's category when known.
    asset_category_id = Column(String, nullable=True)
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


class InventoryRequest(Base):
    """A user asks for stock; an admin approves (stock is issued to them) or rejects it."""
    __tablename__ = "inventory_requests"

    id = Column(String, primary_key=True, default=gen_uuid)
    company_id = Column(String, ForeignKey("companies.id"), nullable=False, index=True)
    item_id = Column(String, ForeignKey("inventory_items.id"), nullable=False, index=True)
    requested_by = Column(String, ForeignKey("users.id"), nullable=False, index=True)
    quantity = Column(Integer, nullable=False)
    reason = Column(Text, nullable=False)
    # PENDING, APPROVED (stock issued), REJECTED or CANCELLED.
    status = Column(String(20), default="PENDING", nullable=False, index=True)
    rejection_reason = Column(Text, nullable=True)
    processed_by = Column(String, ForeignKey("users.id"), nullable=True)
    processed_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)


# --- Software & Licensing ---

class Software(Base):
    """A software product (name, publisher, version). Seats come from its SoftwareLicense rows."""
    __tablename__ = "software"

    id = Column(String, primary_key=True, default=gen_uuid)
    company_id = Column(String, ForeignKey("companies.id"), nullable=False, index=True)
    name = Column(String(150), nullable=False)
    # Publisher.
    vendor = Column(String(150), nullable=True)
    version = Column(String(50), nullable=True)
    # Summary columns kept in step with the licenses and seat assignments
    # (see services/software_service.sync_totals), for reports and older screens.
    license_type = Column(String(50), default="PERPETUAL")
    total_licenses = Column(Integer, default=0)
    used_licenses = Column(Integer, default=0)
    cost = Column(Numeric(12, 2), default=0.0)
    status = Column(String(20), default="ACTIVE")
    expiry_date = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class SoftwareLicense(Base):
    """A purchased license entitlement for a product: a number of seats with its own terms."""
    __tablename__ = "software_licenses"

    id = Column(String, primary_key=True, default=gen_uuid)
    company_id = Column(String, ForeignKey("companies.id"), nullable=False, index=True)
    software_id = Column(String, ForeignKey("software.id"), nullable=False, index=True)
    license_type = Column(String(50), default="PERPETUAL", nullable=False)
    # Sensitive: shown in full to admins only.
    license_number = Column(String(255), nullable=True)
    seats = Column(Integer, nullable=False)
    purchase_date = Column(DateTime, nullable=True)
    expiry_date = Column(DateTime, nullable=True)
    renewal_date = Column(DateTime, nullable=True)
    cost = Column(Numeric(12, 2), default=0, nullable=False)
    vendor_id = Column(String, ForeignKey("vendors.id"), nullable=True)
    purchase_order_id = Column(String, ForeignKey("purchase_orders.id"), nullable=True)
    status = Column(String(20), default="ACTIVE", nullable=False)
    notes = Column(Text, nullable=True)
    created_by = Column(String, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        Index("uix_company_license_number", "company_id", "license_number", unique=True),
    )


class SoftwareLicenseAssignment(Base):
    """One seat of a license given to a user (optionally on a device); released seats keep their history."""
    __tablename__ = "license_assignments"

    id = Column(String, primary_key=True, default=gen_uuid)
    company_id = Column(String, ForeignKey("companies.id"), nullable=False, index=True)
    software_id = Column(String, ForeignKey("software.id"), nullable=False)
    license_id = Column(String, ForeignKey("software_licenses.id"), nullable=True, index=True)
    user_id = Column(String, ForeignKey("users.id"), nullable=False)
    asset_id = Column(String, ForeignKey("assets.id"), nullable=True)
    assigned_at = Column(DateTime, default=datetime.utcnow)
    assigned_by = Column(String, ForeignKey("users.id"), nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)
    released_at = Column(DateTime, nullable=True)
    released_by = Column(String, ForeignKey("users.id"), nullable=True)

    __table_args__ = (
        # One active seat per user per license.
        Index("uix_license_user_active", "license_id", "user_id", unique=True,
              postgresql_where=text("is_active"), sqlite_where=text("is_active")),
    )


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
    # Who raised it: they cannot approve it themselves unless policy allows.
    created_by = Column(String, ForeignKey("users.id"), nullable=True)


class StockReceipt(Base):
    """Hardware received against an approved (ordered) purchase order, before devices are registered."""
    __tablename__ = "stock_receipts"

    id = Column(String, primary_key=True, default=gen_uuid)
    company_id = Column(String, ForeignKey("companies.id"), nullable=False, index=True)
    purchase_order_id = Column(String, ForeignKey("purchase_orders.id"), nullable=False, index=True)
    category = Column(String(100), nullable=False)
    brand = Column(String(100), nullable=True)
    model = Column(String(100), nullable=True)
    specifications = Column(Text, nullable=True)
    quantity = Column(Integer, nullable=False)
    unit_cost = Column(Numeric(12, 2), default=0, nullable=False)
    location = Column(String(100), nullable=True)
    notes = Column(Text, nullable=True)
    received_by = Column(String, ForeignKey("users.id"), nullable=True)
    received_at = Column(DateTime, default=datetime.utcnow)


class StockMovement(Base):
    """Ledger of stock changes. `reference` is a client key that stops the same movement being recorded twice."""
    __tablename__ = "stock_movements"

    id = Column(String, primary_key=True, default=gen_uuid)
    company_id = Column(String, ForeignKey("companies.id"), nullable=False, index=True)
    # RECEIPT, REGISTER, ASSIGN, RETURN, TRANSFER, ISSUE, ADJUSTMENT, REPAIR, RETIRE
    movement_type = Column(String(20), nullable=False, index=True)
    # HARDWARE (assets / receipts) or CONSUMABLE (inventory items)
    item_kind = Column(String(20), nullable=False)
    asset_id = Column(String, ForeignKey("assets.id"), nullable=True, index=True)
    inventory_item_id = Column(String, ForeignKey("inventory_items.id"), nullable=True, index=True)
    receipt_id = Column(String, ForeignKey("stock_receipts.id"), nullable=True)
    purchase_order_id = Column(String, ForeignKey("purchase_orders.id"), nullable=True)
    quantity = Column(Integer, nullable=False, default=1)
    from_location = Column(String(100), nullable=True)
    to_location = Column(String(100), nullable=True)
    reason = Column(Text, nullable=True)
    reference = Column(String(64), nullable=True)
    performed_by = Column(String, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)

    __table_args__ = (
        Index("uix_company_movement_reference", "company_id", "reference", unique=True),
    )


class ApprovalPolicy(Base):
    """Who may approve one kind of request in an organization, and whether self-approval is allowed."""
    __tablename__ = "approval_policies"

    id = Column(String, primary_key=True, default=gen_uuid)
    company_id = Column(String, ForeignKey("companies.id"), nullable=False, index=True)
    # ASSET, SOFTWARE, RETURN, ISSUE, STOCK, PURCHASE_ORDER
    request_type = Column(String(30), nullable=False)
    approver_roles = Column(JSON, nullable=False)
    allow_self_approval = Column(Boolean, default=False, nullable=False)
    updated_by = Column(String, ForeignKey("users.id"), nullable=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        Index("uix_company_policy_type", "company_id", "request_type", unique=True),
    )


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