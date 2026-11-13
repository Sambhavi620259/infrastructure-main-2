import { apiFetch } from "@/lib/api";

export interface DashboardCounts {
  assets: { total: number; in_stock: number; assigned: number; in_repair: number };
  tickets: { pending: number; open: number; my_open: number; needs_action?: number };
  users: { total: number; active: number; employees?: number };
  inventory: { total: number; low_stock: number };
}

export async function getDashboardCounts(): Promise<DashboardCounts> {
  const [assets, tickets, inventory, users] = await Promise.all([
    apiFetch<{ total: number; in_stock: number; assigned: number; in_repair: number }>("/api/assets/counts"),
    apiFetch<{ pending: number; open: number; my_open: number; needs_action?: number }>("/api/asset-requests/counts"),
    apiFetch<{ total: number; low_stock: number }>("/api/inventory/counts"),
    apiFetch<{ total: number; active: number; employees?: number }>("/api/users/counts"),
  ]);
  return { assets, tickets, inventory, users };
}