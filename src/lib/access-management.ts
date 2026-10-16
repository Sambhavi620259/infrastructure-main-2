import { apiFetch } from "@/lib/api";

/**
 * Access management: resources people request access to, and the grants
 * recorded when an approved ACCESS ticket is fulfilled. Mirrors
 * backend/app/routers/access.py. Nothing here changes another system: a
 * grant records that an admin gave the access.
 */

export const RESOURCE_TYPES = ["APPLICATION", "DATABASE", "VPN", "SHARED_FOLDER", "EMAIL", "OTHER"] as const;
export type ResourceType = (typeof RESOURCE_TYPES)[number];

export const RESOURCE_TYPE_LABEL: Record<string, string> = {
  APPLICATION: "Application",
  DATABASE: "Database",
  VPN: "VPN",
  SHARED_FOLDER: "Shared folder",
  EMAIL: "Email / mailbox",
  OTHER: "Other",
};

export interface AccessResource {
  id: string;
  name: string;
  resource_type: string;
  description: string | null;
  owner_id: string | null;
  owner_name: string | null;
  /** Least to most privileged, e.g. Read, Write, Admin. */
  access_levels: string[];
  /** Levels that are privileged (always need the owner's approval when there is an owner). */
  privileged_levels: string[];
  /** Longest grant in days (null = no limit). */
  max_days: number | null;
  status: string;
  active_grants: number;
  created_at: string | null;
}

export interface AccessGrant {
  id: string;
  resource_id: string;
  resource_name: string | null;
  resource_type: string | null;
  user_id: string;
  user_name: string | null;
  access_level: string;
  privileged: boolean;
  ticket_id: string | null;
  granted_by_name: string | null;
  granted_at: string | null;
  expires_at: string | null;
  is_active: boolean;
  revoked_at: string | null;
  revoked_by_name: string | null;
  revoke_reason: string | null;
}

export type ResourceInput = {
  name: string;
  resource_type: ResourceType;
  description?: string;
  owner_id?: string | null;
  access_levels: string[];
  privileged_levels: string[];
  max_days?: number | null;
};

const enc = encodeURIComponent;

/** Active resources anyone in the organization can request (users see no grant counts). */
export function accessCatalog(): Promise<AccessResource[]> {
  return apiFetch<AccessResource[]>("/api/access/catalog");
}

export function myAccess(): Promise<AccessGrant[]> {
  return apiFetch<AccessGrant[]>("/api/access/mine");
}

export function listAccessResources(includeInactive = false): Promise<AccessResource[]> {
  return apiFetch<AccessResource[]>(`/api/access/resources${includeInactive ? "?include_inactive=true" : ""}`);
}

export function createAccessResource(input: ResourceInput): Promise<AccessResource> {
  return apiFetch<AccessResource>("/api/access/resources", { method: "POST", body: JSON.stringify(input) });
}

export function updateAccessResource(
  id: string,
  input: Partial<ResourceInput> & { status?: "ACTIVE" | "INACTIVE" },
): Promise<AccessResource> {
  return apiFetch<AccessResource>(`/api/access/resources/${enc(id)}`, { method: "PUT", body: JSON.stringify(input) });
}

export function listAccessGrants(params: { active?: boolean; resource_id?: string; user_id?: string } = {}): Promise<AccessGrant[]> {
  const search = new URLSearchParams();
  if (params.active !== undefined) search.set("active", String(params.active));
  if (params.resource_id) search.set("resource_id", params.resource_id);
  if (params.user_id) search.set("user_id", params.user_id);
  return apiFetch<AccessGrant[]>(`/api/access/grants?${search}`);
}

export function revokeAccessGrant(id: string, reason: string): Promise<AccessGrant> {
  return apiFetch<AccessGrant>(`/api/access/grants/${enc(id)}/revoke`, { method: "POST", body: JSON.stringify({ reason }) });
}
