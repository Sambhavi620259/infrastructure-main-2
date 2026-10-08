export const ASSET_STATUSES = [
  "IN_STOCK",
  "REQUESTED",
  "ASSIGNED",
  "IN_USE",
  "RETURN_REQUESTED",
  "RETURNED",
  "IN_REPAIR",
  "DAMAGED",
  "LOST",
  "RETIRED",
] as const;

export type AssetStatus = (typeof ASSET_STATUSES)[number];

/**
 * Mirrors AssetResponse in backend/app/schemas/schemas.py.
 * Field names deliberately match the backend's snake_case so there is no
 * mapping layer to drift out of sync.
 */
export interface Asset {
  id: string;
  company_id: string;
  asset_tag: string;
  serial_number: string;
  name: string;
  category: string;
  type: string | null;
  brand: string | null;
  model: string | null;
  purchase_date: string | null;
  purchase_price: string | number;
  vendor_id: string | null;
  warranty_start: string | null;
  warranty_end: string | null;
  location_id: string | null;
  department_id: string | null;
  condition: string;
  description: string | null;
  status: AssetStatus;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  /** Derived server-side from the active asset_assignments row. */
  assigned_to_id: string | null;
  assigned_to_name: string | null;
  assigned_to_email: string | null;
}

/** Mirrors AssetLifecycleResponse. */
export interface AssetLifecycleEntry {
  id: string;
  asset_id: string;
  action: string;
  previous_status: string | null;
  new_status: string;
  performed_by: string;
  remarks: string | null;
  timestamp: string;
}

/** The `metrics` object returned by GET /api/dashboard/overview. */
export interface DashboardMetrics {
  total_assets: number;
  assigned_assets: number;
  in_stock_assets: number;
  under_maintenance: number;
  pending_requests: number;
  low_stock_alerts: number;
  total_asset_valuation: number;
}

const STATUS_LABEL: Record<AssetStatus, string> = {
  IN_STOCK: "In stock",
  REQUESTED: "Requested",
  ASSIGNED: "Assigned",
  IN_USE: "In use",
  RETURN_REQUESTED: "Return requested",
  RETURNED: "Returned",
  IN_REPAIR: "In repair",
  DAMAGED: "Damaged",
  LOST: "Lost",
  RETIRED: "Retired",
};

const STATUS_STYLE: Record<AssetStatus, string> = {
  IN_STOCK: "bg-blue-50 text-blue-700 ring-blue-600/20",
  REQUESTED: "bg-indigo-50 text-indigo-700 ring-indigo-600/20",
  ASSIGNED: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  IN_USE: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  RETURN_REQUESTED: "bg-amber-50 text-amber-700 ring-amber-600/20",
  RETURNED: "bg-slate-100 text-slate-600 ring-slate-500/20",
  IN_REPAIR: "bg-amber-50 text-amber-700 ring-amber-600/20",
  DAMAGED: "bg-rose-50 text-rose-700 ring-rose-600/20",
  LOST: "bg-rose-50 text-rose-700 ring-rose-600/20",
  RETIRED: "bg-slate-100 text-slate-600 ring-slate-500/20",
};

const UNKNOWN_STATUS_STYLE = "bg-slate-100 text-slate-600 ring-slate-500/20";

/** Tolerant of unknown values so an added backend status cannot crash a page. */
export function assetStatusLabel(status: string): string {
  return STATUS_LABEL[status as AssetStatus] ?? status;
}

export function assetStatusStyle(status: string): string {
  return STATUS_STYLE[status as AssetStatus] ?? UNKNOWN_STATUS_STYLE;
}

export function formatDate(value: string | null): string {
  if (!value) return "\u2014";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "\u2014";
  return parsed.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}
