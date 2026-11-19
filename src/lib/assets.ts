import { apiFetch } from "@/lib/api";
import type {
  Asset,
  AssetCounts,
  AssetEvent,
  AssetLifecycleEntry,
  AssetStatus,
  DashboardMetrics,
} from "@/types/asset";

export type AssetListParams = {
  search?: string;
  status?: string;
  category?: string;
  department_id?: string;
  /** Only assets this user currently holds. */
  assigned_to?: string;
  skip?: number;
  limit?: number;
};

export type AssetCreateInput = {
  asset_tag: string;
  serial_number: string;
  name: string;
  category: string;
  type?: string;
  brand?: string;
  model?: string;
  description?: string;
  condition?: string;
  department_id?: string;
  vendor_id?: string;
  location_id?: string;
  purchase_date?: string;
  purchase_price?: number;
  warranty_start?: string;
  warranty_end?: string;
};

function buildQuery(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === "") continue;
    search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `?${query}` : "";
}

/** GET /api/assets — returns a bare array, not an envelope. */
export function listAssets(params: AssetListParams = {}): Promise<Asset[]> {
  return apiFetch<Asset[]>(`/api/assets${buildQuery({ ...params })}`);
}

export function getAsset(assetId: string): Promise<Asset> {
  return apiFetch<Asset>(`/api/assets/${encodeURIComponent(assetId)}`);
}

export function listAssetLifecycle(assetId: string): Promise<AssetLifecycleEntry[]> {
  return apiFetch<AssetLifecycleEntry[]>(`/api/assets/${encodeURIComponent(assetId)}/lifecycle`);
}

export function createAsset(input: AssetCreateInput): Promise<Asset> {
  return apiFetch<Asset>("/api/assets", { method: "POST", body: JSON.stringify(input) });
}

export type AssetUpdateInput = Partial<
  Pick<
    Asset,
    | "name"
    | "category"
    | "type"
    | "brand"
    | "model"
    | "condition"
    | "description"
    | "location_id"
    | "department_id"
    | "vendor_id"
    | "purchase_date"
    | "warranty_start"
    | "warranty_end"
  >
> & {
  purchase_price?: number;
  status?: AssetStatus;
  /** Stored on the lifecycle entry when the status changes. */
  status_remarks?: string;
};

/** PUT /api/assets/{id} — setting status to ASSIGNED is refused; use assignAsset. */
export function updateAsset(assetId: string, input: AssetUpdateInput): Promise<Asset> {
  return apiFetch<Asset>(`/api/assets/${encodeURIComponent(assetId)}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

/** DELETE /api/assets/{id}: refused while someone holds the asset; unassign it first. */
export function deleteAsset(assetId: string): Promise<void> {
  return apiFetch<void>(`/api/assets/${encodeURIComponent(assetId)}`, { method: "DELETE" });
}

/** GET /api/assets/counts — includes a count for every status. */
export function getAssetCounts(): Promise<AssetCounts> {
  return apiFetch<AssetCounts>("/api/assets/counts");
}

export type AssetEventParams = {
  search?: string;
  action?: string;
  date_from?: string;
  date_to?: string;
  skip?: number;
  limit?: number;
};

/** GET /api/assets/events — company-wide lifecycle events, newest first. */
export function listAssetEvents(params: AssetEventParams = {}): Promise<AssetEvent[]> {
  return apiFetch<AssetEvent[]>(`/api/assets/events${buildQuery({ ...params })}`);
}

/** GET /api/dashboard/overview — unwraps the `metrics` key. */
export async function getDashboardMetrics(): Promise<DashboardMetrics> {
  const data = await apiFetch<{ metrics: DashboardMetrics }>("/api/dashboard/overview");
  return data.metrics;
}

/** POST /api/assets/{id}/assign — the asset must be IN_STOCK or REQUESTED. */
export function assignAsset(assetId: string, userId: string): Promise<Asset> {
  return apiFetch<Asset>(`/api/assets/${encodeURIComponent(assetId)}/assign`, {
    method: "POST",
    body: JSON.stringify({ user_id: userId }),
  });
}

/** POST /api/assets/{id}/unassign — returns the asset to IN_STOCK. */
export function unassignAsset(assetId: string): Promise<Asset> {
  return apiFetch<Asset>(`/api/assets/${encodeURIComponent(assetId)}/unassign`, { method: "POST" });
}
