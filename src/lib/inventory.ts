import { apiFetch } from "@/lib/api";

export interface InventoryItem {
  id: string;
  company_id: string;
  name: string;
  category: string;
  quantity: number;
  reorder_level: number;
  unit_cost: string;
  location: string | null;
  status: string;
}

export interface InventoryCreateInput {
  name: string;
  category: string;
  quantity: number;
  reorder_level: number;
  unit_cost?: number;
  location?: string;
}

export interface InventoryCounts {
  total: number;
  low_stock: number;
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

export function listInventory(params: { skip?: number; limit?: number; category?: string } = {}): Promise<InventoryItem[]> {
  return apiFetch<InventoryItem[]>(`/api/inventory${buildQuery({ ...params })}`);
}

export function createInventory(input: InventoryCreateInput): Promise<InventoryItem> {
  return apiFetch<InventoryItem>("/api/inventory", { method: "POST", body: JSON.stringify(input) });
}

export function getInventoryCounts(): Promise<InventoryCounts> {
  return apiFetch<InventoryCounts>("/api/inventory/counts");
}

export function updateInventory(id: string, input: Partial<InventoryCreateInput>): Promise<InventoryItem> {
  return apiFetch<InventoryItem>(`/api/inventory/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(input) });
}

export function deleteInventory(id: string): Promise<void> {
  return apiFetch<void>(`/api/inventory/${encodeURIComponent(id)}`, { method: "DELETE" });
}

/** POST /api/inventory/{id}/adjust — receive (+) or issue (-) stock with a reason. Open to IT Agents. */
export function adjustInventoryStock(id: string, change: number, reason: string): Promise<InventoryItem> {
  return apiFetch<InventoryItem>(`/api/inventory/${encodeURIComponent(id)}/adjust`, {
    method: "POST",
    body: JSON.stringify({ change, reason }),
  });
}
