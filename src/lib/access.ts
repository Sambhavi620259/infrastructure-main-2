/**
 * Which parts of the IT workspace a signed-in user may open. The backend
 * enforces the same rules (app/core/access_guard.py); this keeps the sidebar
 * and page routing in line with them.
 */
export type Section =
  | "dashboard"
  | "assets"
  | "tickets"
  | "users"
  | "inventory"
  | "software"
  | "finance"
  | "discovery"
  | "cloud"
  | "reports"
  | "settings";

const ALL: Section[] = [
  "dashboard", "assets", "tickets", "users", "inventory", "software", "finance", "discovery", "cloud", "reports", "settings",
];

/** Sub-admin module -> sections it unlocks. */
const MODULE_SECTIONS: Record<string, Section[]> = {
  HAM: ["assets", "tickets", "inventory", "finance"],
  SAM: ["software"],
  CLOUD: ["cloud"],
  SCAN: ["discovery"],
  REPORTS: ["reports"],
};

/** Plan feature -> sections it unlocks (backend: app/services/plan_features_service.py). */
const FEATURE_SECTIONS: Record<string, Section[]> = {
  INVENTORY: ["inventory"],
  SOFTWARE: ["software"],
  REPORTS: ["reports"],
  CLOUD: ["cloud"],
};

/** User-workspace pages that belong to a plan feature. */
const USER_PAGE_FEATURES: [string, string][] = [
  ["/agent/software", "SOFTWARE"],
  ["/agent/inventory", "INVENTORY"],
  ["/agent/reports", "REPORTS"],
];

/**
 * Sections the role may open. With planFeatures (from the profile), sections
 * whose feature the organization's plan leaves out are removed too.
 */
export function sectionsFor(role: string, modules: readonly string[] = [], planFeatures?: readonly string[]): Set<Section> {
  const sections =
    role === "SUB_ADMIN"
      ? new Set<Section>(["dashboard", ...modules.flatMap((module) => MODULE_SECTIONS[module] ?? [])])
      : role === "REPORTING_USER"
        ? new Set<Section>(["dashboard", "reports"])
        : new Set(ALL);
  if (planFeatures) {
    for (const [feature, featureSections] of Object.entries(FEATURE_SECTIONS)) {
      if (!planFeatures.includes(feature)) featureSections.forEach((section) => sections.delete(section));
    }
  }
  return sections;
}

/** Whether a user-workspace page is on the organization's plan. */
export function userPageOnPlan(pathname: string, planFeatures?: readonly string[]): boolean {
  if (!planFeatures) return true;
  const match = USER_PAGE_FEATURES.find(([prefix]) => pathname === prefix || pathname.startsWith(`${prefix}/`));
  return !match || planFeatures.includes(match[1]);
}

/** The section a path belongs to, or null for pages open to everyone (e.g. /profile). */
export function sectionForPath(pathname: string): Section | null {
  const rules: [string, Section][] = [
    ["/inventory/software", "software"],
    ["/assets/software", "software"],
    ["/software", "software"],
    ["/requests", "tickets"],
    ["/maintenance", "assets"],
    ["/dashboard", "dashboard"],
    ["/assets", "assets"],
    ["/tickets", "tickets"],
    ["/users", "users"],
    ["/inventory", "inventory"],
    ["/financial", "finance"],
    ["/discovery", "discovery"],
    ["/cloud", "cloud"],
    ["/reports", "reports"],
    ["/settings", "settings"],
  ];
  const match = rules.find(([prefix]) => pathname === prefix || pathname.startsWith(`${prefix}/`));
  return match ? match[1] : null;
}

/** Map a sidebar label (IT workspace) to its section. */
export const LABEL_SECTION: Record<string, Section> = {
  Dashboard: "dashboard",
  Tickets: "tickets",
  Users: "users",
  Inventory: "inventory",
  Finance: "finance",
  Discovery: "discovery",
  Cloud: "cloud",
  Reports: "reports",
  Settings: "settings",
};
