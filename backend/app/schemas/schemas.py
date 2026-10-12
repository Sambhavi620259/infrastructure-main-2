"""Implementation file: app/schemas/schemas.py"""
from datetime import datetime
from decimal import Decimal
from typing import Dict, List, Optional
from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app.models.models import AssetStatusEnum, PlatformRole, RequestStatusEnum


# --- Auth & Security Schemas ---

class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
    # Frontend role name (IT Agents are stored as EMPLOYEE, sent as IT_AGENT).
    role: str
    company_id: Optional[str] = None


class TokenData(BaseModel):
    user_id: Optional[str] = None
    role: Optional[PlatformRole] = None


class LoginRequest(BaseModel):
    email: EmailStr
    password: str
    # The role picked on the login page. Informational only: the account's
    # own role decides the workspace. Accepts frontend names such as IT_AGENT.
    role: Optional[str] = None


class RegisterRequest(BaseModel):
    name: str = Field(..., min_length=2, max_length=150)
    email: EmailStr
    password: str = Field(..., min_length=8)
    role: str = Field(..., pattern="^(IT_ADMIN|IT_AGENT|SUPER_ADMIN)$")
    # Super Admin only: the platform key, or (if none exists yet) the key to create.
    registrationKey: Optional[str] = Field(None, max_length=128)
    registrationKeyConfirm: Optional[str] = Field(None, max_length=128)


# --- Company & Subscription Schemas ---

class CompanyBase(BaseModel):
    name: str = Field(..., max_length=150)
    code: str = Field(..., max_length=50)


class CompanyCreate(CompanyBase):
    plan: str = "ENTERPRISE"
    user_limit: int = 500
    asset_limit: int = 2000


class CompanyUpdate(BaseModel):
    name: Optional[str] = None
    status: Optional[str] = None


class SubscriptionResponse(BaseModel):
    id: str
    company_id: str
    plan: str
    user_limit: int
    asset_limit: int
    start_date: datetime
    end_date: Optional[datetime] = None
    status: str

    model_config = ConfigDict(from_attributes=True)


class CompanyResponse(CompanyBase):
    id: str
    status: str
    created_at: datetime
    subscription: Optional[SubscriptionResponse] = None

    model_config = ConfigDict(from_attributes=True)


# --- User & Department Schemas ---

class DepartmentBase(BaseModel):
    name: str = Field(..., max_length=100)
    description: Optional[str] = None
    department_head: Optional[str] = None


class DepartmentCreate(DepartmentBase):
    pass


class DepartmentResponse(DepartmentBase):
    id: str
    company_id: str
    status: str

    model_config = ConfigDict(from_attributes=True)


class UserBase(BaseModel):
    email: EmailStr
    full_name: str = Field(..., max_length=150)
    role: PlatformRole = PlatformRole.EMPLOYEE
    location: Optional[str] = None
    department_id: Optional[str] = None
    # Only meaningful for SUB_ADMIN; see SubAdminModule.
    modules: Optional[List[str]] = None


class UserCreate(UserBase):
    password: str = Field(..., min_length=8)
    company_id: Optional[str] = None  # Admin creates user for tenant


class UserUpdate(BaseModel):
    full_name: Optional[str] = None
    role: Optional[PlatformRole] = None
    modules: Optional[List[str]] = None
    location: Optional[str] = None
    department_id: Optional[str] = None
    status: Optional[str] = None


class UserResponse(UserBase):
    id: str
    agent_id: Optional[str] = None
    company_id: Optional[str] = None
    status: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class UserProfile(BaseModel):
    id: str
    name: str
    email: str
    # Frontend role name: EMPLOYEE is presented as IT_AGENT (see profile_role).
    role: str
    department: Optional[str] = None
    companyId: Optional[str] = None
    companyName: Optional[str] = None
    agentId: Optional[str] = None
    location: Optional[str] = None
    # Sub-admin modules (HAM, SAM, CLOUD, SCAN, REPORTS); empty for other roles.
    modules: List[str] = []
    memberSince: Optional[datetime] = None
    # The sign-in before the current one, so people can spot one they did not make.
    previousLoginAt: Optional[datetime] = None
    avatarUrl: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)


