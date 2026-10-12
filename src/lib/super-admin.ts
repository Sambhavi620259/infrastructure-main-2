import { apiFetch } from "@/lib/api";
import type { AppUser } from "@/types/user";

export const PLANS = ["TRIAL", "STARTER", "BUSINESS", "ENTERPRISE"] as const;
export type Plan = (typeof PLANS)[number];
export const SUBSCRIPTION_STATUSES = ["ACTIVE", "TRIAL", "PAST_DUE", "CANCELLED"] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export interface Subscription {
  id: string;
  company_id: string;
  plan: string;
  user_limit: number;
  asset_limit: number;
  start_date: string;
  end_date: string | null;
  status: string;
}

/** Mirrors CompanyDetail in backend/app/routers/super_admin.py. */
export interface Company {
  id: string;
  name: string;
  code: string;
  status: "ACTIVE" | "SUSPENDED" | string;
  created_at: string | null;
  subscription: Subscription | null;
  active_users: number;
  it_agents: number;
  assets: number;
  pending_tickets: number;
  primary_admin: { id: string; full_name: string; email: string } | null;
}

export interface PlatformOverview {
  companies_total: number;
  companies_active: number;
  companies_suspended: number;
  companies_new_this_month: number;
  users_total: number;
  users_by_role: Record<string, number>;
  unassigned_agents: number;
  assets_total: number;
  pending_tickets: number;
  plans: Record<string, number>;
  recent_companies: Company[];
}

export interface PlatformAuditEntry {
  id: string;
  action: string;
  entity: string;
  entity_id: string | null;
  old_value: string | null;
  new_value: string | null;
  timestamp: string;
  user_name: string | null;
  user_email: string | null;
  company_name: string | null;
}

export interface ProvisioningDefaults {
  plan: Plan;
  user_limit: number;
  asset_limit: number;
}

function query(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}

export function getPlatformOverview(): Promise<PlatformOverview> {
  return apiFetch<PlatformOverview>("/api/super-admin/overview");
}

export function listCompanies(params: { search?: string; status?: string } = {}): Promise<Company[]> {
  return apiFetch<Company[]>(`/api/super-admin/companies${query({ ...params, limit: 500 })}`);
}

export function createCompany(input: {
  name: string;
  code?: string;
  plan: Plan;
  user_limit: number;
  asset_limit: number;
  admin_name?: string;
  admin_email?: string;
  admin_password?: string;
}): Promise<Company> {
  return apiFetch<Company>("/api/super-admin/companies", { method: "POST", body: JSON.stringify(input) });
}

export function updateCompany(id: string, input: { name?: string; status?: "ACTIVE" | "SUSPENDED" }): Promise<Company> {
  return apiFetch<Company>(`/api/super-admin/companies/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export function updateSubscription(
  companyId: string,
  input: { plan?: Plan; user_limit?: number; asset_limit?: number; status?: SubscriptionStatus; end_date?: string | null },
): Promise<Company> {
  return apiFetch<Company>(`/api/super-admin/subscriptions/${encodeURIComponent(companyId)}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export function listSuperAdmins(): Promise<AppUser[]> {
  return apiFetch<AppUser[]>("/api/super-admin/admins");
}

export function createSuperAdmin(input: { name: string; email: string; password: string }): Promise<AppUser> {
  return apiFetch<AppUser>("/api/super-admin/admins", { method: "POST", body: JSON.stringify(input) });
}

export function setSuperAdminActive(id: string, active: boolean): Promise<AppUser> {
  return apiFetch<AppUser>(`/api/super-admin/admins/${encodeURIComponent(id)}/${active ? "reactivate" : "deactivate"}`, {
    method: "POST",
  });
}

export function listPlatformAudit(
  params: { search?: string; action?: string; company_id?: string; skip?: number; limit?: number } = {},
): Promise<PlatformAuditEntry[]> {
  return apiFetch<PlatformAuditEntry[]>(`/api/super-admin/audit-logs${query(params)}`);
}

export function listAuditActions(): Promise<string[]> {
  return apiFetch<string[]>("/api/super-admin/audit-actions");
}

export function getProvisioningDefaults(): Promise<ProvisioningDefaults> {
  return apiFetch<ProvisioningDefaults>("/api/super-admin/settings");
}

export function updateProvisioningDefaults(input: ProvisioningDefaults): Promise<ProvisioningDefaults> {
  return apiFetch<ProvisioningDefaults>("/api/super-admin/settings", { method: "PUT", body: JSON.stringify(input) });
}

export function changeSuperAdminKey(currentKey: string, newKey: string): Promise<{ message: string }> {
  return apiFetch("/api/auth/super-admin-key", {
    method: "PUT",
    body: JSON.stringify({ current_key: currentKey, new_key: newKey }),
  });
}

/** "ADD_COMPANY_TENANT" -> "Add company tenant". */
export function actionLabel(action: string): string {
  const text = action.toLowerCase().replace(/_/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function planLabel(plan: string): string {
  return plan.charAt(0) + plan.slice(1).toLowerCase();
}

export function formatDay(value: string | null): string {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? "—"
    : parsed.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}

export function formatDateTime(value: string | null): string {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? "—"
    : parsed.toLocaleString(undefined, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}
