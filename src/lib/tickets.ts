import { apiFetch } from "@/lib/api";

/**
 * Ticket flow: Pending -> In progress -> Approved (waiting for stock) -> Fulfilled,
 * or Rejected / Cancelled. Mirrors RequestStatusEnum and _NEXT_STATUS in the backend.
 */
export const TICKET_STATUSES = ["PENDING", "IN_PROGRESS", "APPROVED", "FULFILLED", "REJECTED", "CANCELLED"] as const;

export type TicketStatus = (typeof TICKET_STATUSES)[number];

const TICKET_STATUS_META: Record<TicketStatus, { label: string; style: string }> = {
  PENDING: { label: "Pending", style: "bg-amber-50 text-amber-700 ring-amber-200" },
  IN_PROGRESS: { label: "In progress", style: "bg-blue-50 text-blue-700 ring-blue-200" },
  APPROVED: { label: "Approved · awaiting stock", style: "bg-violet-50 text-violet-700 ring-violet-200" },
  FULFILLED: { label: "Fulfilled", style: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  REJECTED: { label: "Rejected", style: "bg-rose-50 text-rose-700 ring-rose-200" },
  CANCELLED: { label: "Cancelled", style: "bg-slate-100 text-slate-600 ring-slate-200" },
};

/** Problem tickets (ISSUE) end as "Resolved" rather than "Fulfilled". */
export function ticketStatusLabel(status: string, ticketType?: string): string {
  if (ticketType === "ISSUE" && status === "FULFILLED") return "Resolved";
  if (ticketType === "SOFTWARE" && status === "FULFILLED") return "Seat assigned";
  if (ticketType === "SOFTWARE" && status === "APPROVED") return "Approved · awaiting seat";
  if (ticketType === "RETURN" && status === "FULFILLED") return "Returned";
  if (ticketType === "RETURN" && status === "APPROVED") return "Approved · awaiting handover";
  return TICKET_STATUS_META[status as TicketStatus]?.label ?? status;
}

export function ticketStatusStyle(status: string): string {
  return TICKET_STATUS_META[status as TicketStatus]?.style ?? TICKET_STATUS_META.CANCELLED.style;
}

/** Tickets still being worked. */
export function isOpenTicket(status: string): boolean {
  return status === "PENDING" || status === "IN_PROGRESS" || status === "APPROVED";
}

/** The asset a problem ticket is about (mirrors TicketAsset). */
export interface TicketAsset {
  id: string;
  asset_tag: string;
  name: string;
  category: string;
  brand: string | null;
  model: string | null;
  serial_number: string;
  status: string;
  condition: string | null;
  warranty_end: string | null;
}

export type TicketType = "REQUEST" | "ISSUE" | "SOFTWARE" | "RETURN";

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
  /** REQUEST asks for an asset; ISSUE reports a problem with the requester's asset. */
  ticket_type: TicketType;
  asset_id: string | null;
  asset: TicketAsset | null;
  /** What the admin did to resolve a problem ticket. */
  resolution_note: string | null;
  /** SOFTWARE tickets: the product asked for and the seat given. */
  software_id: string | null;
  software_name: string | null;
  license_assignment_id: string | null;
  /** RETURN tickets: condition confirmed at handover. */
  return_condition: string | null;
}

export interface AssetRequestCreateInput {
  ticket_type?: TicketType;
  /** Required for REQUEST tickets. */
  asset_category_id?: string;
  /** Required for ISSUE and RETURN tickets: an asset assigned to the requester. */
  asset_id?: string;
  /** Required for SOFTWARE tickets. */
  software_id?: string;
  reason: string;
  priority?: string;
  /** Raise the ticket for another user in the organization; they receive the asset on approval. */
  requested_for_user_id?: string;
  department_id?: string;
}

export interface AssetRequestCounts {
  pending: number;
  in_progress: number;
  /** Approved, waiting for stock. */
  approved: number;
  fulfilled: number;
  /** Pending + in progress + approved. */
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
    /** Problem tickets about this asset. */
    asset_id?: string;
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

function moveTicket(id: string, body: Record<string, string>): Promise<AssetRequest> {
  return apiFetch<AssetRequest>(`/api/asset-requests/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

/** Pick the ticket up: In progress, handled by the caller. */
export function startTicket(id: string): Promise<AssetRequest> {
  return moveTicket(id, { status: "IN_PROGRESS" });
}

/** Put an in-progress ticket back in the queue for someone else. */
export function releaseTicket(id: string): Promise<AssetRequest> {
  return moveTicket(id, { status: "PENDING" });
}

/** Agree to the request while no suitable asset is in stock yet. */
export function approveTicket(id: string): Promise<AssetRequest> {
  return moveTicket(id, { status: "APPROVED" });
}

/** Hand an in-stock asset to the requester; the ticket becomes Fulfilled. */
export function fulfilTicket(id: string, assignedAssetId: string): Promise<AssetRequest> {
  return moveTicket(id, { status: "FULFILLED", assigned_asset_id: assignedAssetId });
}

export function rejectTicket(id: string, reason: string): Promise<AssetRequest> {
  return moveTicket(id, { status: "REJECTED", rejection_reason: reason });
}

/** Close a problem ticket with a note on what was done. */
export function resolveTicket(id: string, note: string): Promise<AssetRequest> {
  return moveTicket(id, { status: "FULFILLED", resolution_note: note });
}

/** Fulfil an approved software request: a seat is taken now (re-checked), from `licenseId` or any license with room. */
export function fulfilSoftwareTicket(id: string, licenseId?: string): Promise<AssetRequest> {
  return moveTicket(id, licenseId ? { status: "FULFILLED", license_id: licenseId } : { status: "FULFILLED" });
}

export const RETURN_CONDITIONS = ["EXCELLENT", "GOOD", "FAIR", "POOR", "DAMAGED"] as const;

/** Confirm a returned device was handed back, and in what condition (poor goes to repair, damaged is filed as damaged). */
export function confirmReturnTicket(id: string, condition: (typeof RETURN_CONDITIONS)[number]): Promise<AssetRequest> {
  return moveTicket(id, { status: "FULFILLED", return_condition: condition });
}

export function cancelTicket(id: string): Promise<AssetRequest> {
  return moveTicket(id, { status: "CANCELLED" });
}
