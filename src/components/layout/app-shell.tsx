"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import React, { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ChartBarIcon,
  CloudIcon,
  CubeTransparentIcon,
  KeyIcon,
  RectangleStackIcon,
  TruckIcon,
  WrenchScrewdriverIcon,
  ArrowPathRoundedSquareIcon,
  ArrowRightStartOnRectangleIcon,
  BuildingOffice2Icon,
  ChevronDownIcon,
  Cog6ToothIcon,
  ComputerDesktopIcon,
  CubeIcon,
  CheckCircleIcon,
  ClipboardDocumentCheckIcon,
  ClockIcon,
  DocumentChartBarIcon,
  FolderIcon,
  MagnifyingGlassIcon,
  ShieldCheckIcon,
  Squares2X2Icon,
  TicketIcon,
  UserGroupIcon,
  UsersIcon,
  XMarkIcon,
  Bars3Icon,
} from "@heroicons/react/24/outline";
import { endDemoSession, type DemoSession } from "@/lib/demo-session";
import { apiFetch, ApiRequestError, clearAuth } from "@/lib/api";
import { canAccessPath, defaultRouteForRole, roles, workspaceForRole, type Workspace } from "@/lib/roles";
import { routes } from "@/lib/routes";
import { getDashboardCounts, type DashboardCounts } from "@/lib/dashboard";
import { NotificationBell } from "@/components/layout/notification-bell";
import { PROFILE_UPDATED_EVENT } from "@/lib/profile";
import { sectionForPath, sectionsFor, type Section } from "@/lib/access";
import { useResponsiveTables } from "@/lib/responsive-tables";

type NavigationItem = readonly [label: string, href: string, countKey: string, icon: React.ComponentType<{ className?: string }>];

type MenuLink = { label: string; href: string; icon: NavigationItem[3]; section: Section; badge?: string };
type MenuEntry =
  | ({ kind: "link" } & MenuLink)
  | { kind: "group"; label: string; icon: NavigationItem[3]; children: MenuLink[] }
  | { kind: "heading"; label: string };

/** IT workspace sidebar. Assets and Inventory are separate groups; each link shows only if the role can open its section. */
const itMenu: readonly MenuEntry[] = [
  { kind: "link", label: "Dashboard", href: routes.dashboard, icon: Squares2X2Icon, section: "dashboard" },
  {
    kind: "group", label: "Assets", icon: ComputerDesktopIcon, children: [
      { label: "Hardware Assets", href: routes.assets, icon: ComputerDesktopIcon, section: "assets", badge: "assets" },
      { label: "Software Assets", href: "/assets/software", icon: RectangleStackIcon, section: "software" },
      { label: "Assignments", href: routes.assetAssignment, icon: UserGroupIcon, section: "assets" },
    ],
  },
  {
    kind: "group", label: "Inventory", icon: CubeIcon, children: [
      { label: "Hardware Stock", href: routes.inventoryHardware, icon: CubeTransparentIcon, section: "inventory" },
      { label: "Software Licenses", href: routes.inventorySoftware, icon: KeyIcon, section: "software" },
      { label: "Purchase & Stock Movements", href: "/inventory/movements", icon: TruckIcon, section: "inventory", badge: "inventory" },
    ],
  },
  { kind: "link", label: "Requests & Approvals", href: "/requests", icon: ClipboardDocumentCheckIcon, section: "tickets", badge: "tickets" },
  { kind: "link", label: "Maintenance & Warranty", href: "/maintenance", icon: WrenchScrewdriverIcon, section: "assets" },
  { kind: "link", label: "Reports & Analytics", href: routes.reports, icon: ChartBarIcon, section: "reports" },
  { kind: "heading", label: "Administration" },
  { kind: "link", label: "Users", href: routes.users, icon: UsersIcon, section: "users", badge: "users" },
  { kind: "link", label: "Cloud", href: routes.cloud, icon: CloudIcon, section: "cloud" },
  { kind: "link", label: "Settings", href: routes.settings, icon: Cog6ToothIcon, section: "settings" },
];