class UserProfileResponse(BaseModel):
    """Envelope the frontend expects: {"user": {...}}."""

    user: UserProfile


# --- Asset Management Schemas ---

class AssetCategoryCreate(BaseModel):
    name: str = Field(..., max_length=100)
    description: Optional[str] = None


class AssetCategoryResponse(AssetCategoryCreate):
    id: str
    company_id: str

    model_config = ConfigDict(from_attributes=True)


class AssetBase(BaseModel):
    asset_tag: str = Field(..., max_length=100)
    serial_number: str = Field(..., max_length=100)
    name: str = Field(..., max_length=150)
    category: str = Field(..., max_length=100)
    type: Optional[str] = None
    brand: Optional[str] = None
    model: Optional[str] = None
    purchase_date: Optional[datetime] = None
    purchase_price: Decimal = Field(Decimal("0.00"), ge=0)
    vendor_id: Optional[str] = None
    warranty_start: Optional[datetime] = None
    warranty_end: Optional[datetime] = None
    location_id: Optional[str] = None
    department_id: Optional[str] = None
    condition: str = "EXCELLENT"
    description: Optional[str] = None


class AssetCreate(AssetBase):
    status: AssetStatusEnum = AssetStatusEnum.IN_STOCK


class AssetUpdate(BaseModel):
    name: Optional[str] = None
    category: Optional[str] = None
    type: Optional[str] = None
    brand: Optional[str] = None
    model: Optional[str] = None
    purchase_date: Optional[datetime] = None
    purchase_price: Optional[Decimal] = Field(None, ge=0)
    vendor_id: Optional[str] = None
    warranty_start: Optional[datetime] = None
    warranty_end: Optional[datetime] = None
    location_id: Optional[str] = None
    department_id: Optional[str] = None
    status: Optional[AssetStatusEnum] = None
    condition: Optional[str] = None
    description: Optional[str] = None
    # Not an asset field: recorded on the lifecycle entry when status changes.
    status_remarks: Optional[str] = Field(None, max_length=500)


class AssetResponse(AssetBase):
    id: str
    company_id: str
    status: AssetStatusEnum
    # Derived from the active AssetAssignment row, not stored on the asset.
    assigned_to_id: Optional[str] = None
    assigned_to_name: Optional[str] = None
    assigned_to_email: Optional[str] = None
    created_by: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class AssetAssignRequest(BaseModel):
    user_id: str


# --- Request & Return Schemas ---

class AssetRequestCreate(BaseModel):
    asset_category_id: str
    requested_for: Optional[str] = None
    # Raise the ticket on behalf of this user (same organization); the asset
    # is assigned to them on approval. Defaults to the caller.
    requested_for_user_id: Optional[str] = None
    department_id: Optional[str] = None
    reason: str


class AssetRequestUpdate(BaseModel):
    status: RequestStatusEnum
    assigned_asset_id: Optional[str] = None
    rejection_reason: Optional[str] = None


class AssetRequestResponse(BaseModel):
    id: str
    company_id: str
    requested_by: str
    asset_category_id: str
    department_id: Optional[str] = None
    requested_for: Optional[str] = None
    reason: str
    status: RequestStatusEnum
    assigned_asset_id: Optional[str] = None
    rejection_reason: Optional[str] = None
    created_at: datetime
    # Display names joined in by the tickets endpoints.
    requested_by_name: Optional[str] = None
    raised_by: Optional[str] = None
    raised_by_name: Optional[str] = None
    category_name: Optional[str] = None
    department_name: Optional[str] = None
    assigned_asset_tag: Optional[str] = None
    processed_by: Optional[str] = None
    processed_by_name: Optional[str] = None
    processed_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


class AssetReturnCreate(BaseModel):
    asset_id: str
    reason: str
    condition_on_return: str = "GOOD"


class AssetLifecycleResponse(BaseModel):
    id: str
    asset_id: str
    action: str
    previous_status: Optional[str] = None
    new_status: str
    performed_by: str
    remarks: Optional[str] = None
    timestamp: datetime

    model_config = ConfigDict(from_attributes=True)


class AssetEventResponse(AssetLifecycleResponse):
    """A lifecycle entry joined with the asset and the user who performed it."""
    asset_tag: str
    asset_name: str
    performed_by_name: Optional[str] = None


