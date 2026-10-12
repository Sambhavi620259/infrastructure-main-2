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

export function sectionsFor(role: string, modules: readonly string[] = []): Set<Section> {
  if (role === "SUB_ADMIN") {
    return new Set<Section>(["dashboard", ...modules.flatMap((module) => MODULE_SECTIONS[module] ?? [])]);
  }
  if (role === "REPORTING_USER") return new Set<Section>(["dashboard", "reports"]);
  return new Set(ALL);
}

/** The section a path belongs to, or null for pages open to everyone (e.g. /profile). */
export function sectionForPath(pathname: string): Section | null {
  const rules: [string, Section][] = [
    ["/inventory/software", "software"],
    ["/software", "software"],
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