// Pages reached from inside other pages; listed so the search box still finds them.
const itMorePages: readonly NavigationItem[] = [
  ["Register an asset", routes.assetNew, "", CubeIcon],
  ["Asset audit", routes.assetAudit, "", ClipboardDocumentCheckIcon],
  ["Asset lifecycle", routes.assetLifecycle, "", ArrowPathRoundedSquareIcon],
  ["Asset history", routes.assetHistory, "", ClockIcon],
  ["Asset status", routes.assetStatus, "", CheckCircleIcon],
  ["Warranty / AMC", routes.assetWarranty, "", ShieldCheckIcon],
  ["Consumables stock", routes.inventoryStock, "", FolderIcon],
  ["Purchase orders", routes.inventoryPurchaseOrders, "", DocumentChartBarIcon],
  ["Vendors", routes.inventoryVendors, "", BuildingOffice2Icon],
  ["My tickets", routes.ticketMine, "", TicketIcon],
  ["Add user", routes.userNew, "", UserGroupIcon],
  ["Departments / Teams", routes.userDepartments, "", BuildingOffice2Icon],
];

const itNavigation: readonly NavigationItem[] = itMenu.flatMap((entry): NavigationItem[] =>
  entry.kind === "link"
    ? [[entry.label, entry.href, entry.badge ?? "", entry.icon]]
    : entry.kind === "group"
      ? entry.children.map((child): NavigationItem => [child.label, child.href, child.badge ?? "", child.icon])
      : [],
);

const agentNavigation: readonly NavigationItem[] = [
  ["Dashboard", routes.agentDashboard, "", Squares2X2Icon],
  ["My Assets", routes.agentAssets, "", CubeIcon],
  ["My Software", "/agent/software", "", KeyIcon],
  ["Tickets", routes.agentTickets, "", TicketIcon],
  ["Inventory", routes.agentInventory, "", FolderIcon],
  ["Reports", routes.agentReports, "", DocumentChartBarIcon],
  ["Settings", routes.agentSettings, "", Cog6ToothIcon],
] as const;

const superNavigation: readonly NavigationItem[] = [
  ["Overview", routes.superAdmin, "", Squares2X2Icon],
  ["Companies", routes.superCompanies, "", BuildingOffice2Icon],
  ["Subscriptions", routes.superSubscriptions, "", DocumentChartBarIcon],
  ["Tenant management", routes.superTenants, "", UsersIcon],
  ["Platform admins", routes.superAdmins, "", ShieldCheckIcon],
  ["Audit logs", routes.superAudit, "", FolderIcon],
  ["Platform settings", routes.superSettings, "", Cog6ToothIcon],
] as const;

