import { apiFetch } from "@/lib/api";

/**
 * Ticket flow (stored value -> label): PENDING (Submitted) -> UNDER_REVIEW ->
 * PENDING_APPROVAL -> APPROVED -> IN_PROGRESS -> FULFILLED (Resolved) -> CLOSED,
 * with WAITING_INVENTORY / WAITING_LICENSE / WAITING_USER on the way and
 * REJECTED / CANCELLED ending a ticket early. Mirrors RequestStatusEnum and
 * _NEXT_STATUS in backend/app/routers/asset_requests.py, which enforces it.
 */
export const TICKET_STATUSES = [
  "PENDING",
  "UNDER_REVIEW",
  "PENDING_APPROVAL",
  "APPROVED",
  "IN_PROGRESS",
  "WAITING_INVENTORY",
  "WAITING_LICENSE",
  "WAITING_USER",
  "FULFILLED",
  "CLOSED",
  "REJECTED",
  "CANCELLED",
] as const;

export type TicketStatus = (typeof TICKET_STATUSES)[number];

const TICKET_STATUS_META: Record<TicketStatus, { label: string; style: string }> = {
  PENDING: { label: "Submitted", style: "bg-amber-50 text-amber-700 ring-amber-200" },
  UNDER_REVIEW: { label: "Under review", style: "bg-blue-50 text-blue-700 ring-blue-200" },
  PENDING_APPROVAL: { label: "Pending approval", style: "bg-fuchsia-50 text-fuchsia-700 ring-fuchsia-200" },
  APPROVED: { label: "Approved", style: "bg-violet-50 text-violet-700 ring-violet-200" },
  IN_PROGRESS: { label: "In progress", style: "bg-sky-50 text-sky-700 ring-sky-200" },
  WAITING_INVENTORY: { label: "Waiting for inventory", style: "bg-orange-50 text-orange-700 ring-orange-200" },
  WAITING_LICENSE: { label: "Waiting for license", style: "bg-orange-50 text-orange-700 ring-orange-200" },
  WAITING_USER: { label: "Waiting for user", style: "bg-yellow-50 text-yellow-800 ring-yellow-200" },
  FULFILLED: { label: "Resolved", style: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  CLOSED: { label: "Closed", style: "bg-slate-100 text-slate-700 ring-slate-200" },
  REJECTED: { label: "Rejected", style: "bg-rose-50 text-rose-700 ring-rose-200" },
  CANCELLED: { label: "Cancelled", style: "bg-slate-100 text-slate-500 ring-slate-200" },
};

export function ticketStatusLabel(status: string, ticketType?: string): string {
  if (status === "FULFILLED") {
    if (ticketType === "SOFTWARE") return "Resolved · seat assigned";
    if (ticketType === "RETURN") return "Resolved · returned";
    if (ticketType === "ACCESS") return "Resolved · access granted";
  }
  return TICKET_STATUS_META[status as TicketStatus]?.label ?? status;
}

export function ticketStatusStyle(status: string): string {
  return TICKET_STATUS_META[status as TicketStatus]?.style ?? TICKET_STATUS_META.CANCELLED.style;
}

/** Tickets still being worked (everything before Resolved). */
export function isOpenTicket(status: string): boolean {
  return !["FULFILLED", "CLOSED", "REJECTED", "CANCELLED"].includes(status);
}

export const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const PRIORITY_STYLE: Record<string, string> = {
  LOW: "bg-slate-100 text-slate-600",
  MEDIUM: "bg-blue-50 text-blue-700",
  HIGH: "bg-orange-50 text-orange-700",
  CRITICAL: "bg-rose-600 text-white",
};

export function priorityLabel(priority: string): string {
  return priority.charAt(0) + priority.slice(1).toLowerCase();
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

export type TicketType = "REQUEST" | "ISSUE" | "SOFTWARE" | "RETURN" | "ACCESS";

export const TICKET_TYPE_LABEL: Record<TicketType, string> = {
  REQUEST: "Hardware",
  SOFTWARE: "Software",
  ACCESS: "Access",
  ISSUE: "Problem",
  RETURN: "Return",
};

export interface TicketApproval {
  id: string;
  approver_id: string;
  approver_name: string | null;
  /** APPROVER (IT) or OWNER (resource owner). */
  kind: string;
  decision: "APPROVED" | "REJECTED" | string;
  note: string | null;
  created_at: string;
}

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
  ticket_type: TicketType;
  asset_id: string | null;
  asset: TicketAsset | null;
  /** What the admin did to resolve a problem ticket. */
  resolution_note: string | null;
  /** SOFTWARE tickets: the product asked for and the seat given. */
  software_id: string | null;
  software_name: string | null;
  /** Software asked for by name because it was not registered yet. */
  requested_software_name?: string | null;
  license_assignment_id: string | null;
  /** RETURN tickets: condition confirmed at handover. */
  return_condition: string | null;
  /** Per-organization number, shown as TKT-000123. */
  ticket_no?: number | null;
  priority?: string;
  required_date?: string | null;
  additional_comments?: string | null;
  assignee_id?: string | null;
  assignee_name?: string | null;
  /** Waiting for inventory / license. */
  expected_date?: string | null;
  procurement_note?: string | null;
  resolved_at?: string | null;
  closed_at?: string | null;
  reopen_count?: number;
  /** ACCESS tickets. */
  access_resource_id?: string | null;
  access_resource_name?: string | null;
  access_level?: string | null;
  access_until?: string | null;
  access_grant_id?: string | null;
  requester_employee_id?: string | null;
  owner_id?: string | null;
  owner_name?: string | null;
  needs_owner_approval?: boolean;
  approvals?: TicketApproval[];
  attachment_count?: number;
  comment_count?: number;
}

export interface AssetRequestCreateInput {
  ticket_type?: TicketType;
  /** Required for REQUEST tickets. */
  asset_category_id?: string;
  /** Required for ISSUE and RETURN tickets: an asset assigned to the requester. */
  asset_id?: string;
  /** SOFTWARE tickets: the registered product, or requested_software_name when it is not listed. */
  software_id?: string;
  requested_software_name?: string;
  /** ACCESS tickets. */
  access_resource_id?: string;
  access_level?: string;
  access_until?: string;
  reason: string;
  priority?: Priority;
  required_date?: string;
  additional_comments?: string;
  /** Raise the ticket for another user in the organization; they receive the asset on approval. */
  requested_for_user_id?: string;
  department_id?: string;
}

export interface AssetRequestCounts {
  total: number;
  pending: number;
  submitted: number;
  under_review: number;
  pending_approval: number;
  in_progress: number;
  approved: number;
  waiting_inventory: number;
  waiting_license: number;
  waiting_user: number;
  fulfilled: number;
  resolved: number;
  closed: number;
  rejected: number;
  cancelled: number;
  /** Everything not yet resolved. */
  open: number;
  /** Open and High or Critical. */
  high_priority: number;
  /** Waiting on the IT team. */
  needs_action: number;
  my_open: number;
  assigned_to_me: number;
  /** Access requests waiting for the caller's approval as resource owner. */
  awaiting_my_approval: number;
}

export interface AssetCategory {
  id: string;
  company_id: string;
  name: string;
  description: string | null;
}

export interface TicketComment {
  id: string;
  ticket_id: string;
  author_id: string;
  author_name: string | null;
  author_is_staff: boolean;
  body: string;
  internal: boolean;
  created_at: string;
}

export interface TicketAttachment {
  id: string;
  ticket_id: string;
  filename: string;
  content_type: string;
  size: number;
  uploaded_by: string;
  uploaded_by_name: string | null;
  created_at: string;
}

export interface TicketEvent {
  id: string;
  action: string;
  from_status: string | null;
  to_status: string | null;
  note: string | null;
  actor_name: string | null;
  internal: boolean;
  created_at: string;
}

export interface TeamMember {
  id: string;
  full_name: string;
  role: string;
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

const enc = encodeURIComponent;

export function ticketNumber(ticket: Pick<AssetRequest, "id"> & { ticket_no?: number | null }): string {
  return ticket.ticket_no ? `TKT-${String(ticket.ticket_no).padStart(6, "0")}` : `#${ticket.id.slice(0, 6).toUpperCase()}`;
}

export function listAssetRequests(
  params: {
    skip?: number;
    limit?: number;
    /** One status, or several separated by commas. */
    status?: string;
    mine?: boolean;
    requested_by?: string;
    raised_by?: string;
    processed_by?: string;
    /** Problem tickets about this asset. */
    asset_id?: string;
    /** Access requests waiting for my approval as resource owner. */
    awaiting_my_approval?: boolean;
  } = {},
): Promise<AssetRequest[]> {
  const { mine, awaiting_my_approval, ...rest } = params;
  return apiFetch<AssetRequest[]>(
    `/api/asset-requests${buildQuery({
      ...rest,
      mine: mine ? "true" : undefined,
      awaiting_my_approval: awaiting_my_approval ? "true" : undefined,
    })}`,
  );
}

export interface TicketSearch {
  q?: string;
  status?: string;
  ticket_type?: string;
  priority?: string;
  department_id?: string;
  requester?: string;
  assignee_id?: string;
  created_from?: string;
  created_to?: string;
  sort?: "created_at" | "ticket_no" | "status" | "required_date" | "priority";
  order?: "asc" | "desc";
  skip?: number;
  limit?: number;
}

/** One page of tickets with the total, for the ticket tables. */
export function searchTickets(params: TicketSearch): Promise<{ items: AssetRequest[]; total: number }> {
  return apiFetch(`/api/asset-requests/search${buildQuery({ ...params })}`);
}

export function getTicket(id: string): Promise<AssetRequest> {
  return apiFetch<AssetRequest>(`/api/asset-requests/${enc(id)}`);
}

export function createAssetRequest(input: AssetRequestCreateInput): Promise<AssetRequest> {
  return apiFetch<AssetRequest>("/api/asset-requests", { method: "POST", body: JSON.stringify(input) });
}

export function getAssetRequestCounts(): Promise<AssetRequestCounts> {
  return apiFetch<AssetRequestCounts>("/api/asset-requests/counts");
}

export function listTicketTeam(): Promise<TeamMember[]> {
  return apiFetch<TeamMember[]>("/api/asset-requests/team");
}

export function listAssetCategories(): Promise<AssetCategory[]> {
  return apiFetch<AssetCategory[]>("/api/assets/categories");
}

/** POST /api/assets/categories — admins and users; names are unique per organization. */
export function createAssetCategory(name: string): Promise<AssetCategory> {
  return apiFetch<AssetCategory>("/api/assets/categories", { method: "POST", body: JSON.stringify({ name }) });
}

/** Any status change; the backend checks the transition, the approval rule and what each step needs. */
export function moveTicket(id: string, body: Record<string, string | null | undefined>): Promise<AssetRequest> {
  return apiFetch<AssetRequest>(`/api/asset-requests/${enc(id)}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

/** Pick the ticket up: In progress, handled by the caller. */
export function startTicket(id: string): Promise<AssetRequest> {
  return moveTicket(id, { status: "IN_PROGRESS" });
}

export function reviewTicket(id: string): Promise<AssetRequest> {
  return moveTicket(id, { status: "UNDER_REVIEW" });
}

/** Put a ticket back in the queue for someone else. */
export function releaseTicket(id: string): Promise<AssetRequest> {
  return moveTicket(id, { status: "PENDING" });
}

/** Approve; for hardware, optionally reserve an in-stock device until handover. */
export function approveTicket(id: string, reserveAssetId?: string, note?: string): Promise<AssetRequest> {
  return moveTicket(id, { status: "APPROVED", reserve_asset_id: reserveAssetId, note });
}

export function sendForApproval(id: string, note?: string): Promise<AssetRequest> {
  return moveTicket(id, { status: "PENDING_APPROVAL", note });
}

/** Hand an in-stock (or the reserved) asset to the requester; the ticket becomes Resolved. */
export function fulfilTicket(id: string, assignedAssetId?: string): Promise<AssetRequest> {
  return moveTicket(id, { status: "FULFILLED", assigned_asset_id: assignedAssetId });
}

export function rejectTicket(id: string, reason: string): Promise<AssetRequest> {
  return moveTicket(id, { status: "REJECTED", rejection_reason: reason });
}

/** Resolve a problem ticket with a note on what was done. */
export function resolveTicket(id: string, note: string): Promise<AssetRequest> {
  return moveTicket(id, { status: "FULFILLED", resolution_note: note });
}

/** Fulfil a software request: a seat is taken now (re-checked), from `licenseId` or any license with room. */
export function fulfilSoftwareTicket(
  id: string,
  licenseId?: string,
  softwareId?: string,
  deploymentStatus?: string,
): Promise<AssetRequest> {
  // softwareId: for a request made by name, the registered software to give.
  return moveTicket(id, {
    status: "FULFILLED",
    license_id: licenseId,
    software_id: softwareId,
    deployment_status: deploymentStatus,
  });
}

/** Record an approved access request as granted (no system is changed automatically). */
export function grantAccessTicket(id: string, accessUntil?: string): Promise<AssetRequest> {
  return moveTicket(id, { status: "FULFILLED", access_until: accessUntil });
}

/** Wait for inventory or a license, with the expected date and/or procurement notes. */
export function waitTicket(
  id: string,
  status: "WAITING_INVENTORY" | "WAITING_LICENSE",
  expectedDate?: string,
  procurementNote?: string,
): Promise<AssetRequest> {
  return moveTicket(id, { status, expected_date: expectedDate, procurement_note: procurementNote });
}

/** Ask the requester for more information (sent to them as a comment). */
export function askRequester(id: string, note: string): Promise<AssetRequest> {
  return moveTicket(id, { status: "WAITING_USER", note });
}

export function closeTicket(id: string): Promise<AssetRequest> {
  return moveTicket(id, { status: "CLOSED" });
}

export const RETURN_CONDITIONS = ["EXCELLENT", "GOOD", "FAIR", "POOR", "DAMAGED"] as const;

/** Confirm a returned device was handed back, and in what condition (poor goes to repair, damaged is filed as damaged). */
export function confirmReturnTicket(id: string, condition: (typeof RETURN_CONDITIONS)[number]): Promise<AssetRequest> {
  return moveTicket(id, { status: "FULFILLED", return_condition: condition });
}

export function cancelTicket(id: string): Promise<AssetRequest> {
  return moveTicket(id, { status: "CANCELLED" });
}

/** Users delete their own ticket only while Submitted, or after it was Cancelled or Rejected (the API enforces it). */
export function userCanDelete(status: string): boolean {
  return ["PENDING", "CANCELLED", "REJECTED"].includes(status);
}

/** Delete a ticket with its comments, files and history. IT Admins: any ticket; users: see userCanDelete. */
export async function deleteTicket(id: string): Promise<void> {
  await apiFetch<unknown>(`/api/asset-requests/${enc(id)}`, { method: "DELETE" });
}

export function assignTicket(id: string, assigneeId: string | null): Promise<AssetRequest> {
  return apiFetch<AssetRequest>(`/api/asset-requests/${enc(id)}/assign`, {
    method: "POST",
    body: JSON.stringify({ assignee_id: assigneeId }),
  });
}

/** The requester confirms a resolved ticket: it is closed. */
export function confirmTicket(id: string): Promise<AssetRequest> {
  return apiFetch<AssetRequest>(`/api/asset-requests/${enc(id)}/confirm`, { method: "POST" });
}

export function reopenTicket(id: string, reason: string): Promise<AssetRequest> {
  return apiFetch<AssetRequest>(`/api/asset-requests/${enc(id)}/reopen`, { method: "POST", body: JSON.stringify({ reason }) });
}

/** The resource owner approves or rejects an access request. */
export function ownerDecision(id: string, decision: "APPROVED" | "REJECTED", note?: string): Promise<AssetRequest> {
  return apiFetch<AssetRequest>(`/api/asset-requests/${enc(id)}/owner-decision`, {
    method: "POST",
    body: JSON.stringify({ decision, note }),
  });
}

export function listComments(id: string): Promise<TicketComment[]> {
  return apiFetch<TicketComment[]>(`/api/asset-requests/${enc(id)}/comments`);
}

export function addComment(id: string, body: string, internal = false): Promise<TicketComment> {
  return apiFetch<TicketComment>(`/api/asset-requests/${enc(id)}/comments`, {
    method: "POST",
    body: JSON.stringify({ body, internal }),
  });
}

export function ticketHistory(id: string): Promise<TicketEvent[]> {
  return apiFetch<TicketEvent[]>(`/api/asset-requests/${enc(id)}/history`);
}

export function listAttachments(id: string): Promise<TicketAttachment[]> {
  return apiFetch<TicketAttachment[]>(`/api/asset-requests/${enc(id)}/attachments`);
}

export const ATTACHMENT_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp", "application/pdf"];
export const MAX_ATTACHMENT_BYTES = 2 * 1024 * 1024;

/** Upload one image or PDF (up to 2 MB). The backend checks the content as well as the type. */
export async function uploadAttachment(id: string, file: File): Promise<TicketAttachment> {
  if (!ATTACHMENT_TYPES.includes(file.type)) throw new Error(`${file.name}: attach an image (PNG, JPEG, GIF, WebP) or a PDF.`);
  if (file.size > MAX_ATTACHMENT_BYTES) throw new Error(`${file.name} is larger than 2 MB.`);
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.readAsDataURL(file);
  });
  return apiFetch<TicketAttachment>(`/api/asset-requests/${enc(id)}/attachments`, {
    method: "POST",
    body: JSON.stringify({ filename: file.name, content_type: file.type, data }),
  });
}

/** Download a file with the signed-in user's token, then save it. */
export async function downloadAttachment(ticketId: string, attachment: TicketAttachment): Promise<void> {
  const token = window.localStorage.getItem("auth-token");
  const response = await fetch(`/api/asset-requests/${enc(ticketId)}/attachments/${enc(attachment.id)}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!response.ok) throw new Error(`Could not download ${attachment.filename}.`);
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = attachment.filename;
  link.click();
  URL.revokeObjectURL(url);
}
