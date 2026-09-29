// All browser API calls intentionally use the Next.js same-origin proxy.
// This avoids CORS and localhost:3000 vs localhost:8000 mistakes during local development.

export type ApiError = { detail?: string; message?: string };

export function apiUrl(path: string) {
  return path.startsWith("/") ? path : `/${path}`;
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
    throw new Error("Unable to connect to the application API. Make sure the backend is running on port 8000.");
  }

  const data = (await response.json().catch(() => ({}))) as T & ApiError;
  if (!response.ok) {
    throw new Error(data.detail || data.message || `Request failed (${response.status})`);
  }
  return data as T;
}

export function clearAuth() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem("auth-token");
  document.cookie = "auth-token=; Path=/; Max-Age=0; SameSite=Lax";
  window.sessionStorage.removeItem("itam-demo-session");
}
