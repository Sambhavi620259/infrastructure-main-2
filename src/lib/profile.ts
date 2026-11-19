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

export async function changePassword(currentPassword: string, newPassword: string): Promise<{ message: string }> {
  const result = await apiFetch<{ message: string; access_token?: string }>("/api/auth/change-password", {
    method: "POST",
    body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
  });
  // Changing the password signs out every older token; keep this session going with the new one.
  if (result.access_token && typeof window !== "undefined") {
    window.localStorage.setItem("auth-token", result.access_token);
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `auth-token=${encodeURIComponent(result.access_token)}; Path=/; Max-Age=43200; SameSite=Lax${secure}`;
  }
  return { message: result.message };
}
