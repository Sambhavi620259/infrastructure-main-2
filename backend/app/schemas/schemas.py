"""Implementation file: app/schemas/schemas.py"""
from datetime import datetime
from decimal import Decimal
from typing import List, Optional
from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app.models.models import AssetStatusEnum, PlatformRole, RequestStatusEnum


# --- Auth & Security Schemas ---

class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
    role: PlatformRole
    company_id: Optional[str] = None


class TokenData(BaseModel):
    user_id: Optional[str] = None
    role: Optional[PlatformRole] = None


class LoginRequest(BaseModel):
    email: EmailStr
    password: str
    role: Optional[PlatformRole] = None


class RegisterRequest(BaseModel):
    name: str = Field(..., min_length=2, max_length=150)
    email: EmailStr
    password: str = Field(..., min_length=8)
    role: str = Field(..., pattern="^(IT_ADMIN|IT_AGENT|SUPER_ADMIN)$")
    invitationToken: Optional[str] = None
    registrationKey: Optional[str] = None


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
    company_id: Optional[str] = None
    status: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class UserProfile(BaseModel):
    id: str
    name: str
    email: str
    role: PlatformRole
    department: Optional[str] = None
    companyId: Optional[str] = None
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
    purchase_price: Decimal = Decimal("0.00")
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
    purchase_price: Optional[Decimal] = None
    vendor_id: Optional[str] = None
    warranty_start: Optional[datetime] = None
    warranty_end: Optional[datetime] = None
    location_id: Optional[str] = None
    department_id: Optional[str] = None
    status: Optional[AssetStatusEnum] = None
    condition: Optional[str] = None
    description: Optional[str] = None


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
    requested_for: Optional[str] = None
    reason: str
    status: RequestStatusEnum
    assigned_asset_id: Optional[str] = None
    rejection_reason: Optional[str] = None
    created_at: datetime

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


# --- Inventory & Consumables Schemas ---

class InventoryItemBase(BaseModel):
    name: str = Field(..., max_length=150)
    category: str = Field(..., max_length=100)
    quantity: int = 0
    reorder_level: int = 10
    unit_cost: Decimal = Decimal("0.00")
    location: Optional[str] = None


class InventoryItemCreate(InventoryItemBase):
    pass


class InventoryItemUpdate(BaseModel):
    quantity: Optional[int] = None
    reorder_level: Optional[int] = None
    unit_cost: Optional[Decimal] = None
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
    name: str = Field(..., max_length=150)
    contact_person: Optional[str] = None
    contact: Optional[str] = None
    email: Optional[EmailStr] = None
    phone: Optional[str] = None
    address: Optional[str] = None
    website: Optional[str] = None
    notes: Optional[str] = None
    gst: Optional[str] = None


class VendorResponse(VendorCreate):
    id: str
    company_id: str
    status: str

    model_config = ConfigDict(from_attributes=True)


class VendorUpdate(BaseModel):
    name: Optional[str] = None
    contact_person: Optional[str] = None
    contact: Optional[str] = None
    email: Optional[EmailStr] = None
    phone: Optional[str] = None
    address: Optional[str] = None
    website: Optional[str] = None
    notes: Optional[str] = None
    gst: Optional[str] = None
    status: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)


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
    issue: str
    vendor_id: Optional[str] = None
    cost: Decimal = Decimal("0.00")


class MaintenanceResponse(MaintenanceCreate):
    id: str
    company_id: str
    reported_by: str
    start_date: datetime
    completion_date: Optional[datetime] = None
    status: str

    model_config = ConfigDict(from_attributes=True)


class MaintenanceUpdate(BaseModel):
    issue: Optional[str] = None
    vendor_id: Optional[str] = None
    cost: Optional[Decimal] = None
    completion_date: Optional[datetime] = None
    status: Optional[str] = None


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


class ReportConfigCreate(BaseModel):
    name: str
    report_type: str
    config_json: Optional[str] = None


class ReportConfigResponse(ReportConfigCreate):
    id: str
    company_id: str
    created_by: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


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
    method: Optional[str] = None
    useful_life_years: Optional[int] = None
    salvage_value: Optional[float] = None


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