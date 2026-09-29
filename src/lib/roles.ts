export const roles = {
  SUPER_ADMIN: "SUPER_ADMIN",
  IT_ADMIN: "IT_ADMIN",
  HAM_ADMIN: "HAM_ADMIN",
  SAM_ADMIN: "SAM_ADMIN",
  CLOUD_ADMIN: "CLOUD_ADMIN",
  SCAN_ADMIN: "SCAN_ADMIN",
  REPORTING_USER: "REPORTING_USER",
  IT_AGENT: "IT_AGENT",
} as const;

export type Role = (typeof roles)[keyof typeof roles];

/** Roles that participate in the authentication and workspace routing flow. */
export type UserRole = "IT_AGENT" | "IT_ADMIN" | "SUPER_ADMIN";

export interface UserProfile {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  department: string;
  companyId: string;
  avatarUrl: string;
}

export const ROLE_REDIRECT_MAP: Record<UserRole, string> = {
  IT_AGENT: "/agent/dashboard",
  IT_ADMIN: "/dashboard",
  SUPER_ADMIN: "/super-admin",
};

export type Workspace = "it" | "super" | "agent";

export type Permission =
  | "platform:manage"
  | "subscription:manage"
  | "tenant:manage"
  | "users:manage"
  | "roles:assign"
  | "organization:configure"
  | "ham:read"
  | "ham:write"
  | "sam:read"
  | "sam:write"
  | "cloud:read"
  | "cloud:write"
  | "scan:read"
  | "scan:write"
  | "financial:read"
  | "financial:write"
  | "reports:read"
  | "reports:export"
  | "tickets:read"
  | "tickets:write"
  | "assets:read"
  | "inventory:read"
  | "users:read";

export const roleDefinitions: Record<Role, {
  label: string;
  description: string;
  scope: string;
  permissions: readonly Permission[];
}> = {
  SUPER_ADMIN: {
    label: "Super Admin",
    description: "Platform owner role for companies, subscriptions, tenants and platform governance.",
    scope: "All tenants",
    permissions: ["platform:manage", "subscription:manage", "tenant:manage"],
  },
  IT_ADMIN: {
    label: "IT Admin",
    description: "Primary company administrator responsible for configuration, users and all ITAM modules.",
    scope: "One company",
    permissions: [
      "users:manage", "roles:assign", "organization:configure", "ham:read", "ham:write",
      "sam:read", "sam:write", "cloud:read", "cloud:write", "scan:read", "scan:write",
      "financial:read", "financial:write", "reports:read", "reports:export",
    ],
  },
  HAM_ADMIN: {
    label: "HAM Sub-Admin",
    description: "Hardware asset lifecycle, assignments, maintenance, warranty and physical audits.",
    scope: "Hardware module",
    permissions: ["ham:read", "ham:write", "reports:read", "reports:export"],
  },
  SAM_ADMIN: {
    label: "SAM Sub-Admin",
    description: "Software catalog, entitlements, deployments, usage metering and license compliance.",
    scope: "Software module",
    permissions: ["sam:read", "sam:write", "reports:read", "reports:export"],
  },
  CLOUD_ADMIN: {
    label: "Cloud Sub-Admin",
    description: "Cloud accounts, resources, utilization, cost visibility and cloud governance.",
    scope: "Cloud module",
    permissions: ["cloud:read", "cloud:write", "reports:read", "reports:export"],
  },
  SCAN_ADMIN: {
    label: "Discovery Sub-Admin",
    description: "Network discovery schedules, agent health, scan targets and reconciliation workflows.",
    scope: "Discovery module",
    permissions: ["scan:read", "scan:write", "reports:read", "reports:export"],
  },
  REPORTING_USER: {
    label: "Reporting User",
    description: "Read-only access to approved reports, dashboards and exports.",
    scope: "Reports only",
    permissions: ["reports:read", "reports:export"],
  },
  IT_AGENT: {
    label: "IT Agent",
    description: "Operational support role for tickets, assigned assets, inventory and approved reports.",
    scope: "Company operations",
    permissions: ["tickets:read", "tickets:write", "assets:read", "inventory:read", "users:read", "reports:read", "reports:export"],
  },
};

export const roleOptions: readonly Role[] = [
  "IT_ADMIN",
  "HAM_ADMIN",
  "SAM_ADMIN",
  "CLOUD_ADMIN",
  "SCAN_ADMIN",
  "REPORTING_USER",
  "IT_AGENT",
];

export function hasPermission(role: Role, permission: Permission) {
  return roleDefinitions[role].permissions.includes(permission);
}

/**
 * Maps a signed-in user's role to its single workspace.  A user must be
 * assigned a separate role and sign in again to enter a different workspace.
 */
export function workspaceForRole(role: Role): Workspace {
  if (role === roles.SUPER_ADMIN) return "super";
  if (role === roles.IT_AGENT) return "agent";
  return "it";
}

export function defaultRouteForRole(role: Role) {
  if (role in ROLE_REDIRECT_MAP) return ROLE_REDIRECT_MAP[role as UserRole];
  const workspace = workspaceForRole(role);
  if (workspace === "super") return "/super-admin";
  if (workspace === "agent") return "/agent/dashboard";
  return "/dashboard";
}

/** Returns whether a pathname belongs to the signed-in user's workspace. */
export function canAccessPath(role: Role, pathname: string) {
  if (pathname === "/profile") return true;
  const workspace = workspaceForRole(role);
  if (workspace === "super") return pathname === "/super-admin" || pathname.startsWith("/super-admin/");
  if (workspace === "agent") return pathname === "/agent/dashboard" || pathname.startsWith("/agent/");
  return !pathname.startsWith("/super-admin") && !pathname.startsWith("/agent/");
}
