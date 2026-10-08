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

export function listDepartments(): Promise<Department[]> {
  return apiFetch<Department[]>("/api/departments");
}

/**
 * POST /api/admin/invite — this flow exists for IT Agents only and returns a
 * token the invitee redeems at /register. It does not create an account.
 */
export function inviteAgent(email: string, department: string): Promise<{ invitationToken: string }> {
  return apiFetch<{ invitationToken: string }>("/api/admin/invite", {
    method: "POST",
    body: JSON.stringify({ email, department }),
  });
}
