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
  /** Profile photo as a data URL. */
  avatarUrl: string | null;
  phone: string | null;
  jobTitle: string | null;
  employeeId: string | null;
  bio: string | null;
  /** As the user typed them on their profile (display only). */
  organizationName: string | null;
  organizationId: string | null;
}

export interface ProfileInput {
  name: string;
  location?: string;
  phone?: string;
  jobTitle?: string;
  employeeId?: string;
  bio?: string;
  organizationName?: string;
  organizationId?: string;
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

export async function updateProfile(input: ProfileInput): Promise<Profile> {
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

/** Upload a profile photo (a data URL; see resizePhoto). */
export async function uploadAvatar(image: string): Promise<Profile> {
  const data = await apiFetch<{ user: Profile }>("/api/profile/avatar", { method: "PUT", body: JSON.stringify({ image }) });
  window.dispatchEvent(new Event(PROFILE_UPDATED_EVENT));
  return data.user;
}

export async function removeAvatar(): Promise<Profile> {
  const data = await apiFetch<{ user: Profile }>("/api/profile/avatar", { method: "DELETE" });
  window.dispatchEvent(new Event(PROFILE_UPDATED_EVENT));
  return data.user;
}

/** Crop a photo to a centred square and shrink it to 256×256 JPEG, as a data URL. */
export function resizePhoto(file: File, size = 256): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const side = Math.min(img.width, img.height);
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const context = canvas.getContext("2d");
      if (!context) {
        URL.revokeObjectURL(url);
        reject(new Error("Your browser could not process this image."));
        return;
      }
      context.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", 0.85));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("That file is not an image we can read."));
    };
    img.src = url;
  });
}
