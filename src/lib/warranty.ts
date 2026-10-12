import { apiFetch } from "@/lib/api";

export const COVERAGE_STATES = ["ACTIVE", "EXPIRING", "EXPIRED", "NONE"] as const;
export type CoverageState = (typeof COVERAGE_STATES)[number];

export const CLAIM_STATUSES = ["SUBMITTED", "IN_REVIEW", "APPROVED", "REJECTED", "RESOLVED"] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

/** Mirrors WarrantyCoverageResponse in backend/app/routers/warranty_maintenance.py. */
export interface WarrantyCoverage {
  asset_id: string;
  asset_tag: string;
  name: string;
  category: string;
  vendor_id: string | null;
  warranty_start: string | null;
  warranty_end: string | null;
  coverage: CoverageState;
  days_remaining: number | null;
}

/** Mirrors WarrantyClaimResponse. */
export interface WarrantyClaim {
  id: string;
  company_id: string;
  asset_id: string;
  asset_tag: string | null;
  asset_name: string | null;
  claim_number: string | null;
  issue_description: string;
  status: ClaimStatus;
  submitted_by: string;
  resolution_notes: string | null;
  created_at: string;
  updated_at: string;
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

export function listWarrantyCoverage(
  params: { coverage?: CoverageState; search?: string; expiring_days?: number } = {},
): Promise<WarrantyCoverage[]> {
  return apiFetch<WarrantyCoverage[]>(`/api/warranty-maintenance/coverage${buildQuery(params)}`);
}

export function listWarrantyClaims(params: { status?: ClaimStatus; asset_id?: string } = {}): Promise<WarrantyClaim[]> {
  return apiFetch<WarrantyClaim[]>(`/api/warranty-maintenance/claims${buildQuery(params)}`);
}

export function submitWarrantyClaim(input: {
  asset_id: string;
  issue_description: string;
  claim_number?: string;
}): Promise<WarrantyClaim> {
  return apiFetch<WarrantyClaim>("/api/warranty-maintenance/claims", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateWarrantyClaim(
  claimId: string,
  input: { status: ClaimStatus; resolution_notes?: string },
): Promise<WarrantyClaim> {
  return apiFetch<WarrantyClaim>(`/api/warranty-maintenance/claims/${encodeURIComponent(claimId)}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

const COVERAGE_LABEL: Record<CoverageState, string> = {
  ACTIVE: "Covered",
  EXPIRING: "Expiring soon",
  EXPIRED: "Expired",
  NONE: "No warranty",
};

const COVERAGE_STYLE: Record<CoverageState, string> = {
  ACTIVE: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  EXPIRING: "bg-amber-50 text-amber-700 ring-amber-600/20",
  EXPIRED: "bg-rose-50 text-rose-700 ring-rose-600/20",
  NONE: "bg-slate-100 text-slate-600 ring-slate-500/20",
};

export function coverageLabel(state: CoverageState): string {
  return COVERAGE_LABEL[state] ?? state;
}

export function coverageStyle(state: CoverageState): string {
  return COVERAGE_STYLE[state] ?? COVERAGE_STYLE.NONE;
}

const CLAIM_STYLE: Record<ClaimStatus, string> = {
  SUBMITTED: "bg-blue-50 text-blue-700 ring-blue-600/20",
  IN_REVIEW: "bg-indigo-50 text-indigo-700 ring-indigo-600/20",
  APPROVED: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  REJECTED: "bg-rose-50 text-rose-700 ring-rose-600/20",
  RESOLVED: "bg-slate-100 text-slate-600 ring-slate-500/20",
};

export function claimStyle(status: ClaimStatus): string {
  return CLAIM_STYLE[status] ?? CLAIM_STYLE.RESOLVED;
}
