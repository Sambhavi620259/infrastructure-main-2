import { ApiRequestError, apiFetch, apiUrl } from "@/lib/api";

export type ReportFilterKey =
  | "status"
  | "category"
  | "department_id"
  | "coverage"
  | "expiring_days"
  | "action"
  | "date_from"
  | "date_to"
  | "session_id";

export type ReportFilters = Partial<Record<ReportFilterKey, string | number>>;

/** Mirrors ReportTypeResponse in backend/app/schemas/schemas.py. */
export interface ReportType {
  key: string;
  label: string;
  description: string;
  filters: ReportFilterKey[];
}

/** Mirrors ReportRunResponse: one generated report (the CSV is downloaded separately). */
export interface ReportRun {
  id: string;
  name: string;
  report_type: string;
  report_config_id: string | null;
  filters: ReportFilters;
  format: string;
  row_count: number;
  generated_by: string;
  generated_by_name: string | null;
  created_at: string;
}

/** Mirrors ReportConfigResponse: saved settings that can be re-run. */
export interface SavedReport {
  id: string;
  name: string;
  report_type: string;
  filters: ReportFilters;
  created_by: string;
  created_at: string;
  last_run_at: string | null;
}

export interface ReportSummary {
  generated_this_month: number;
  saved_reports: number;
  last_generated_at: string | null;
}

export function listReportTypes(): Promise<ReportType[]> {
  return apiFetch<ReportType[]>("/api/reports/types");
}

export function getReportSummary(): Promise<ReportSummary> {
  return apiFetch<ReportSummary>("/api/reports/summary");
}

/** POST /api/reports/runs — generates and stores the report; `save` also keeps the settings. */
export function createReport(input: {
  report_type: string;
  name?: string;
  filters?: ReportFilters;
  save?: boolean;
}): Promise<ReportRun> {
  return apiFetch<ReportRun>("/api/reports/runs", { method: "POST", body: JSON.stringify(input) });
}

export function listReportRuns(limit = 20): Promise<ReportRun[]> {
  return apiFetch<ReportRun[]>(`/api/reports/runs?limit=${limit}`);
}

export function listSavedReports(): Promise<SavedReport[]> {
  return apiFetch<SavedReport[]>("/api/reports/saved");
}

export function runSavedReport(configId: string): Promise<ReportRun> {
  return apiFetch<ReportRun>(`/api/reports/saved/${encodeURIComponent(configId)}/run`, { method: "POST" });
}

export async function deleteSavedReport(configId: string): Promise<void> {
  const token = window.localStorage.getItem("auth-token");
  const response = await fetch(apiUrl(`/api/reports/saved/${encodeURIComponent(configId)}`), {
    method: "DELETE",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as { detail?: string };
    throw new ApiRequestError(data.detail || `Delete failed (${response.status})`, response.status);
  }
}

function fileNameFor(run: ReportRun): string {
  const slug = run.name.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase() || "report";
  return `${slug}-${run.created_at.slice(0, 10)}.csv`;
}

/**
 * Download a generated report's CSV. apiFetch only handles JSON, so this
 * fetches the file with the same bearer token and saves it via a blob URL.
 */
export async function downloadReport(run: ReportRun): Promise<void> {
  const token = window.localStorage.getItem("auth-token");
  const response = await fetch(apiUrl(`/api/reports/runs/${encodeURIComponent(run.id)}/download`), {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    cache: "no-store",
  });
  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as { detail?: string };
    throw new ApiRequestError(data.detail || `Download failed (${response.status})`, response.status);
  }
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = fileNameFor(run);
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
