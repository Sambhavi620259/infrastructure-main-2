import { apiFetch } from "@/lib/api";

export const LICENSE_TYPES = ["PERPETUAL", "SUBSCRIPTION", "PER_USER", "PER_DEVICE", "SITE", "VOLUME", "OEM", "TRIAL"] as const;
export type LicenseType = (typeof LICENSE_TYPES)[number];

export function licenseTypeLabel(type: string): string {
  return type.charAt(0) + type.slice(1).toLowerCase().replace(/_/g, " ");
}

/** A software product with seat totals across its active licenses (mirrors SoftwareResponse). */
export interface Software {
  id: string;
  company_id: string;
  name: string;
  /** Publisher. */
  vendor: string | null;
  version: string | null;
  license_type: string;
  total_licenses: number;
  used_licenses: number;
  available_licenses: number;
  license_count: number;
  cost: string | number;
  expiry_date: string | null;
  status: string;
}

/** A purchased license entitlement (mirrors LicenseResponse). */
export interface SoftwareLicense {
  id: string;
  software_id: string;
  software_name: string | null;
  license_type: string;
  /** Full number for admins; masked ("••••-1234") for everyone else. */
  license_number: string | null;
  /** License Count: seats bought. */
  seats: number;
  assigned: number;
  available: number;
  purchase_date: string | null;
  expiry_date: string | null;
  renewal_date: string | null;
  cost: string | number;
  vendor_id: string | null;
  purchase_order_id: string | null;
  status: string;
  notes: string | null;
}

/** One seat given to a user (mirrors SeatResponse). License numbers here are always masked. */
export interface SoftwareSeat {
  id: string;
  software_id: string;
  software_name: string | null;
  license_id: string | null;
  license_type: string | null;
  license_number: string | null;
  expiry_date: string | null;
  user_id: string;
  user_name: string | null;
  asset_id: string | null;
  asset_label: string | null;
  assigned_at: string | null;
  assigned_by_name: string | null;
  is_active: boolean;
  released_at: string | null;
  released_by_name: string | null;
}

export interface SoftwareDetail extends Software {
  licenses: SoftwareLicense[];
  seats: SoftwareSeat[];
}

export interface CatalogEntry {
  id: string;
  name: string;
  vendor: string | null;
  version: string | null;
}

export type LicenseInput = {
  license_type?: string;
  license_number?: string;
  seats: number;
  purchase_date?: string;
  expiry_date?: string;
  renewal_date?: string;
  cost?: number;
  vendor_id?: string;
  purchase_order_id?: string;
  notes?: string;
};

export type SoftwareInput = {
  name: string;
  vendor?: string;
  version?: string;
  /** The first license (License Number / License Count). */
  license?: LicenseInput;
};

const enc = encodeURIComponent;

export function listSoftware(search?: string): Promise<Software[]> {
  return apiFetch<Software[]>(`/api/software?limit=500${search ? `&search=${enc(search)}` : ""}`);
}

export function getSoftware(id: string): Promise<SoftwareDetail> {
  return apiFetch<SoftwareDetail>(`/api/software/${enc(id)}`);
}

export function createSoftware(input: SoftwareInput): Promise<SoftwareDetail> {
  return apiFetch<SoftwareDetail>("/api/software", { method: "POST", body: JSON.stringify(input) });
}

export function updateSoftware(id: string, input: { name?: string; vendor?: string; version?: string }): Promise<SoftwareDetail> {
  return apiFetch<SoftwareDetail>(`/api/software/${enc(id)}`, { method: "PUT", body: JSON.stringify(input) });
}

export async function deleteSoftware(id: string): Promise<void> {
  await apiFetch(`/api/software/${enc(id)}`, { method: "DELETE" });
}

export function addLicense(softwareId: string, input: LicenseInput): Promise<SoftwareLicense> {
  return apiFetch<SoftwareLicense>(`/api/software/${enc(softwareId)}/licenses`, { method: "POST", body: JSON.stringify(input) });
}

export function updateLicense(
  licenseId: string,
  input: Partial<LicenseInput> & { status?: "ACTIVE" | "CANCELLED" },
): Promise<SoftwareLicense> {
  return apiFetch<SoftwareLicense>(`/api/software/licenses/${enc(licenseId)}`, { method: "PUT", body: JSON.stringify(input) });
}

export function listLicenses(params: { search?: string; expiring_days?: number } = {}): Promise<SoftwareLicense[]> {
  const query = new URLSearchParams();
  if (params.search) query.set("search", params.search);
  if (params.expiring_days) query.set("expiring_days", String(params.expiring_days));
  const qs = query.toString();
  return apiFetch<SoftwareLicense[]>(`/api/software/licenses${qs ? `?${qs}` : ""}`);
}

/** POST /api/software/{id}/assign — admins give one seat; fails when no seat is free. */
export function assignLicense(
  softwareId: string,
  userId: string,
  options: { license_id?: string; asset_id?: string } = {},
): Promise<{ assignment_id: string }> {
  return apiFetch(`/api/software/${enc(softwareId)}/assign`, {
    method: "POST",
    body: JSON.stringify({ user_id: userId, ...options }),
  });
}

export function listSeats(params: { active?: boolean; user_id?: string; software_id?: string } = {}): Promise<SoftwareSeat[]> {
  const query = new URLSearchParams();
  if (params.active !== undefined) query.set("active", String(params.active));
  if (params.user_id) query.set("user_id", params.user_id);
  if (params.software_id) query.set("software_id", params.software_id);
  return apiFetch<SoftwareSeat[]>(`/api/software/assignments?${query.toString()}`);
}

export function releaseSeat(assignmentId: string): Promise<SoftwareSeat> {
  return apiFetch<SoftwareSeat>(`/api/software/assignments/${enc(assignmentId)}/release`, { method: "POST" });
}

/** Products anyone can request (names only). */
export function softwareCatalog(): Promise<CatalogEntry[]> {
  return apiFetch<CatalogEntry[]>("/api/software/catalog");
}

/** The signed-in user's own seats. */
export function mySoftware(): Promise<SoftwareSeat[]> {
  return apiFetch<SoftwareSeat[]>("/api/software/mine");
}
