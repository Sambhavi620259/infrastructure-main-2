/** The only roles PlatformRole in backend/app/models/models.py can store. */
export const BACKEND_ROLES = ["SUPER_ADMIN", "IT_ADMIN", "SUB_ADMIN", "REPORTING_USER", "EMPLOYEE"] as const;

export type BackendRole = (typeof BACKEND_ROLES)[number];

/**
 * The ITAM modules a SUB_ADMIN can be given charge of. The requirements describe
 * these as specialisations inside the Sub-Admin tier ("Sub-Admins (Multiple roles
 * like HAM / SAM / Cloud Resource Management)"), not as roles of their own.
 */
export const SUB_ADMIN_MODULES = ["HAM", "SAM", "CLOUD", "SCAN", "REPORTS"] as const;

export type SubAdminModule = (typeof SUB_ADMIN_MODULES)[number];

const MODULE_LABEL: Record<string, string> = {
  HAM: "Hardware Assets",
  SAM: "Software Assets",
  CLOUD: "Cloud Resources",
  SCAN: "Discovery & Scan",
  REPORTS: "Reports",
};

export function moduleLabel(value: string): string {
  return MODULE_LABEL[value] ?? value;
}

/** Mirrors UserResponse in backend/app/schemas/schemas.py. */
export interface AppUser {
  id: string;
  company_id: string | null;
  email: string;
  full_name: string;
  role: string;
  location: string | null;
  department_id: string | null;
  /** Only populated for SUB_ADMIN. */
  modules: string[] | null;
  status: string;
  created_at: string;
}

/** Mirrors DepartmentResponse. */
export interface Department {
  id: string;
  company_id: string;
  name: string;
  description: string | null;
  department_head: string | null;
  status: string | null;
}

/**
 * Covers both the roles the backend can store and the extra ones the frontend
 * navigation still refers to, so historical or unexpected values render as
 * something readable instead of crashing a lookup.
 */
const ROLE_LABEL: Record<string, string> = {
  SUPER_ADMIN: "Super Admin",
  IT_ADMIN: "IT Admin",
  SUB_ADMIN: "Sub Admin",
  REPORTING_USER: "Reporting User",
  EMPLOYEE: "Employee",
  HAM_ADMIN: "HAM Admin",
  SAM_ADMIN: "SAM Admin",
  CLOUD_ADMIN: "Cloud Admin",
  SCAN_ADMIN: "Scan Admin",
  IT_AGENT: "IT Agent",
};

const ROLE_BADGE: Record<string, string> = {
  SUPER_ADMIN: "bg-violet-50 text-violet-700",
  IT_ADMIN: "bg-blue-50 text-blue-700",
  SUB_ADMIN: "bg-cyan-50 text-cyan-700",
  REPORTING_USER: "bg-slate-100 text-slate-700",
  EMPLOYEE: "bg-teal-50 text-teal-700",
};

const UNKNOWN_BADGE = "bg-slate-100 text-slate-600";

/** Never throws on an unrecognised role. */
export function roleLabel(role: string): string {
  if (ROLE_LABEL[role]) return ROLE_LABEL[role];
  return role
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function roleBadgeClass(role: string): string {
  return ROLE_BADGE[role] ?? UNKNOWN_BADGE;
}

export function statusBadgeClass(status: string): string {
  const normalised = status.toUpperCase();
  if (normalised === "ACTIVE") return "bg-emerald-50 text-emerald-700";
  if (normalised === "INVITED" || normalised === "PENDING") return "bg-blue-50 text-blue-700";
  return "bg-slate-100 text-slate-600";
}

export function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}
