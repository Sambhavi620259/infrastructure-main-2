import { apiFetch } from "@/lib/api";

export type AuditSession = {
  id: string;
  company_id: string;
  title: string;
  location_id: string | null;
  status: "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
  started_by: string;
  started_at: string;
  completed_at: string | null;
  verified_count: number;
  exception_count: number;
};

export type ScanRecord = {
  id: string;
  audit_session_id: string;
  asset_id: string | null;
  scanned_tag: string;
  is_verified: boolean;
  scanned_by: string;
  scanned_at: string;
};

export type AuditSessionCreate = {
  title: string;
  location_id?: string;
};

export async function listAuditSessions(): Promise<AuditSession[]> {
  return apiFetch<AuditSession[]>("/api/physical-audit/sessions");
}

export async function getAuditSession(sessionId: string): Promise<AuditSession> {
  return apiFetch<AuditSession>(`/api/physical-audit/sessions/${sessionId}`);
}

export async function listSessionScans(sessionId: string): Promise<ScanRecord[]> {
  return apiFetch<ScanRecord[]>(`/api/physical-audit/sessions/${sessionId}/scans`);
}

export async function startAuditSession(input: AuditSessionCreate): Promise<{ session_id: string }> {
  return apiFetch("/api/physical-audit/sessions", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function scanAsset(sessionId: string, assetTag: string, scannedLocation?: string): Promise<{
  status: "VERIFIED" | "UNRECOGNIZED_TAG";
  asset_id: string | null;
}> {
  return apiFetch(`/api/physical-audit/sessions/${sessionId}/scan`, {
    method: "POST",
    body: JSON.stringify({ asset_tag: assetTag, scanned_location: scannedLocation }),
  });
}

export async function completeAuditSession(sessionId: string): Promise<AuditSession> {
  return apiFetch<AuditSession>(`/api/physical-audit/sessions/${sessionId}/complete`, {
    method: "POST",
  });
}