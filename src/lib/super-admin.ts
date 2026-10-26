import { apiFetch } from "@/lib/api";

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
  contact_email: string | null;
  contact_phone: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
}

/** Contact details and office pin; null clears a value. */
export type CompanyContactInput = {
  contact_email?: string | null;
  contact_phone?: string | null;
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
};

/** One row of the contact directory report. */
export interface DirectoryEntry {
  id: string;
  name: string;
  code: string;
  status: string;
  plan: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  it_admins: { id: string; full_name: string; email: string; phone: string | null; status: string }[];
}

export interface PlanFeatures {
  /** Feature key -> label, e.g. SOFTWARE -> "Software assets & licenses". */
  features: Record<string, string>;
  /** Plan -> the features it includes. */
  plans: Record<string, string[]>;
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
  user_role: string | null;
  company_name: string | null;
}

export interface PlatformAsset {
  id: string;
  asset_code: string;
  asset_tag: string | null;
  same_number_count: number;
  serial_number: string | null;
  name: string;
  category: string;
  status: string;
  assigned_to_name: string | null;
  assigned_to_email: string | null;
  assigned_by_name: string | null;
  assigned_at: string | null;
}

export interface ProvisioningDefaults {
  plan: Plan;
  user_limit: number;
  asset_limit: number;
}

function query(params: Record<string, string | number | boolean | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "" && value !== false) search.set(key, String(value));
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

export function updateCompany(
  id: string,
  input: { name?: string; status?: "ACTIVE" | "SUSPENDED" } & CompanyContactInput,
): Promise<Company> {
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

export function getContactDirectory(): Promise<DirectoryEntry[]> {
  return apiFetch<DirectoryEntry[]>("/api/super-admin/contact-directory");
}

export function getPlanFeatures(): Promise<PlanFeatures> {
  return apiFetch<PlanFeatures>("/api/super-admin/plan-features");
}

export function updatePlanFeatures(plans: Record<string, string[]>): Promise<PlanFeatures> {
  return apiFetch<PlanFeatures>("/api/super-admin/plan-features", { method: "PUT", body: JSON.stringify({ plans }) });
}

export function listPlatformAudit(
  params: { search?: string; action?: string; sign_ins?: boolean; role?: string; skip?: number; limit?: number } = {},
): Promise<PlatformAuditEntry[]> {
  return apiFetch<PlatformAuditEntry[]>(`/api/super-admin/audit-logs${query(params)}`);
}

export function listPlatformAssets(
  params: { search?: string; status?: string; assignment?: string; skip?: number; limit?: number } = {},
): Promise<PlatformAsset[]> {
  return apiFetch<PlatformAsset[]>(`/api/super-admin/assets${query(params)}`);
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
  if (action === "USER_LOGIN") return "Signed in";
  if (action === "USER_REGISTER") return "Registered";
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
