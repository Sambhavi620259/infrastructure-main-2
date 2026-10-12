import { apiFetch } from "@/lib/api";

// --- Finance & depreciation --------------------------------------------------

export interface FinancialSummary {
  company_id: string | null;
  total_asset_cost: number;
  net_book_value: number;
  accumulated_depreciation: number;
}

export interface DepartmentFinance {
  department_id: string;
  department_name: string;
  asset_count: number;
  total_cost: number;
  current_value: number;
}

export interface DepreciationResult {
  asset_id: string;
  original_cost: number;
  salvage_value: number;
  current_value: number;
  total_depreciated: number;
  annual_depreciation: number;
  method: string;
  years_in_service: number;
}

export function getFinancialSummary(): Promise<FinancialSummary> {
  return apiFetch<FinancialSummary>("/api/financial/summary");
}

export function getDepartmentFinance(): Promise<DepartmentFinance[]> {
  return apiFetch<DepartmentFinance[]>("/api/financial/department-breakdown");
}

export function recalculateAllDepreciation(): Promise<{ message: string; assets_updated: number }> {
  return apiFetch("/api/depreciation/batch-recalculate", { method: "POST" });
}

export function calculateAssetDepreciation(
  assetId: string,
  input: { method?: "STRAIGHT_LINE" | "DECLINING_BALANCE"; useful_life_years?: number; salvage_value?: number } = {},
): Promise<DepreciationResult> {
  return apiFetch<DepreciationResult>(`/api/depreciation/calculate/${encodeURIComponent(assetId)}`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

// --- Maintenance -------------------------------------------------------------

export type MaintenanceStatus = "SCHEDULED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";

export interface MaintenanceRecord {
  id: string;
  asset_id: string;
  asset_tag: string | null;
  asset_name: string | null;
  issue: string;
  vendor_id: string | null;
  vendor_name: string | null;
  cost: string | number;
  reported_by: string;
  reported_by_name: string | null;
  start_date: string | null;
  completion_date: string | null;
  status: MaintenanceStatus;
}

export function listMaintenance(params: { asset_id?: string; status?: MaintenanceStatus } = {}): Promise<MaintenanceRecord[]> {
  const search = new URLSearchParams();
  if (params.asset_id) search.set("asset_id", params.asset_id);
  if (params.status) search.set("status", params.status);
  return apiFetch<MaintenanceRecord[]>(`/api/maintenance${search.toString() ? `?${search}` : ""}`);
}

export function createMaintenance(input: {
  asset_id: string;
  issue: string;
  vendor_id?: string;
  cost?: number;
  status?: "SCHEDULED" | "IN_PROGRESS";
}): Promise<MaintenanceRecord> {
  return apiFetch<MaintenanceRecord>("/api/maintenance", { method: "POST", body: JSON.stringify(input) });
}

export function updateMaintenance(
  id: string,
  input: { status?: MaintenanceStatus; cost?: number; issue?: string; vendor_id?: string },
): Promise<MaintenanceRecord> {
  return apiFetch<MaintenanceRecord>(`/api/maintenance/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

// --- Discovery ---------------------------------------------------------------

export type DeviceStatus = "UNMANAGED" | "MANAGED" | "IGNORED";

export interface DiscoveredDevice {
  id: string;
  hostname: string | null;
  ip_address: string;
  mac_address: string;
  device_type: string | null;
  os_name: string | null;
  serial_number: string | null;
  cpu_model: string | null;
  ram_gb: string | number | null;
  last_seen: string | null;
  status: DeviceStatus;
}

export function listDiscoveredDevices(status?: DeviceStatus): Promise<DiscoveredDevice[]> {
  return apiFetch<DiscoveredDevice[]>(`/api/discovery/devices${status ? `?status=${status}` : ""}`);
}

export function promoteDevice(id: string, input: { asset_tag: string; category: string; name?: string }) {
  return apiFetch<{ asset_id: string }>(`/api/discovery/reconcile/${encodeURIComponent(id)}`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function ignoreDevice(id: string): Promise<DiscoveredDevice> {
  return apiFetch<DiscoveredDevice>(`/api/discovery/devices/${encodeURIComponent(id)}/ignore`, { method: "POST" });
}

// --- Cloud -------------------------------------------------------------------

export const CLOUD_PROVIDERS = ["AWS", "AZURE", "GCP", "OTHER"] as const;
export type CloudProvider = (typeof CLOUD_PROVIDERS)[number];
export type CloudStatus = "RUNNING" | "STOPPED" | "TERMINATED";

export interface CloudResource {
  id: string;
  provider: CloudProvider;
  account_id: string;
  resource_id: string;
  resource_type: string;
  region: string | null;
  monthly_cost: string | number;
  status: CloudStatus;
}

export function listCloudResources(): Promise<CloudResource[]> {
  return apiFetch<CloudResource[]>("/api/cloud/resources");
}

export function createCloudResource(input: {
  provider: CloudProvider;
  account_id: string;
  resource_id: string;
  resource_type: string;
  region?: string;
  monthly_cost?: number;
}): Promise<CloudResource> {
  return apiFetch<CloudResource>("/api/cloud/resources", { method: "POST", body: JSON.stringify(input) });
}

export function updateCloudResource(id: string, input: { status?: CloudStatus; monthly_cost?: number }): Promise<CloudResource> {
  return apiFetch<CloudResource>(`/api/cloud/resources/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export function money(value: string | number | null | undefined): string {
  return Number(value ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 });
}
