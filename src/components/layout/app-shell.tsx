"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ComponentType, ReactNode, SVGProps } from "react";
import { useEffect, useMemo, useState } from "react";
import {
  BellIcon,
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
import { apiFetch, clearAuth } from "@/lib/api";
import { canAccessPath, defaultRouteForRole, roles, workspaceForRole, type Workspace } from "@/lib/roles";
import { routes } from "@/lib/routes";

type NavigationItem = readonly [label: string, href: string, icon: ComponentType<SVGProps<SVGSVGElement>>];

const itNavigation: readonly NavigationItem[] = [
  ["Dashboard", routes.dashboard, Squares2X2Icon],
  ["Tickets", routes.tickets, TicketIcon],
  ["Users", routes.users, UserGroupIcon],
  ["Inventory", routes.inventory, FolderIcon],
  ["Reports", routes.reports, FolderIcon],
  ["Settings", routes.settings, Cog6ToothIcon],
] as const;

const assetNavigation: readonly NavigationItem[] = [
  ["All Assets", routes.assets, CubeIcon],
  ["Add New Asset", routes.assetNew, CubeIcon],
  ["Asset Assignment", routes.assetAssignment, UserGroupIcon],
  ["Asset Audit", routes.assetAudit, ClipboardDocumentCheckIcon],
  ["Asset Lifecycle", routes.assetLifecycle, ArrowPathRoundedSquareIcon],
  ["Warranty / AMC", routes.assetWarranty, ShieldCheckIcon],
  ["Asset History", routes.assetHistory, ClockIcon],
  ["Asset Status", routes.assetStatus, CheckCircleIcon],
] as const;

const ticketNavigation: readonly NavigationItem[] = [
  ["Ticket Dashboard", routes.ticketDashboard, Squares2X2Icon],
  ["All Tickets", routes.tickets, TicketIcon],
  ["My Tickets", routes.ticketMine, TicketIcon],
  ["Create New Ticket", routes.ticketNew, TicketIcon],
] as const;

const userNavigation: readonly NavigationItem[] = [
  ["All Users", routes.users, UserGroupIcon],
  ["Add User", routes.userNew, UserGroupIcon],
  ["Departments / Teams", routes.userDepartments, BuildingOffice2Icon],
] as const;

const inventoryNavigation: readonly NavigationItem[] = [
  ["Inventory Dashboard", routes.inventory, Squares2X2Icon],
  ["Hardware Inventory", routes.inventoryHardware, CubeIcon],
  ["Software Inventory", routes.inventorySoftware, ComputerDesktopIcon],
  ["Stock / Available Items", routes.inventoryStock, FolderIcon],
  ["Purchase Orders", routes.inventoryPurchaseOrders, DocumentChartBarIcon],
  ["Vendors", routes.inventoryVendors, BuildingOffice2Icon],
] as const;

const agentNavigation: readonly NavigationItem[] = [
  ["Dashboard", routes.agentDashboard, Squares2X2Icon],
  ["Assets", routes.agentAssets, CubeIcon],
  ["Tickets", routes.agentTickets, TicketIcon],
  ["Users", routes.agentUsers, UserGroupIcon],
  ["Inventory", routes.agentInventory, FolderIcon],
  ["Reports", routes.agentReports, DocumentChartBarIcon],
  ["Settings", routes.agentSettings, Cog6ToothIcon],
] as const;

const superNavigation: readonly NavigationItem[] = [
  ["Overview", routes.superAdmin, Squares2X2Icon],
  ["Companies", routes.superCompanies, BuildingOffice2Icon],
  ["Subscriptions", routes.superSubscriptions, DocumentChartBarIcon],
  ["Tenant management", routes.superTenants, UsersIcon],
  ["Platform admins", routes.superAdmins, ShieldCheckIcon],
  ["Audit logs", routes.superAudit, FolderIcon],
  ["Platform settings", routes.superSettings, Cog6ToothIcon],
] as const;

function isActiveRoute(pathname: string, href: string) {
  return pathname === href || (href !== routes.dashboard && href !== routes.superAdmin && pathname.startsWith(`${href}/`));
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [authenticatedUser, setAuthenticatedUser] = useState<DemoSession | null>(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [profileOpen, setProfileOpen] = useState(false);
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [actionMessage, setActionMessage] = useState("");
  const [assetsOpen, setAssetsOpen] = useState(pathname.startsWith("/assets"));
  const [ticketsOpen, setTicketsOpen] = useState(pathname.startsWith("/tickets"));
  const [usersOpen, setUsersOpen] = useState(pathname.startsWith("/users"));
  const [inventoryOpen, setInventoryOpen] = useState(pathname.startsWith("/inventory"));

  useEffect(() => {
    let cancelled = false;
    const loadSession = async () => {
      if (!localStorage.getItem("auth-token")) {
        router.replace("/login");
        return;
      }
      try {
        const data = await apiFetch<{ user: { name: string; email: string; role: DemoSession["role"] } }>("/api/profile");
        if (cancelled) return;
        const name = data.user.name || data.user.email.split("@")[0];
        setAuthenticatedUser({ name, initials: name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase(), role: data.user.role });
      } catch {
        if (cancelled) return;
        clearAuth();
        endDemoSession();
        router.replace("/login");
      }
    };
    loadSession();
    return () => { cancelled = true; };
  }, [router]);

  useEffect(() => {
    setMobileNavOpen(false);
    setProfileOpen(false);
    setNotificationOpen(false);
    if (pathname.startsWith("/assets")) setAssetsOpen(true);
    if (pathname.startsWith("/tickets")) setTicketsOpen(true);
    if (pathname.startsWith("/users")) setUsersOpen(true);
    if (pathname.startsWith("/inventory")) setInventoryOpen(true);
  }, [pathname]);

  useEffect(() => {
    if (authenticatedUser && !canAccessPath(authenticatedUser.role, pathname)) {
      router.replace(defaultRouteForRole(authenticatedUser.role));
    }
  }, [authenticatedUser, pathname, router]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSearch("");
        setMobileNavOpen(false);
        setProfileOpen(false);
        setNotificationOpen(false);
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, []);

  const workspace: Workspace = workspaceForRole(authenticatedUser?.role ?? roles.IT_ADMIN);
  const navigation = workspace === "super" ? superNavigation : workspace === "agent" ? agentNavigation : itNavigation;
  const searchResults = useMemo(
    () => (workspace === "it" ? [...itNavigation, ...assetNavigation, ...ticketNavigation, ...userNavigation, ...inventoryNavigation] : navigation).filter(([label]) => label.toLowerCase().includes(search.trim().toLowerCase())).slice(0, 8),
    [navigation, search, workspace],
  );

  const handleSearchNavigation = (href: string) => {
    setSearch("");
    router.push(href);
  };

  const signOut = () => {
    clearAuth();
    endDemoSession();
    setAuthenticatedUser(null);
    router.replace("/login");
  };

  const handleButtonFeedback = (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    const button = target.closest("button");
    if (!button || button.dataset.feedback === "off") return;
    const label = button.textContent?.replace(/\s+/g, " ").trim();
    if (!label || /^(dismiss|close|sign out)$/i.test(label)) return;
    setActionMessage(`${label} selected. This demo action is ready to connect to the backend.`);
  };

  if (!authenticatedUser) return null;

  return (
    <div className="min-h-screen bg-[#f7f9fc] text-slate-900 md:grid md:grid-cols-[15.5rem_1fr]" onClickCapture={handleButtonFeedback}>
      {actionMessage && <div role="status" className="fixed bottom-4 right-4 z-[100] flex max-w-sm items-start gap-3 rounded-xl border border-blue-200 bg-white px-4 py-3 text-xs font-semibold text-slate-700 shadow-xl"><span className="flex-1">{actionMessage}</span><button type="button" data-feedback="off" aria-label="Dismiss action message" onClick={() => setActionMessage("")} className="text-slate-400 hover:text-slate-700">×</button></div>}
      <div className="md:hidden">
        <div className="sticky top-0 z-50 flex h-16 items-center justify-between border-b border-slate-200 bg-white px-4">
          <Link href={workspace === "super" ? routes.superAdmin : workspace === "agent" ? routes.agentDashboard : routes.dashboard} className="flex items-center gap-2.5" aria-label="Bold And Wise Ventures home">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand-600 text-sm font-black text-white shadow-sm">B</span>
            <span>
              <span className="block text-[13px] font-extrabold tracking-tight text-slate-900">Bold And Wise</span>
              <span className="block text-[9px] font-semibold text-brand-600">Ventures Pvt Ltd</span>
            </span>
          </Link>
          <button
            type="button"
            aria-label={mobileNavOpen ? "Close navigation" : "Open navigation"}
            aria-expanded={mobileNavOpen}
            onClick={() => setMobileNavOpen((open) => !open)}
            className="grid h-9 w-9 place-items-center rounded-lg text-slate-600 hover:bg-slate-100"
          >
            {mobileNavOpen ? <XMarkIcon className="h-5 w-5" /> : <Bars3Icon className="h-5 w-5" />}
          </button>
        </div>
      </div>

      <aside className={`${mobileNavOpen ? "fixed inset-x-0 top-16 z-40 block max-h-[calc(100vh-4rem)] overflow-y-auto" : "hidden"} border-r border-slate-200 bg-white p-4 text-slate-600 md:sticky md:top-0 md:block md:h-screen md:overflow-y-auto`}>
        <Link href={workspace === "super" ? routes.superAdmin : workspace === "agent" ? routes.agentDashboard : routes.dashboard} className="mb-5 hidden items-center gap-2.5 px-2 md:flex" aria-label="Bold And Wise Ventures home">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand-600 text-sm font-black text-white shadow-sm">B</span>
          <span>
            <span className="block text-[13px] font-extrabold tracking-tight text-slate-900">Bold And Wise</span>
            <span className="block text-[9px] font-semibold text-brand-600">Ventures Pvt Ltd</span>
          </span>
        </Link>

        <div className="mb-5">
          <div className="flex w-full items-center gap-2.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-left">
            <span className={`grid h-8 w-8 place-items-center rounded-lg ${workspace === "super" ? "bg-violet-100 text-violet-700" : "bg-blue-100 text-blue-700"}`}>
              {workspace === "super" ? <ShieldCheckIcon className="h-4 w-4" /> : <ComputerDesktopIcon className="h-4 w-4" />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">Workspace</span>
              <span className="block truncate text-xs font-bold text-slate-800">{workspace === "super" ? "Super Admin" : workspace === "agent" ? "IT Agent" : "IT Admin"}</span>
            </span>
          </div>
        </div>

        <p className="mb-2 px-2 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">{workspace === "super" ? "Platform workspace" : workspace === "agent" ? "Agent workspace" : "IT operations"}</p>
        <nav className="space-y-1" aria-label={workspace === "super" ? "Super Admin navigation" : workspace === "agent" ? "IT Agent navigation" : "IT Admin navigation"}>
          {workspace === "it" && itNavigation.filter(([label]) => label === "Dashboard").map(([label, href, Icon]) => <Link className={`flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-semibold transition ${isActiveRoute(pathname, href) ? "bg-brand-600 text-white shadow-sm" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"}`} href={href} key={href} onClick={() => setMobileNavOpen(false)}><Icon className="h-[17px] w-[17px]" />{label}</Link>)}
          {workspace === "it" && <div>
            <button type="button" data-feedback="off" onClick={() => setAssetsOpen((open) => !open)} aria-expanded={assetsOpen} className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-semibold transition ${pathname.startsWith("/assets") ? "text-brand-700" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"}`}>
              <CubeIcon className="h-[17px] w-[17px]" /> <span className="flex-1 text-left">Assets</span><ChevronDownIcon className={`h-4 w-4 transition ${assetsOpen ? "rotate-180" : ""}`} />
            </button>
            {assetsOpen && <div className="mt-1 space-y-0.5 border-l border-slate-200 pl-3 ml-4">{assetNavigation.map(([label, href]) => {
              const active = pathname === href;
              return <Link key={href} href={href} onClick={() => setMobileNavOpen(false)} aria-current={active ? "page" : undefined} className={`block rounded-md px-3 py-1.5 text-[11px] font-semibold transition ${active ? "bg-brand-600 text-white shadow-sm" : "text-slate-500 hover:bg-slate-50 hover:text-slate-900"}`}>{label}</Link>;
            })}</div>}
          </div>}
          {workspace === "it" && <div><button type="button" data-feedback="off" onClick={() => setTicketsOpen((open) => !open)} aria-expanded={ticketsOpen} className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-semibold transition ${pathname.startsWith("/tickets") ? "text-brand-700" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"}`}><TicketIcon className="h-[17px] w-[17px]" /><span className="flex-1 text-left">Tickets</span><ChevronDownIcon className={`h-4 w-4 transition ${ticketsOpen ? "rotate-180" : ""}`} /></button>{ticketsOpen && <div className="mt-1 ml-4 space-y-0.5 border-l border-slate-200 pl-3">{ticketNavigation.map(([label, href]) => <Link key={href} href={href} onClick={() => setMobileNavOpen(false)} className={`block rounded-md px-3 py-1.5 text-[11px] font-semibold transition ${pathname === href ? "bg-brand-600 text-white shadow-sm" : "text-slate-500 hover:bg-slate-50 hover:text-slate-900"}`}>{label}</Link>)}</div>}</div>}
          {workspace === "it" && <div><button type="button" data-feedback="off" onClick={() => setUsersOpen((open) => !open)} aria-expanded={usersOpen} className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-semibold transition ${pathname.startsWith("/users") ? "text-brand-700" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"}`}><UserGroupIcon className="h-[17px] w-[17px]" /><span className="flex-1 text-left">Users</span><ChevronDownIcon className={`h-4 w-4 transition ${usersOpen ? "rotate-180" : ""}`} /></button>{usersOpen && <div className="mt-1 ml-4 space-y-0.5 border-l border-slate-200 pl-3">{userNavigation.map(([label, href]) => <Link key={href} href={href} onClick={() => setMobileNavOpen(false)} className={`block rounded-md px-3 py-1.5 text-[11px] font-semibold transition ${pathname === href ? "bg-brand-600 text-white shadow-sm" : "text-slate-500 hover:bg-slate-50 hover:text-slate-900"}`}>{label}</Link>)}</div>}</div>}
          {workspace === "it" && <div><button type="button" data-feedback="off" onClick={() => setInventoryOpen((open) => !open)} aria-expanded={inventoryOpen} className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-semibold transition ${pathname.startsWith("/inventory") ? "text-brand-700" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"}`}><FolderIcon className="h-[17px] w-[17px]" /><span className="flex-1 text-left">Inventory</span><ChevronDownIcon className={`h-4 w-4 transition ${inventoryOpen ? "rotate-180" : ""}`} /></button>{inventoryOpen && <div className="mt-1 ml-4 space-y-0.5 border-l border-slate-200 pl-3">{inventoryNavigation.map(([label, href]) => <Link key={href} href={href} onClick={() => setMobileNavOpen(false)} className={`block rounded-md px-3 py-1.5 text-[11px] font-semibold transition ${pathname === href ? "bg-brand-600 text-white shadow-sm" : "text-slate-500 hover:bg-slate-50 hover:text-slate-900"}`}>{label}</Link>)}</div>}</div>}
          {(workspace === "it" ? navigation.filter(([label]) => !["Dashboard", "Tickets", "Users", "Inventory"].includes(label)) : navigation).map(([label, href, Icon]) => {
            const active = isActiveRoute(pathname, href);
            return (
              <Link
                className={`flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-semibold transition ${active ? "bg-brand-600 text-white shadow-sm" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"}`}
                href={href}
                key={href}
                aria-current={active ? "page" : undefined}
                onClick={() => setMobileNavOpen(false)}
              >
                <Icon className="h-[17px] w-[17px]" />{label}
              </Link>
            );
          })}
        </nav>

        <div className={`mt-8 rounded-xl p-3 ${workspace === "super" ? "bg-violet-50" : "bg-blue-50"}`}>
          <p className={`text-[10px] font-bold uppercase tracking-wider ${workspace === "super" ? "text-violet-600" : "text-brand-600"}`}>Current role</p>
          <p className="mt-1 text-xs font-bold text-slate-800">{workspace === "super" ? "Super Administrator" : workspace === "agent" ? "IT Agent" : "IT Administrator"}</p>
          <p className="mt-1 text-[10px] leading-4 text-slate-500">{workspace === "super" ? "Platform-wide company and subscription controls." : workspace === "agent" ? "Ticket, asset and inventory operations." : "Organization-level ITAM operations."}</p>
        </div>
      </aside>

      <section className="min-w-0">
        <header className="sticky top-0 z-30 flex h-[68px] items-center justify-between border-b border-slate-200 bg-white/95 px-4 backdrop-blur md:px-7">
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
                {searchResults.length > 0 ? searchResults.map(([label, href]) => (
                  <button type="button" onClick={() => handleSearchNavigation(href)} key={href} className="block w-full px-3 py-2 text-left text-xs text-slate-700 hover:bg-slate-50">
                    <span className="font-semibold">{label}</span><span className="ml-2 text-[10px] text-slate-400">{href}</span>
                  </button>
                )) : <p className="px-3 py-2 text-xs text-slate-500">No matching modules.</p>}
              </div>
            )}
          </div>
          <div className="ml-auto flex items-center gap-2.5">
            <div className="relative"><button type="button" aria-label="Notifications" data-feedback="off" onClick={() => setNotificationOpen((open) => !open)} className="relative grid h-9 w-9 place-items-center rounded-lg text-slate-500 hover:bg-slate-100">
              <BellIcon className="h-5 w-5" /><span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-rose-500" />
            </button>{notificationOpen && <div className="absolute right-0 top-11 w-72 rounded-xl border border-slate-200 bg-white p-3 text-xs shadow-xl"><p className="font-bold text-slate-800">Notifications</p><p className="mt-2 leading-5 text-slate-500">No new notifications. Operational alerts will appear here when connected to the notification service.</p></div>}</div>
            <div className="relative"><button type="button" aria-label="Open profile menu" data-feedback="off" onClick={() => setProfileOpen((open) => !open)} className="flex items-center gap-2 rounded-lg py-1 pl-1 pr-2 hover:bg-slate-100">
              <span className="grid h-7 w-7 place-items-center rounded-full bg-blue-100 text-[10px] font-extrabold text-brand-700">{authenticatedUser.initials}</span>
              <span className="hidden text-left sm:block"><span className="block text-[11px] font-bold text-slate-700">{authenticatedUser.name}</span><span className="block text-[10px] text-slate-500">{workspace === "super" ? "Super Admin" : workspace === "agent" ? "IT Agent" : "IT Admin"}</span></span>
              <ChevronDownIcon className="hidden h-3.5 w-3.5 text-slate-400 sm:block" />
            </button>{profileOpen && <div className="absolute right-0 top-11 w-52 rounded-xl border border-slate-200 bg-white p-2 shadow-xl"><p className="px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">Signed in as</p><p className="px-2 pb-2 text-xs font-bold text-slate-800">{authenticatedUser.name}</p><Link href="/profile" onClick={() => setProfileOpen(false)} className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs font-bold text-slate-700 hover:bg-slate-50">View profile</Link><button type="button" data-feedback="off" onClick={signOut} className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs font-bold text-slate-700 hover:bg-slate-50"><ArrowRightStartOnRectangleIcon className="h-4 w-4" /> Sign out</button></div>}</div>
          </div>
        </header>
        <div className="p-4 sm:p-5 md:p-7">{children}</div>
      </section>
    </div>
  );
}
