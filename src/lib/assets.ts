import { apiFetch } from "@/lib/api";
import type { Asset, AssetLifecycleEntry, DashboardMetrics } from "@/types/asset";

export type AssetListParams = {
  search?: string;
  status?: string;
  category?: string;
  department_id?: string;
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
