import { apiFetch } from "@/lib/api";

export interface AssetRequest {
  id: string;
  company_id: string;
  requested_by: string;
  asset_category_id: string;
  department_id: string | null;
  requested_for: string;
  reason: string;
  status: string;
  assigned_asset_id: string | null;
  rejection_reason: string | null;
  created_at: string;
  /** Display names joined in by the backend. */
  requested_by_name: string | null;
  /** Who created the ticket (may differ from the person it is for). */
  raised_by: string | null;
  raised_by_name: string | null;
  category_name: string | null;
  department_name: string | null;
  assigned_asset_tag: string | null;
  processed_by: string | null;
  processed_by_name: string | null;
  processed_at: string | null;
}

export interface AssetRequestCreateInput {
  asset_category_id: string;
  reason: string;
  priority?: string;
  /** Raise the ticket for another user in the organization; they receive the asset on approval. */
  requested_for_user_id?: string;
  department_id?: string;
}

export interface AssetRequestCounts {
  pending: number;
  open: number;
  my_open: number;
}

export interface AssetCategory {
  id: string;
  company_id: string;
  name: string;
  description: string | null;
}

function buildQuery(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === "") continue;
    search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `?${query}` : "";
}

export function listAssetRequests(
  params: {
    skip?: number;
    limit?: number;
    status?: string;
    mine?: boolean;
    requested_by?: string;
    raised_by?: string;
    processed_by?: string;
  } = {},
): Promise<AssetRequest[]> {
  const { mine, ...rest } = params;
  return apiFetch<AssetRequest[]>(`/api/asset-requests${buildQuery({ ...rest, mine: mine ? "true" : undefined })}`);
}

export function createAssetRequest(input: AssetRequestCreateInput): Promise<AssetRequest> {
  return apiFetch<AssetRequest>("/api/asset-requests", { method: "POST", body: JSON.stringify(input) });
}

export function getAssetRequestCounts(): Promise<AssetRequestCounts> {
  return apiFetch<AssetRequestCounts>("/api/asset-requests/counts");
}

export function listAssetCategories(): Promise<AssetCategory[]> {
  return apiFetch<AssetCategory[]>("/api/assets/categories");
}

/** POST /api/assets/categories — admins and IT Agents; names are unique per organization. */
export function createAssetCategory(name: string): Promise<AssetCategory> {
  return apiFetch<AssetCategory>("/api/assets/categories", { method: "POST", body: JSON.stringify({ name }) });
}

/** Approving assigns the chosen in-stock asset to the person who raised the ticket. */
export function approveAssetRequest(id: string, assignedAssetId: string): Promise<AssetRequest> {
  return apiFetch<AssetRequest>(`/api/asset-requests/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify({ status: "APPROVED", assigned_asset_id: assignedAssetId }),
  });
}

export function rejectAssetRequest(id: string, reason: string): Promise<AssetRequest> {
  return apiFetch<AssetRequest>(`/api/asset-requests/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify({ status: "REJECTED", rejection_reason: reason }),
  });
}