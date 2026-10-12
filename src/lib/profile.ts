import { apiFetch } from "@/lib/api";

/** Mirrors UserProfile from GET /api/profile (role uses frontend names, e.g. IT_AGENT). */
export interface Profile {
  id: string;
  name: string;
  email: string;
  role: string;
  department: string | null;
  companyId: string | null;
  companyName: string | null;
  agentId: string | null;
  location: string | null;
  /** Sub-admin modules (HAM, SAM, CLOUD, SCAN, REPORTS); empty for other roles. */
  modules?: string[];
  memberSince: string | null;
  /** The sign-in before the current one. */
  previousLoginAt: string | null;
}

export interface ProfileActivity {
  id: string;
  action: string;
  entity: string;
  new_value: string | null;
  timestamp: string;
}

/** Fired after the profile changes so the top bar can refresh the name. */
export const PROFILE_UPDATED_EVENT = "itam:profile-updated";

export async function updateProfile(input: { name: string; location?: string }): Promise<Profile> {
  const data = await apiFetch<{ user: Profile }>("/api/profile", { method: "PUT", body: JSON.stringify(input) });
  window.dispatchEvent(new Event(PROFILE_UPDATED_EVENT));
  return data.user;
}

export function getMyActivity(limit = 15): Promise<ProfileActivity[]> {
  return apiFetch<ProfileActivity[]>(`/api/profile/activity?limit=${limit}`);
}

export async function getProfile(): Promise<Profile> {
  const data = await apiFetch<{ user: Profile }>("/api/profile");
  return data.user;
}

export function changePassword(currentPassword: string, newPassword: string): Promise<{ message: string }> {
  return apiFetch("/api/auth/change-password", {
    method: "POST",
    body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
  });
}
