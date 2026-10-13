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

/** POST /api/inventory/{id}/adjust — receive (+) or issue (-) stock with a reason. Admins only. */
export function adjustInventoryStock(id: string, change: number, reason: string): Promise<InventoryItem> {
  return apiFetch<InventoryItem>(`/api/inventory/${encodeURIComponent(id)}/adjust`, {
    method: "POST",
    body: JSON.stringify({ change, reason }),
  });
}

/** Mirrors InventoryRequestResponse: a user's request for stock. */
export interface InventoryRequest {
  id: string;
  item_id: string;
  item_name: string | null;
  item_category: string | null;
  /** Stock on hand now. */
  available: number | null;
  requested_by: string;
  requested_by_name: string | null;
  quantity: number;
  reason: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";
  rejection_reason: string | null;
  processed_by: string | null;
  processed_by_name: string | null;
  processed_at: string | null;
  created_at: string;
}

/** Admins get the organization's requests; users get their own. */
export function listInventoryRequests(status?: string): Promise<InventoryRequest[]> {
  return apiFetch<InventoryRequest[]>(`/api/inventory/requests${status ? `?status=${status}` : ""}`);
}

export function requestInventory(itemId: string, quantity: number, reason: string): Promise<InventoryRequest> {
  return apiFetch<InventoryRequest>("/api/inventory/requests", {
    method: "POST",
    body: JSON.stringify({ item_id: itemId, quantity, reason }),
  });
}

/** Admins approve (stock is issued) or reject; the requester may cancel a pending request. */
export function decideInventoryRequest(
  id: string,
  status: "APPROVED" | "REJECTED" | "CANCELLED",
  rejectionReason?: string,
): Promise<InventoryRequest> {
  return apiFetch<InventoryRequest>(`/api/inventory/requests/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify({ status, rejection_reason: rejectionReason }),
  });
}

/** A stable key for one form submit, so a double click records the movement once. */
export function newReference(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID().replace(/-/g, "")
    : `${Date.now()}${Math.random().toString(16).slice(2)}`;
}

/** Stock of one kind of device, derived from receipts and asset statuses (mirrors HardwareStockRow). */
export interface HardwareStockRow {
  category: string;
  brand: string | null;
  model: string | null;
  purchased: number;
  awaiting_registration: number;
  available: number;
  reserved: number;
  assigned: number;
  under_repair: number;
  retired: number;
}

export interface StockReceipt {
  id: string;
  purchase_order_id: string;
  po_number: string | null;
  category: string;
  brand: string | null;
  model: string | null;
  specifications: string | null;
  quantity: number;
  /** Devices registered as assets from this receipt so far. */
  registered: number;
  unit_cost: number;
  location: string | null;
  notes: string | null;
  received_by_name: string | null;
  received_at: string | null;
}

export type ReceiptInput = {
  purchase_order_id: string;
  category: string;
  brand?: string;
  model?: string;
  specifications?: string;
  quantity: number;
  unit_cost?: number;
  location?: string;
  notes?: string;
  complete_po?: boolean;
  reference: string;
};

export const MOVEMENT_TYPES = ["RECEIPT", "REGISTER", "ASSIGN", "RETURN", "TRANSFER", "ISSUE", "ADJUSTMENT", "REPAIR", "RETIRE"] as const;

export interface StockMovement {
  id: string;
  movement_type: string;
  item_kind: "HARDWARE" | "CONSUMABLE";
  asset_id: string | null;
  asset_label: string | null;
  inventory_item_id: string | null;
  item_name: string | null;
  receipt_id: string | null;
  purchase_order_id: string | null;
  po_number: string | null;
  quantity: number;
  from_location: string | null;
  to_location: string | null;
  reason: string | null;
  performed_by_name: string | null;
  created_at: string | null;
}

export type MovementInput = {
  movement_type: "TRANSFER" | "RECEIPT" | "ISSUE" | "RETURN" | "ADJUSTMENT";
  item_kind: "HARDWARE" | "CONSUMABLE";
  asset_id?: string;
  inventory_item_id?: string;
  quantity?: number;
  to_location?: string;
  purchase_order_id?: string;
  reason: string;
  reference: string;
};

export function getHardwareStock(): Promise<HardwareStockRow[]> {
  return apiFetch<HardwareStockRow[]>("/api/inventory/hardware-stock");
}

export function listReceipts(params: { open_only?: boolean; purchase_order_id?: string } = {}): Promise<StockReceipt[]> {
  const query = new URLSearchParams();
  if (params.open_only) query.set("open_only", "true");
  if (params.purchase_order_id) query.set("purchase_order_id", params.purchase_order_id);
  return apiFetch<StockReceipt[]>(`/api/inventory/receipts?${query.toString()}`);
}

export function receiveStock(input: ReceiptInput): Promise<StockReceipt> {
  return apiFetch<StockReceipt>("/api/inventory/receipts", { method: "POST", body: JSON.stringify(input) });
}

export function listMovements(
  params: { movement_type?: string; item_kind?: string; asset_id?: string; skip?: number; limit?: number } = {},
): Promise<StockMovement[]> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== "") query.set(key, String(value));
  return apiFetch<StockMovement[]>(`/api/inventory/movements?${query.toString()}`);
}

export function recordMovement(input: MovementInput): Promise<StockMovement> {
  return apiFetch<StockMovement>("/api/inventory/movements", { method: "POST", body: JSON.stringify(input) });
}