class AssetCountsResponse(BaseModel):
    total: int
    in_stock: int
    assigned: int
    in_repair: int
    by_status: Dict[str, int]


# --- Inventory & Consumables Schemas ---

class InventoryItemBase(BaseModel):
    name: str = Field(..., max_length=150)
    category: str = Field(..., max_length=100)
    quantity: int = Field(0, ge=0)
    reorder_level: int = Field(10, ge=0)
    unit_cost: Decimal = Field(Decimal("0.00"), ge=0)
    location: Optional[str] = None


class InventoryItemCreate(InventoryItemBase):
    pass


class InventoryItemUpdate(BaseModel):
    quantity: Optional[int] = Field(None, ge=0)
    reorder_level: Optional[int] = Field(None, ge=0)
    unit_cost: Optional[Decimal] = Field(None, ge=0)
    location: Optional[str] = None


class InventoryItemResponse(InventoryItemBase):
    id: str
    company_id: str
    status: str

    model_config = ConfigDict(from_attributes=True)


# --- Software & Licensing Schemas ---

class SoftwareCreate(BaseModel):
    name: str = Field(..., max_length=150)
    vendor: Optional[str] = None
    version: Optional[str] = None
    license_type: str = "PERPETUAL"
    total_licenses: int = 1
    cost: Decimal = Decimal("0.00")
    expiry_date: Optional[datetime] = None


class SoftwareResponse(SoftwareCreate):
    id: str
    company_id: str
    used_licenses: int
    status: str

    model_config = ConfigDict(from_attributes=True)


class LicenseAssignRequest(BaseModel):
    user_id: str


# --- Vendors, PO & Maintenance Schemas ---

class VendorCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=150)
    contact: Optional[str] = Field(None, max_length=100)
    email: Optional[EmailStr] = None
    phone: Optional[str] = Field(None, max_length=50)
    address: Optional[str] = None
    gst: Optional[str] = Field(None, max_length=50)


class VendorResponse(VendorCreate):
    id: str
    company_id: str
    status: str
    # Plain str on the way out: stored values predate email validation.
    email: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)


class VendorUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=150)
    contact: Optional[str] = Field(None, max_length=100)
    email: Optional[EmailStr] = None
    phone: Optional[str] = Field(None, max_length=50)
    address: Optional[str] = None
    gst: Optional[str] = Field(None, max_length=50)
    status: Optional[str] = Field(None, pattern="^(ACTIVE|INACTIVE)$")


class PurchaseOrderCreate(BaseModel):
    po_number: str
    vendor_id: str
    total_amount: Decimal
    order_date: Optional[datetime] = None


class PurchaseOrderResponse(PurchaseOrderCreate):
    id: str
    company_id: str
    status: str

    model_config = ConfigDict(from_attributes=True)


class MaintenanceCreate(BaseModel):
    asset_id: str
    issue: str = Field(..., min_length=1)
    vendor_id: Optional[str] = None
    cost: Decimal = Field(Decimal("0.00"), ge=0)
    # SCHEDULED leaves the asset as it is; IN_PROGRESS moves it to IN_REPAIR.
    status: str = Field("IN_PROGRESS", pattern="^(SCHEDULED|IN_PROGRESS)$")


class MaintenanceResponse(BaseModel):
    id: str
    company_id: str
    asset_id: str
    asset_tag: Optional[str] = None
    asset_name: Optional[str] = None
    issue: str
    vendor_id: Optional[str] = None
    vendor_name: Optional[str] = None
    cost: Decimal
    reported_by: str
    reported_by_name: Optional[str] = None
    start_date: Optional[datetime] = None
    completion_date: Optional[datetime] = None
    status: str

    model_config = ConfigDict(from_attributes=True)


class MaintenanceUpdate(BaseModel):
    issue: Optional[str] = Field(None, min_length=1)
    vendor_id: Optional[str] = None
    cost: Optional[Decimal] = Field(None, ge=0)
    status: Optional[str] = Field(None, pattern="^(SCHEDULED|IN_PROGRESS|COMPLETED|CANCELLED)$")


# --- Discovery & Cloud Schemas ---

class DiscoveredDeviceCreate(BaseModel):
    ip_address: str
    mac_address: str
    hostname: Optional[str] = None
    device_type: Optional[str] = None


