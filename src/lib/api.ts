// All browser API calls intentionally use the Next.js same-origin proxy.
// This avoids CORS and localhost:3000 vs localhost:8000 mistakes during local development.

type ValidationIssue = { loc?: (string | number)[]; msg?: string };

export type ApiError = { detail?: string | ValidationIssue[]; message?: string };

/**
 * FastAPI sends `detail` as a string for most errors but as a list of issues
 * for 422 validation errors; turn either into one readable sentence.
 */
function errorMessage(detail: ApiError["detail"]): string {
  if (typeof detail === "string") return detail;
  if (!Array.isArray(detail)) return "";
  return detail
    .map((issue) => {
      const field = issue.loc?.filter((part) => part !== "body").join(".");
      const msg = (issue.msg ?? "is invalid").replace(/^Value error, /, "");
      return field ? `${field}: ${msg}` : msg;
    })
    .join("; ");
}

export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

export function apiUrl(path: string) {
  return path.startsWith("/") ? path : `/${path}`;
}

// The API stores times in UTC but sends them without a zone ("2026-10-12T05:23:35"),
// which browsers would read as local time. Mark such timestamps as UTC. Midnight
// values are calendar dates (purchase, warranty) and are left as they are.
const NAIVE_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?$/;
const MIDNIGHT = /T00:00:00(\.0+)?$/;

export function withUtcTimes<T>(value: T): T {
  if (typeof value === "string") {
    return (NAIVE_TIMESTAMP.test(value) && !MIDNIGHT.test(value) ? `${value}Z` : value) as T;
  }
  if (Array.isArray(value)) return value.map(withUtcTimes) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, withUtcTimes(item)])) as T;
  }
  return value;
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = typeof window !== "undefined" ? window.localStorage.getItem("auth-token") : null;
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);

  let response: Response;
  try {
    response = await fetch(apiUrl(path), { ...init, headers, cache: "no-store" });
  } catch {
    throw new Error(
      "Unable to connect to the application API. Make sure the backend is running on port 8000.",
    );
  }

  const data = withUtcTimes((await response.json().catch(() => ({}))) as T & ApiError);
  if (!response.ok) {
    throw new ApiRequestError(
      errorMessage(data.detail) || data.message || `Request failed (${response.status})`,
      response.status,
    );
  }
  return data as T;
}

export function clearAuth() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem("auth-token");
  document.cookie = "auth-token=; Path=/; Max-Age=0; SameSite=Lax";
  window.sessionStorage.removeItem("itam-demo-session");
}
