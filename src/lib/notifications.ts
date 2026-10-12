import { apiFetch } from "@/lib/api";

export interface AppNotification {
  id: string;
  title: string;
  message: string | null;
  type: "INFO" | "SUCCESS" | "WARNING" | string;
  link: string | null;
  is_read: boolean;
  created_at: string;
}

export function listNotifications(limit = 20): Promise<AppNotification[]> {
  return apiFetch<AppNotification[]>(`/api/notifications?limit=${limit}`);
}

export async function getUnreadCount(): Promise<number> {
  return (await apiFetch<{ unread: number }>("/api/notifications/unread-count")).unread;
}

export function markNotificationRead(id: string): Promise<AppNotification> {
  return apiFetch<AppNotification>(`/api/notifications/${encodeURIComponent(id)}/read`, { method: "PUT" });
}

export function markAllNotificationsRead(): Promise<{ message: string }> {
  return apiFetch("/api/notifications/read-all", { method: "PUT" });
}