function isActiveRoute(pathname: string, href: string) {
  return (
    pathname === href ||
    (href !== routes.dashboard && href !== routes.superAdmin && pathname.startsWith(`${href}/`))
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [authenticatedUser, setAuthenticatedUser] = useState<DemoSession | null>(null);
  const [sessionError, setSessionError] = useState("");
  // An IT Agent who signed up on their own has no organization until an IT Admin adds them.
  const [awaitingOrganization, setAwaitingOrganization] = useState(false);
  const [modules, setModules] = useState<string[]>([]);
  const sections = useMemo(() => sectionsFor(authenticatedUser?.role ?? "", modules), [authenticatedUser, modules]);
  const [sessionAttempt, setSessionAttempt] = useState(0);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [mainEl, setMainEl] = useState<HTMLDivElement | null>(null);
  useResponsiveTables(mainEl);

  // Close the phone menu on navigation and on Escape.
  useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname]);
  useEffect(() => {
    if (!mobileNavOpen) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setMobileNavOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileNavOpen]);
  const [search, setSearch] = useState("");
  const [profileOpen, setProfileOpen] = useState(false);
  // Sidebar groups (Assets, Inventory): open when you are inside one.
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({ Assets: true, Inventory: true });
  // Dashboard counts for sidebar badges
  const [counts, setCounts] = useState<DashboardCounts | null>(null);

  // Sidebar badge counts. Only the IT workspace shows them, and they need an
  // organization: an agent awaiting one would just get a 400.
  useEffect(() => {
    if (!authenticatedUser || awaitingOrganization || workspaceForRole(authenticatedUser.role) !== "it") return;
    getDashboardCounts()
      .then(setCounts)
      // Badges are optional; a failure should not interrupt the page.
      .catch(() => setCounts(null));
  }, [authenticatedUser, awaitingOrganization]);

  // Re-read the profile when the user edits it, so the name in the top bar updates.
  useEffect(() => {
    const reload = () => setSessionAttempt((attempt) => attempt + 1);
    window.addEventListener(PROFILE_UPDATED_EVENT, reload);
    return () => window.removeEventListener(PROFILE_UPDATED_EVENT, reload);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadSession = async () => {
      if (!localStorage.getItem("auth-token")) {
        router.replace("/login");
        return;
      }
      try {
        const data = await apiFetch<{
          user: {
            name: string;
            email: string;
            role: DemoSession["role"];
            companyId: string | null;
            modules?: string[];
            avatarUrl?: string | null;
          };
        }>("/api/profile");
        if (cancelled) return;
        setAwaitingOrganization(data.user.role === roles.IT_AGENT && !data.user.companyId);
        setModules(data.user.modules ?? []);
        setAvatarUrl(data.user.avatarUrl ?? null);
        const name = data.user.name || data.user.email.split("@")[0];
        setAuthenticatedUser({
          name,
          initials: name
            .split(/\s+/)
            .map((part) => part[0])
            .join("")
            .slice(0, 2)
            .toUpperCase(),
          role: data.user.role,
        });
        setSessionError("");
      } catch (caught) {
        if (cancelled) return;
        if (caught instanceof ApiRequestError && caught.status === 401) {
          clearAuth();
          endDemoSession();
          router.replace("/login");
          return;
        }
        console.error("Failed to load session profile", caught);
        setSessionError(
          caught instanceof Error
            ? caught.message
            : "Could not load your profile. The application API may be unavailable.",
        );
      }
    };
    loadSession();
    return () => {
      cancelled = true;
    };
  }, [router, sessionAttempt]);

  useEffect(() => {
    setMobileNavOpen(false);
    setProfileOpen(false);
    if (pathname.startsWith("/assets")) setOpenGroups((current) => ({ ...current, Assets: true }));
    if (pathname.startsWith("/inventory")) setOpenGroups((current) => ({ ...current, Inventory: true }));
  }, [pathname]);

  useEffect(() => {
    if (authenticatedUser && !canAccessPath(authenticatedUser.role, pathname)) {
      router.replace(defaultRouteForRole(authenticatedUser.role));
      return;
    }
    // Sub-admins and reporting users only open the sections their role allows.
    const section = sectionForPath(pathname);
    if (authenticatedUser && workspaceForRole(authenticatedUser.role) === "it" && section && !sections.has(section)) {
      router.replace("/dashboard");
    }
  }, [authenticatedUser, pathname, router, sections]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSearch("");
        setMobileNavOpen(false);
        setProfileOpen(false);
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, []);

  const workspace: Workspace = workspaceForRole(authenticatedUser?.role ?? roles.IT_ADMIN);
  const navigation =
    workspace === "super" ? superNavigation : workspace === "agent" ? agentNavigation : itNavigation;
  const searchResults = useMemo(
    () =>
      (workspace === "it"
        ? [
            ...itNavigation,
            ...itMorePages,
          ].filter(([, href]) => {
            const section = sectionForPath(href);
            return !section || sections.has(section);
          })
        : navigation
      )
        .filter(([label]) => label.toLowerCase().includes(search.trim().toLowerCase()))
        .slice(0, 8),
    [navigation, search, workspace, sections],
  );

  const handleSearchNavigation = (href: string) => {
    setSearch("");
    router.push(href);
  };

  // Badge component for sidebar navigation
  const Badge = ({ count }: { count: number }) => count > 0 ? (
    <span className="ml-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-500 px-1.5 text-[10px] font-bold text-white">
      {count > 99 ? "99+" : count}
    </span>
  ) : null;

  // Helper to get count badge for nav items
  const getBadge = (countKey: string) => {
    if (!counts || !countKey) return null;
    switch (countKey) {
      case "assets": return counts.assets.total;
      case "tickets": return counts.tickets.pending;
      case "inventory": return counts.inventory.low_stock;
      case "users": return counts.users.total;
      default: return null;
    }
  };

  const signOut = () => {
    clearAuth();
    endDemoSession();
    setAuthenticatedUser(null);
    router.replace("/login");
  };

  if (sessionError) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#f7f9fc] px-4">
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
          <h1 className="text-lg font-extrabold text-slate-900">Can&rsquo;t reach the workspace</h1>
          <p className="mt-2 text-sm text-slate-500">{sessionError}</p>
          <div className="mt-6 flex justify-center gap-3">
            <button
              type="button"
              onClick={() => {
                setSessionError("");
                setSessionAttempt((attempt) => attempt + 1);
              }}
              className="rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-brand-700"
            >
              Try again
            </button>
            <button
              type="button"
              onClick={() => {
                clearAuth();
                endDemoSession();
                router.replace("/login");
              }}
              className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50"
            >
              Sign out
            </button>
          </div>
        </div>
      </main>
    );
  }

  if (!authenticatedUser) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#f7f9fc] px-4">
        <p className="text-sm font-medium text-slate-500">Loading your workspace…</p>
      </main>
    );
  }

  if (awaitingOrganization) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#f7f9fc] px-4">
        <section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <h1 className="text-xl font-extrabold text-slate-950">Waiting for your IT Admin</h1>
          <p className="mt-3 text-sm text-slate-600">
            Hi {authenticatedUser.name}, your account is ready. An IT Admin needs to add you to their
            organization before you can use the dashboard. Ask them to open <strong>Users</strong> and choose{" "}
            <strong>Add to organization</strong> next to your name.
          </p>
          <div className="mt-6 flex justify-center gap-3">
            <button
              type="button"
              onClick={() => setSessionAttempt((attempt) => attempt + 1)}
              className="rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700"
            >
              Check again
            </button>
            <button
              type="button"
              onClick={signOut}
              className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Sign out
            </button>
          </div>
        </section>
      </main>
    );
  }

  return (
    <div className="min-h-screen bg-[#f7f9fc] text-slate-900 md:grid md:grid-cols-[15.5rem_1fr]">
      {/* Phone menu: a drawer over a dimmed page. */}
      {mobileNavOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-900/40 md:hidden"
          aria-hidden="true"
          onClick={() => setMobileNavOpen(false)}
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] overflow-y-auto border-r border-slate-200 bg-white p-4 text-slate-600 shadow-xl transition-transform duration-200 md:sticky md:top-0 md:z-auto md:block md:h-screen md:w-auto md:max-w-none md:translate-x-0 md:shadow-none ${mobileNavOpen ? "translate-x-0" : "-translate-x-full"}`}
        aria-label="Main menu"
      >
        <button
          type="button"
          aria-label="Close navigation"
          onClick={() => setMobileNavOpen(false)}
          className="absolute right-3 top-4 grid h-9 w-9 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 md:hidden"
        >
          <XMarkIcon className="h-5 w-5" />
        </button>
        <Link
          href={
            workspace === "super"
              ? routes.superAdmin
              : workspace === "agent"
                ? routes.agentDashboard
                : routes.dashboard
          }
          onClick={() => setMobileNavOpen(false)}
          className="mb-5 flex items-center gap-2.5 px-2"
          aria-label="Bold And Wise Ventures home"
        >
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand-600 text-sm font-black text-white shadow-sm">
            B
          </span>
          <span>
            <span className="block text-[13px] font-extrabold tracking-tight text-slate-900">
              Bold And Wise
            </span>
            <span className="block text-[9px] font-semibold text-brand-600">Ventures Pvt Ltd</span>
          </span>
        </Link>

        <div className="mb-5">
          <div className="flex w-full items-center gap-2.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-left">
            <span
              className={`grid h-8 w-8 place-items-center rounded-lg ${workspace === "super" ? "bg-violet-100 text-violet-700" : "bg-blue-100 text-blue-700"}`}
            >
              {workspace === "super" ? (
                <ShieldCheckIcon className="h-4 w-4" />
              ) : (
                <ComputerDesktopIcon className="h-4 w-4" />
              )}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Workspace
              </span>
              <span className="block truncate text-xs font-bold text-slate-800">
                {workspace === "super" ? "Super Admin" : workspace === "agent" ? "User" : "IT Admin"}
              </span>
            </span>
          </div>
        </div>

        <p className="mb-2 px-2 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
          {workspace === "super"
            ? "Platform workspace"
            : workspace === "agent"
              ? "User workspace"
              : "IT operations"}
        </p>
        <nav
          className="space-y-1"
          aria-label={
            workspace === "super"
              ? "Super Admin navigation"
              : workspace === "agent"
                ? "User navigation"
                : "IT Admin navigation"
          }
        >
          {workspace === "it"
            ? itMenu.map((entry, index) => {
                const linkClass = (href: string) =>
                  `flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-semibold transition ${
                    isActiveRoute(pathname, href) ? "bg-brand-600 text-white shadow-sm" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                  }`;
                if (entry.kind === "heading") {
                  const anyVisible = itMenu.slice(index + 1).some((e) => e.kind === "link" && sections.has(e.section));
                  return anyVisible ? (
                    <p key={entry.label} className="px-3 pb-1 pt-4 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
                      {entry.label}
                    </p>
                  ) : null;
                }
                if (entry.kind === "link") {
                  if (!sections.has(entry.section)) return null;
                  const Icon = entry.icon;
                  return (
                    <Link key={entry.href} href={entry.href} className={linkClass(entry.href)} aria-current={isActiveRoute(pathname, entry.href) ? "page" : undefined} onClick={() => setMobileNavOpen(false)}>
                      <Icon className="h-[17px] w-[17px]" />
                      <span className="flex-1">{entry.label}</span>
                      {entry.badge && getBadge(entry.badge) && <Badge count={getBadge(entry.badge)!} />}
                    </Link>
                  );
                }
                const children = entry.children.filter((child) => sections.has(child.section));
                if (children.length === 0) return null;
                const GroupIcon = entry.icon;
                const isOpen = openGroups[entry.label] ?? false;
                const inside = children.some((child) => isActiveRoute(pathname, child.href));
                return (
                  <div key={entry.label}>
                    <button
                      type="button"
                      data-feedback="off"
                      onClick={() => setOpenGroups((current) => ({ ...current, [entry.label]: !isOpen }))}
                      aria-expanded={isOpen}
                      className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-semibold transition ${inside ? "text-brand-700" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"}`}
                    >
                      <GroupIcon className="h-[17px] w-[17px]" />
                      <span className="flex-1 text-left">{entry.label}</span>
                      <ChevronDownIcon className={`h-4 w-4 transition ${isOpen ? "rotate-180" : ""}`} />
                    </button>
                    {isOpen && (
                      <div className="ml-4 mt-0.5 space-y-0.5 border-l border-slate-200 pl-3">
                        {children.map((child) => {
                          const ChildIcon = child.icon;
                          // "/assets" must not light up on "/assets/software": a more specific sibling wins.
                          const active =
                            isActiveRoute(pathname, child.href) &&
                            !children.some(
                              (other) => other.href !== child.href && other.href.startsWith(child.href) && isActiveRoute(pathname, other.href),
                            );
                          return (
                            <Link
                              key={child.href}
                              href={child.href}
                              aria-current={active ? "page" : undefined}
                              onClick={() => setMobileNavOpen(false)}
                              className={`flex items-center gap-2 rounded-md px-2.5 py-1.5 text-[12px] font-semibold transition ${active ? "bg-brand-600 text-white shadow-sm" : "text-slate-500 hover:bg-slate-50 hover:text-slate-900"}`}
                            >
                              <ChildIcon className="h-4 w-4" />
                              <span className="flex-1">{child.label}</span>
                              {child.badge && getBadge(child.badge) && <Badge count={getBadge(child.badge)!} />}
                            </Link>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })
            : navigation.map(([label, href, , Icon]) => {
                const active = isActiveRoute(pathname, href);
                return (
                  <Link
                    className={`flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-semibold transition ${active ? "bg-brand-600 text-white shadow-sm" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"}`}
                    href={href}
                    key={href}
                    aria-current={active ? "page" : undefined}
                    onClick={() => setMobileNavOpen(false)}
                  >
                    <Icon className="h-[17px] w-[17px]" />
                    {label}
                  </Link>
                );
              })}
        </nav>

        <div className={`mt-8 rounded-xl p-3 ${workspace === "super" ? "bg-violet-50" : "bg-blue-50"}`}>
          <p
            className={`text-[10px] font-bold uppercase tracking-wider ${workspace === "super" ? "text-violet-600" : "text-brand-600"}`}
          >
            Current role
          </p>
          <p className="mt-1 text-xs font-bold text-slate-800">
            {workspace === "super"
              ? "Super Administrator"
              : workspace === "agent"
                ? "User"
                : authenticatedUser.role === roles.SUB_ADMIN
                  ? "Sub-admin"
                  : authenticatedUser.role === roles.REPORTING_USER
                    ? "Reporting User"
                    : "IT Administrator"}
          </p>
          <p className="mt-1 text-[10px] leading-4 text-slate-500">
            {workspace === "super"
              ? "Platform-wide company and subscription controls."
              : workspace === "agent"
                ? "Your assets, tickets and stock."
                : authenticatedUser.role === roles.SUB_ADMIN
                  ? "Administers the modules assigned to you."
                  : authenticatedUser.role === roles.REPORTING_USER
                    ? "Read-only dashboards and reports."
                    : "Organization-level ITAM operations."}
          </p>
        </div>
      </aside>

      <section className="min-w-0">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-2 border-b border-slate-200 bg-white/95 px-3 backdrop-blur md:h-[68px] md:px-7">
          <div className="flex min-w-0 items-center gap-2 md:hidden">
            <button
              type="button"
              aria-label="Open navigation"
              aria-expanded={mobileNavOpen}
              onClick={() => setMobileNavOpen(true)}
              className="grid h-10 w-10 shrink-0 place-items-center rounded-lg text-slate-600 hover:bg-slate-100"
            >
              <Bars3Icon className="h-6 w-6" />
            </button>
            <Link href={workspace === "super"
              ? routes.superAdmin
              : workspace === "agent"
                ? routes.agentDashboard
                : routes.dashboard} className="flex min-w-0 items-center gap-2" aria-label="Home">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand-600 text-xs font-black text-white">B</span>
              <span className="truncate text-[13px] font-extrabold tracking-tight text-slate-900">Bold And Wise</span>
            </Link>
          </div>
          <div className="relative hidden w-full max-w-md md:block">
            <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search assets, tickets, users…"
              aria-label="Search modules"
              className="w-full rounded-lg border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-xs outline-none placeholder:text-slate-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
            />
            {search && (
              <div className="absolute left-0 right-0 top-11 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-xl">
                {searchResults.length > 0 ? (
                  searchResults.map(([label, href]) => (
                    <button
                      type="button"
                      onClick={() => handleSearchNavigation(href)}
                      key={href}
                      className="block w-full px-3 py-2 text-left text-xs text-slate-700 hover:bg-slate-50"
                    >
                      <span className="font-semibold">{label}</span>
                      <span className="ml-2 text-[10px] text-slate-400">{href}</span>
                    </button>
                  ))
                ) : (
                  <p className="px-3 py-2 text-xs text-slate-500">No matching modules.</p>
                )}
              </div>
            )}
          </div>
          <div className="ml-auto flex items-center gap-2.5">
            <NotificationBell />
            <div className="relative">
              <button
                type="button"
                aria-label="Open profile menu"
                data-feedback="off"
                onClick={() => setProfileOpen((open) => !open)}
                className="flex items-center gap-2 rounded-lg py-1 pl-1 pr-2 hover:bg-slate-100"
              >
                {avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- a small data URL, not a remote image
                  <img src={avatarUrl} alt="" className="h-7 w-7 rounded-full object-cover" />
                ) : (
                  <span className="grid h-7 w-7 place-items-center rounded-full bg-blue-100 text-[10px] font-extrabold text-brand-700">
                    {authenticatedUser.initials}
                  </span>
                )}
                <span className="hidden text-left sm:block">
                  <span className="block text-[11px] font-bold text-slate-700">{authenticatedUser.name}</span>
                  <span className="block text-[10px] text-slate-500">
                    {workspace === "super" ? "Super Admin" : workspace === "agent" ? "User" : "IT Admin"}
                  </span>
                </span>
                <ChevronDownIcon className="hidden h-3.5 w-3.5 text-slate-400 sm:block" />
              </button>
              {profileOpen && (
                <div className="absolute right-0 top-11 w-52 rounded-xl border border-slate-200 bg-white p-2 shadow-xl">
                  <p className="px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    Signed in as
                  </p>
                  <p className="px-2 pb-2 text-xs font-bold text-slate-800">{authenticatedUser.name}</p>
                  <Link
                    href="/profile"
                    onClick={() => setProfileOpen(false)}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs font-bold text-slate-700 hover:bg-slate-50"
                  >
                    View profile
                  </Link>
                  <button
                    type="button"
                    data-feedback="off"
                    onClick={signOut}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs font-bold text-slate-700 hover:bg-slate-50"
                  >
                    <ArrowRightStartOnRectangleIcon className="h-4 w-4" /> Sign out
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>
        <div ref={setMainEl} className="app-main p-3 sm:p-5 md:p-7">
          {children}
        </div>
      </section>
    </div>
  );
}
