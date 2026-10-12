import { apiFetch } from "@/lib/api";

/** Mirrors SoftwareResponse. */
export interface Software {
  id: string;
  company_id: string;
  name: string;
  vendor: string | null;
  version: string | null;
  license_type: string;
  total_licenses: number;
  used_licenses: number;
  cost: string | number;
  expiry_date: string | null;
  status: string;
}

export type SoftwareInput = {
  name: string;
  vendor?: string;
  version?: string;
  license_type?: string;
  total_licenses: number;
  cost?: number;
  expiry_date?: string;
};

export function listSoftware(): Promise<Software[]> {
  return apiFetch<Software[]>("/api/software?limit=500");
}

export function createSoftware(input: SoftwareInput): Promise<Software> {
  return apiFetch<Software>("/api/software", { method: "POST", body: JSON.stringify(input) });
}

/** POST /api/software/{id}/assign — uses one seat. */
export function assignLicense(softwareId: string, userId: string): Promise<unknown> {
  return apiFetch(`/api/software/${encodeURIComponent(softwareId)}/assign`, {
    method: "POST",
    body: JSON.stringify({ user_id: userId }),
  });
}
