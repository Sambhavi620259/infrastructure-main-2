import { apiFetch } from "@/lib/api";

/** Mirrors VendorResponse. */
export interface Vendor {
  id: string;
  company_id: string;
  name: string;
  contact: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  gst: string | null;
  status: "ACTIVE" | "INACTIVE" | string;
}

export type VendorInput = {
  name: string;
  contact?: string;
  email?: string;
  phone?: string;
  address?: string;
  gst?: string;
};

export function listVendors(): Promise<Vendor[]> {
  return apiFetch<Vendor[]>("/api/vendors?limit=500");
}

export function createVendor(input: VendorInput): Promise<Vendor> {
  return apiFetch<Vendor>("/api/vendors", { method: "POST", body: JSON.stringify(input) });
}

export function updateVendor(id: string, input: Partial<VendorInput> & { status?: "ACTIVE" | "INACTIVE" }): Promise<Vendor> {
  return apiFetch<Vendor>(`/api/vendors/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(input) });
}

export const PO_STATUSES = ["PENDING", "ORDERED", "RECEIVED", "CANCELLED"] as const;
export type PoStatus = (typeof PO_STATUSES)[number];

/** Mirrors PurchaseOrderResponse in backend/app/routers/purchase_orders.py. */
export interface PurchaseOrder {
  id: string;
  company_id: string;
  po_number: string;
  vendor_id: string;
  vendor_name: string | null;
  status: PoStatus;
  total_amount: string | number;
  order_date: string | null;
}

/** Where each status can move next (mirrors the backend's rules). */
export const PO_NEXT: Record<PoStatus, PoStatus[]> = {
  PENDING: ["ORDERED", "CANCELLED"],
  ORDERED: ["RECEIVED", "CANCELLED"],
  RECEIVED: [],
  CANCELLED: [],
};

export function listPurchaseOrders(status?: PoStatus): Promise<PurchaseOrder[]> {
  return apiFetch<PurchaseOrder[]>(`/api/purchase-orders?limit=500${status ? `&status=${status}` : ""}`);
}

export function createPurchaseOrder(input: {
  po_number: string;
  vendor_id: string;
  total_amount: number;
  order_date?: string;
}): Promise<PurchaseOrder> {
  return apiFetch<PurchaseOrder>("/api/purchase-orders", { method: "POST", body: JSON.stringify(input) });
}

export function updatePurchaseOrderStatus(id: string, status: PoStatus): Promise<PurchaseOrder> {
  return apiFetch<PurchaseOrder>(`/api/purchase-orders/${encodeURIComponent(id)}/status`, {
    method: "PUT",
    body: JSON.stringify({ status }),
  });
}
