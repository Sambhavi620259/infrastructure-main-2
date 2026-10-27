import { apiFetch } from "@/lib/api";
import type { AppUser, Department } from "@/types/user";

export type UserListParams = {
  department_id?: string;
  skip?: number;
  limit?: number;
};

export type UserCreateInput = {
  email: string;
  full_name: string;
  password: string;
  role: string;
  location?: string;
  department_id?: string;
  modules?: string[];
  /** Super Admin only: the company the person joins. */
  company_id?: string;
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

/**
 * GET /api/users — returns a bare array.
 * Note: unlike /api/assets this endpoint has no `search` parameter, so callers
 * filter the loaded page client-side (see BUG-17 in CHANGES-REQUESTED.md).
 */
export function listUsers(params: UserListParams = {}): Promise<AppUser[]> {
  return apiFetch<AppUser[]>(`/api/users${buildQuery({ ...params })}`);
}

export function createUser(input: UserCreateInput): Promise<AppUser> {
  return apiFetch<AppUser>("/api/users", { method: "POST", body: JSON.stringify(input) });
}

/** A colleague as an IT Agent sees them: enough to pick in a form, no contact details. */
export interface DirectoryEntry {
  id: string;
  full_name: string;
  department_id: string | null;
}

/** GET /api/users/directory — active users in your organization, names only. Used by agent pages. */
export function listUserDirectory(options: { onlyUsers?: boolean } = {}): Promise<DirectoryEntry[]> {
  return apiFetch<DirectoryEntry[]>(`/api/users/directory${options.onlyUsers ? "?only_users=true" : ""}`);
}

export function listDepartments(): Promise<Department[]> {
  return apiFetch<Department[]>("/api/departments");
}

export function createDepartment(input: {
  name: string;
  description?: string;
  department_head?: string;
}): Promise<Department> {
  return apiFetch<Department>("/api/departments", { method: "POST", body: JSON.stringify(input) });
}

/** DELETE /api/departments/{id} — refused (409) while users or assets are still in it. */
export async function deleteDepartment(departmentId: string): Promise<void> {
  const token = window.localStorage.getItem("auth-token");
  const response = await fetch(`/api/departments/${encodeURIComponent(departmentId)}`, {
    method: "DELETE",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as { detail?: string };
    throw new Error(data.detail || `Delete failed (${response.status})`);
  }
}

/** GET /api/users/unassigned — IT Agents who signed up and are not in any organization yet. */
export function listUnassignedAgents(): Promise<AppUser[]> {
  return apiFetch<AppUser[]>("/api/users/unassigned");
}

/** POST /api/users/{id}/add-to-organization — move a self-registered agent into the admin's organization. */
export function addToOrganization(userId: string): Promise<AppUser> {
  return apiFetch<AppUser>(`/api/users/${encodeURIComponent(userId)}/add-to-organization`, { method: "POST" });
}

/** DELETE /api/users/{id} — deactivates the account (it can no longer sign in). Reversible. */
export async function removeUser(userId: string): Promise<void> {
  const token = window.localStorage.getItem("auth-token");
  const response = await fetch(`/api/users/${encodeURIComponent(userId)}`, {
    method: "DELETE",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as { detail?: string };
    throw new Error(data.detail || `Remove failed (${response.status})`);
  }
}

export function reactivateUser(userId: string): Promise<AppUser> {
  return apiFetch<AppUser>(`/api/users/${encodeURIComponent(userId)}/reactivate`, { method: "POST" });
}

export interface ActivitySummary {
  tickets_raised: number;
  /** Raised by them and still open (pending, in progress or awaiting stock). */
  tickets_raised_pending: number;
  /** Tickets they are handling right now. */
  tickets_in_progress: number;
  tickets_approved: number;
  tickets_rejected: number;
  assets_assigned: number;
  assets_unassigned: number;
  asset_status_changes: number;
  stock_adjustments: number;
  reports_generated: number;
  assets_held: number;
}

export interface ActivityEntry {
  id: string;
  action: string;
  entity: string;
  entity_id: string | null;
  old_value: string | null;
  new_value: string | null;
  timestamp: string;
}

export interface UserActivity {
  user: AppUser;
  summary: ActivitySummary;
  last_active_at: string | null;
  recent: ActivityEntry[];
}

/** GET /api/users/{id}/activity — admins review one user's work. */
export function getUserActivity(userId: string): Promise<UserActivity> {
  return apiFetch<UserActivity>(`/api/users/${encodeURIComponent(userId)}/activity`);
}

/** POST /api/users/{id}/reset-password — admins set a temporary password. */
export function resetUserPassword(userId: string, newPassword: string): Promise<{ message: string }> {
  return apiFetch(`/api/users/${encodeURIComponent(userId)}/reset-password`, {
    method: "POST",
    body: JSON.stringify({ new_password: newPassword }),
  });
}