class DiscoveredDeviceResponse(DiscoveredDeviceCreate):
    id: str
    company_id: str
    status: str

    model_config = ConfigDict(from_attributes=True)


class CloudResourceCreate(BaseModel):
    provider: str
    account_id: str
    resource_id: str
    resource_type: str
    region: Optional[str] = None
    monthly_cost: Decimal = Decimal("0.00")


class CloudResourceResponse(CloudResourceCreate):
    id: str
    company_id: str
    status: str

    model_config = ConfigDict(from_attributes=True)


# --- Financial, Reports & Audit Schemas ---

class FinancialRecordCreate(BaseModel):
    entity_type: str
    entity_id: str
    record_type: str  # CAPEX, OPEX, DEPRECIATION
    amount: Decimal
    notes: Optional[str] = None


class FinancialRecordResponse(FinancialRecordCreate):
    id: str
    company_id: str
    transaction_date: datetime

    model_config = ConfigDict(from_attributes=True)


class ExecutiveDashboardSummary(BaseModel):
    total_assets: int
    assigned_assets: int
    in_stock_assets: int
    under_maintenance_assets: int
    total_asset_value: float
    total_software_licenses: int
    used_software_licenses: int
    low_stock_inventory_alerts: int

    model_config = ConfigDict(from_attributes=True)


class AssetCategoryReport(BaseModel):
    category_id: Optional[str] = None
    category_name: Optional[str] = None
    total_count: int
    total_value: float

    model_config = ConfigDict(from_attributes=True)


class ReportTypeResponse(BaseModel):
    key: str
    label: str
    description: str
    filters: List[str]


class ReportRunCreate(BaseModel):
    report_type: str
    name: Optional[str] = Field(None, max_length=150)
    # Validated against ReportFilters in the report service.
    filters: Dict[str, Optional[str | int]] = Field(default_factory=dict)
    # Also keep these settings as a saved report that can be re-run.
    save: bool = False


class ReportRunResponse(BaseModel):
    id: str
    name: str
    report_type: str
    report_config_id: Optional[str] = None
    filters: Dict[str, Optional[str | int]] = Field(default_factory=dict)
    format: str
    row_count: int
    generated_by: str
    generated_by_name: Optional[str] = None
    created_at: datetime


class ReportConfigResponse(BaseModel):
    id: str
    name: str
    report_type: str
    filters: Dict[str, Optional[str | int]] = Field(default_factory=dict)
    created_by: str
    created_at: datetime
    last_run_at: Optional[datetime] = None


class ReportSummaryResponse(BaseModel):
    generated_this_month: int
    saved_reports: int
    last_generated_at: Optional[datetime] = None


class AuditLogResponse(BaseModel):
    id: str
    company_id: Optional[str] = None
    user_id: Optional[str] = None
    action: str
    entity: str
    entity_id: Optional[str] = None
    old_value: Optional[str] = None
    new_value: Optional[str] = None
    ip_address: Optional[str] = None
    timestamp: datetime

    model_config = ConfigDict(from_attributes=True)


# --- Dashboard Schemas ---

class DashboardSummaryResponse(BaseModel):
    total_assets: int
    in_use_assets: int
    in_stock_assets: int
    in_repair_assets: int
    total_users: int
    pending_requests: int
    software_licenses_used: int
    software_licenses_total: int
    total_asset_value: Decimal


class DepreciationCalculateRequest(BaseModel):
    """Optional overrides; when given they are saved on the asset for later runs."""
    method: Optional[str] = Field(None, pattern="^(STRAIGHT_LINE|DECLINING_BALANCE)$")
    useful_life_years: Optional[int] = Field(None, ge=1, le=50)
    salvage_value: Optional[float] = Field(None, ge=0)


class DepreciationResponse(BaseModel):
    asset_id: str
    original_cost: float
    salvage_value: float
    current_value: float
    total_depreciated: float
    annual_depreciation: float
    method: str
    years_in_service: float

    model_config = ConfigDict(from_attributes=True)


class NotificationResponse(BaseModel):
    id: str
    title: str
    message: Optional[str] = None
    type: str
    link: Optional[str] = None
    is_read: bool
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
